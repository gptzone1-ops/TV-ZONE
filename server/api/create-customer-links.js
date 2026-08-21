import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const adminPassword = process.env.ADMIN_PASSWORD || process.env.VITE_ADMIN_PASSWORD || "Net123213Net@";

function send(res, status, payload) {
  return res.status(status).json(payload);
}

const PROFILE_STRUCTURES = {
  private: {
    names: ["A", "B", "C", "D", "E"],
    labels: ["A", "B", "C", "D", "E"],
  },
  shared: {
    names: ["A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2", "E1", "E2"],
    labels: ["A", "A", "B", "B", "C", "C", "D", "D", "E", "E"],
  },
};

function hasValidStructure(links, accountType, serviceType, osnSubscriptionMode) {
  const structure = PROFILE_STRUCTURES[accountType];
  if (!structure || links.length !== structure.names.length) return false;

  const requiresActivationKeys = serviceType === "osn" && osnSubscriptionMode === "telegram_keys";
  const activationKeys = requiresActivationKeys
    ? links.map((link) => String(link?.activation_key || "").trim())
    : [];
  if (requiresActivationKeys && (
    activationKeys.some((key) => !key)
    || new Set(activationKeys.map((key) => key.toLowerCase())).size !== activationKeys.length
  )) return false;

  return links.every((link, index) => (
    link
    && String(link.uuid || "").trim()
    && String(link.short_id || "").trim()
    && String(link.profile_code || "").trim()
    && String(link.service_type || "netflix") === serviceType
    && String(link.profile_name || "") === structure.names[index]
    && String(link.profile_label || "") === structure.labels[index]
  ));
}

function sanitizeLinkRows(links, accountId, email, serviceType) {
  return links.map((link) => ({
    account_id: accountId,
    email,
    uuid: String(link.uuid).trim(),
    short_id: String(link.short_id).trim(),
    service_type: serviceType,
    profile_name: String(link.profile_name).trim(),
    profile_label: String(link.profile_label).trim(),
    profile_code: String(link.profile_code).trim(),
    ...(serviceType === "osn" && String(link.activation_key || "").trim()
      ? { activation_key: String(link.activation_key).trim() }
      : {}),
  }));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return send(res, 405, { success: false, error: "method_not_allowed" });
  }

  if (req.headers["x-admin-password"] !== adminPassword) {
    return send(res, 401, { success: false, error: "unauthorized" });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return send(res, 500, { success: false, error: "supabase_not_configured" });
  }

  const accountId = String(req.body?.account_id || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const links = Array.isArray(req.body?.links) ? req.body.links : null;

  if (!accountId || !email || !links) {
    return send(res, 400, { success: false, error: "invalid_payload" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();

  if (accountError) {
    console.error("Strict customer link account lookup failed:", accountError);
    return send(res, 500, { success: false, error: "account_lookup_failed" });
  }

  if (!account) return send(res, 404, { success: false, error: "account_not_found" });
  const serviceType = account.service_type || "netflix";
  if (!["netflix", "osn"].includes(serviceType) || !PROFILE_STRUCTURES[account.account_type]) {
    return send(res, 409, { success: false, error: "unsupported_account_type" });
  }
  if (String(account.email || "").trim().toLowerCase() !== email) {
    return send(res, 409, { success: false, error: "account_email_mismatch" });
  }
  if (!hasValidStructure(links, account.account_type, serviceType, account.osn_subscription_mode)) {
    return send(res, 409, { success: false, error: "invalid_links_structure" });
  }

  const { count: existingCount, error: existingError } = await supabase
    .from("customer_links")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);

  if (existingError) {
    console.error("Strict customer link existence check failed:", existingError);
    return send(res, 500, { success: false, error: "link_check_failed" });
  }
  if ((existingCount || 0) > 0) {
    return send(res, 409, { success: false, error: "links_already_exist" });
  }

  // PostgREST sends this array as one INSERT statement, so all rows commit together.
  // Keep this payload compatible with databases that have not applied optional
  // tracking migrations. Only established customer_links columns are inserted.
  const rows = sanitizeLinkRows(links, accountId, email, serviceType);
  const { data, error } = await supabase
    .from("customer_links")
    .insert(rows)
    .select("*");

  if (error) {
    console.error("Strict customer link creation failed:", error);
    const status = /links_already_exist|invalid_|mismatch|unsupported/i.test(error.message || "") ? 409 : 500;
    return send(res, status, {
      success: false,
      error: error.message || "link_creation_failed",
      code: error.code || null,
      details: error.details || null,
      hint: error.hint || null,
    });
  }

  const createdLinks = Array.isArray(data) ? data : [];
  const expectedCount = PROFILE_STRUCTURES[account.account_type].names.length;
  if (createdLinks.length !== expectedCount) {
    console.error("Strict customer link creation returned an invalid count:", createdLinks.length);
    return send(res, 500, { success: false, error: "invalid_generated_links_count" });
  }

  return send(res, 200, { success: true, links: createdLinks });
}

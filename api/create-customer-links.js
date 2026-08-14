import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const adminPassword = process.env.ADMIN_PASSWORD || process.env.VITE_ADMIN_PASSWORD || "Gpt123Gpt@@";

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

function hasValidStructure(links, accountType) {
  const structure = PROFILE_STRUCTURES[accountType];
  if (!structure || links.length !== structure.names.length) return false;

  return links.every((link, index) => (
    link
    && String(link.uuid || "").trim()
    && String(link.short_id || "").trim()
    && String(link.profile_code || "").trim()
    && String(link.service_type || "netflix") === "netflix"
    && String(link.profile_name || "") === structure.names[index]
    && String(link.profile_label || "") === structure.labels[index]
  ));
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
    .select("id,email,account_type,service_type")
    .eq("id", accountId)
    .maybeSingle();

  if (accountError) {
    console.error("Strict customer link account lookup failed:", accountError);
    return send(res, 500, { success: false, error: "account_lookup_failed" });
  }

  if (!account) return send(res, 404, { success: false, error: "account_not_found" });
  if ((account.service_type || "netflix") !== "netflix" || !PROFILE_STRUCTURES[account.account_type]) {
    return send(res, 409, { success: false, error: "unsupported_account_type" });
  }
  if (String(account.email || "").trim().toLowerCase() !== email) {
    return send(res, 409, { success: false, error: "account_email_mismatch" });
  }
  if (!hasValidStructure(links, account.account_type)) {
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
  const rows = links.map((link) => ({
    account_id: accountId,
    email,
    uuid: link.uuid,
    short_id: link.short_id,
    service_type: "netflix",
    profile_name: link.profile_name,
    profile_label: link.profile_label,
    profile_code: link.profile_code,
    generation_version: 2,
  }));
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

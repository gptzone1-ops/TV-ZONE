import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";

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

const PROFILE_CODES = { A: "3333", B: "3334", C: "9999", D: "1212", E: "9090" };

function generateShortId(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function buildBatchProfileSlots(accountType, serviceType) {
  const labels = serviceType === "shahid" ? ["A", "B", "C", "D"] : ["A", "B", "C", "D", "E"];
  const names = accountType === "private" ? labels : labels.flatMap((label) => [`${label}1`, `${label}2`]);

  return names.map((profileName) => {
    const profileLabel = profileName.charAt(0);
    return {
      uuid: randomUUID(),
      short_id: generateShortId(),
      profile_name: profileName,
      profile_label: profileLabel,
      profile_code: serviceType === "shahid" ? "" : PROFILE_CODES[profileLabel],
      service_type: serviceType,
    };
  });
}

function normalizeBatchAccount(value) {
  return {
    email: String(value?.email || "").trim().toLowerCase(),
    password: String(value?.password || "").trim(),
    supplierCodeUrl: String(value?.supplier_code_url || "").trim(),
    expiresAt: String(value?.expires_at || "").trim(),
  };
}

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

async function createAccountsBatch(req, res, supabase) {
  const serviceType = String(req.body?.service_type || "").trim();
  const accountType = String(req.body?.account_type || "").trim();
  const requestedAccounts = Array.isArray(req.body?.accounts) ? req.body.accounts : [];

  if (!["netflix", "shahid"].includes(serviceType) || !["private", "shared"].includes(accountType)) {
    return send(res, 400, { success: false, error: "unsupported_batch_configuration" });
  }
  if (!requestedAccounts.length || requestedAccounts.length > 50) {
    return send(res, 400, { success: false, error: "invalid_batch_size" });
  }

  const accounts = requestedAccounts.map(normalizeBatchAccount);
  const emails = accounts.map((account) => account.email);
  const validEmailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const hasInvalidAccount = accounts.some((account) => (
    !validEmailPattern.test(account.email)
    || !account.password
    || !account.expiresAt
    || (account.supplierCodeUrl && !/^https?:\/\//i.test(account.supplierCodeUrl))
  ));
  if (hasInvalidAccount) return send(res, 400, { success: false, error: "invalid_batch_account" });
  if (new Set(emails).size !== emails.length) return send(res, 409, { success: false, error: "duplicate_email" });

  const { data: existingAccounts, error: existingLookupError } = await supabase
    .from("accounts")
    .select("email");
  if (existingLookupError) {
    console.error("Batch duplicate email lookup failed:", existingLookupError);
    return send(res, 500, { success: false, error: "duplicate_lookup_failed" });
  }
  const existingEmails = new Set((existingAccounts || []).map((account) => String(account.email || "").trim().toLowerCase()));
  if (emails.some((email) => existingEmails.has(email))) {
    return send(res, 409, { success: false, error: "duplicate_email" });
  }

  const accountRows = accounts.map((account) => ({
    email: account.email,
    password: account.password,
    account_type: accountType,
    service_type: serviceType,
    expires_at: account.expiresAt,
    supplier_code_url: account.supplierCodeUrl || null,
    code_fetch_method: serviceType === "netflix" ? (account.supplierCodeUrl ? "external_link" : "auto_fetch") : null,
    use_automated_code: serviceType === "netflix" && !account.supplierCodeUrl,
    email_provider: "none",
    imap_enabled: false,
    normal_client_layout: true,
    hide_password_from_client: serviceType === "netflix",
  }));

  const { data: createdAccounts, error: accountInsertError } = await supabase
    .from("accounts")
    .insert(accountRows)
    .select("*");
  if (accountInsertError) {
    console.error("Batch account insert failed:", accountInsertError);
    const duplicate = accountInsertError.code === "23505" || /duplicate.*email/i.test(accountInsertError.message || "");
    return send(res, duplicate ? 409 : 500, {
      success: false,
      error: duplicate ? "duplicate_email" : accountInsertError.message,
    });
  }

  const created = Array.isArray(createdAccounts) ? createdAccounts : [];
  const createdIds = created.map((account) => account.id);
  if (created.length !== accounts.length) {
    if (createdIds.length) await supabase.from("accounts").delete().in("id", createdIds);
    return send(res, 500, { success: false, error: "incomplete_account_batch" });
  }

  const createdByEmail = new Map(created.map((account) => [String(account.email).trim().toLowerCase(), account]));
  const linkRows = accounts.flatMap((account) => {
    const createdAccount = createdByEmail.get(account.email);
    return buildBatchProfileSlots(accountType, serviceType).map((slot) => ({
      account_id: createdAccount.id,
      email: account.email,
      ...slot,
    }));
  });

  const { data: createdLinks, error: linkInsertError } = await supabase
    .from("customer_links")
    .insert(linkRows)
    .select("*");
  if (linkInsertError || !Array.isArray(createdLinks) || createdLinks.length !== linkRows.length) {
    console.error("Batch customer link insert failed:", linkInsertError || "incomplete_link_batch");
    await supabase.from("accounts").delete().in("id", createdIds);
    return send(res, 500, { success: false, error: linkInsertError?.message || "incomplete_link_batch" });
  }

  return send(res, 200, { success: true, accounts: created, links: createdLinks });
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

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (req.body?.action === "batch_create_accounts") {
    return createAccountsBatch(req, res, supabase);
  }

  const accountId = String(req.body?.account_id || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const links = Array.isArray(req.body?.links) ? req.body.links : null;

  if (!accountId || !email || !links) {
    return send(res, 400, { success: false, error: "invalid_payload" });
  }

  const [accountResult, existingLinksResult] = await Promise.all([
    supabase
      .from("accounts")
      .select("id,email,service_type,account_type,osn_subscription_mode")
      .eq("id", accountId)
      .maybeSingle(),
    supabase
      .from("customer_links")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId),
  ]);
  const { data: account, error: accountError } = accountResult;
  const { count: existingCount, error: existingError } = existingLinksResult;

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

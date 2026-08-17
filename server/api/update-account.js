import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const adminPassword = process.env.ADMIN_PASSWORD || process.env.VITE_ADMIN_PASSWORD || "Gpt123Gpt@@";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeOptionalHttpUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function syncEmailInLinkedUrl(url, previousEmail, nextEmail) {
  const trimmedUrl = String(url || "").trim();
  const normalizedPreviousEmail = normalizeEmail(previousEmail);
  const normalizedNextEmail = normalizeEmail(nextEmail);

  if (!trimmedUrl || !normalizedPreviousEmail || normalizedPreviousEmail === normalizedNextEmail) {
    return trimmedUrl || null;
  }

  const replaceIgnoringCase = (value, search, replacement) =>
    value.replace(new RegExp(escapeRegExp(search), "gi"), replacement);
  const withPlainEmail = replaceIgnoringCase(trimmedUrl, normalizedPreviousEmail, normalizedNextEmail);

  return replaceIgnoringCase(
    withPlainEmail,
    encodeURIComponent(normalizedPreviousEmail),
    encodeURIComponent(normalizedNextEmail),
  );
}

function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(status).json(payload);
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
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  if (!accountId || !email) {
    return send(res, 400, { success: false, error: "invalid_account_data" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existingAccount, error: lookupError } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();

  if (lookupError) {
    console.error("Account update lookup failed:", lookupError);
    return send(res, 500, { success: false, error: "account_lookup_failed" });
  }
  if (!existingAccount) {
    return send(res, 404, { success: false, error: "account_not_found" });
  }
  if ((existingAccount.service_type || "netflix") !== "osn" && !password) {
    return send(res, 400, { success: false, error: "invalid_account_data" });
  }
  const passwordToSave = (existingAccount.service_type || "netflix") === "osn" && !password
    ? String(existingAccount.password || "")
    : password;

  const supplierCodeUrl = syncEmailInLinkedUrl(
    req.body?.supplier_code_url,
    existingAccount.email,
    email,
  );
  const hasCodeFetchMethod = Object.prototype.hasOwnProperty.call(req.body || {}, "code_fetch_method");
  const codeFetchMethod = hasCodeFetchMethod ? String(req.body?.code_fetch_method || "").trim() : null;
  if (hasCodeFetchMethod && !["auto_fetch", "external_link"].includes(codeFetchMethod)) {
    return send(res, 400, { success: false, error: "invalid_code_fetch_method" });
  }
  if (codeFetchMethod === "external_link" && !supplierCodeUrl) {
    return send(res, 400, { success: false, error: "external_code_url_required" });
  }
  if (codeFetchMethod === "external_link" && normalizeOptionalHttpUrl(supplierCodeUrl) === undefined) {
    return send(res, 400, { success: false, error: "invalid_external_code_url" });
  }
  const updatePayload = {
    email,
    password: passwordToSave,
    supplier_code_url: supplierCodeUrl,
  };

  if (hasCodeFetchMethod) {
    updatePayload.code_fetch_method = codeFetchMethod;
    updatePayload.use_automated_code = codeFetchMethod !== "external_link";
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "compensation_tutorial_url")) {
    const tutorialUrl = normalizeOptionalHttpUrl(req.body?.compensation_tutorial_url);
    if (tutorialUrl === undefined) {
      return send(res, 400, { success: false, error: "invalid_compensation_tutorial_url" });
    }
    updatePayload.compensation_tutorial_url = tutorialUrl;
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "is_reported_closed")) {
    const isReportedClosed = req.body.is_reported_closed === true;
    updatePayload.is_reported_closed = isReportedClosed;
    updatePayload.reported_closed_at = isReportedClosed ? new Date().toISOString() : null;
  }

  if (req.body?.created_at) updatePayload.created_at = req.body.created_at;
  if (req.body?.expires_at) updatePayload.expires_at = req.body.expires_at;

  const { data: updatedAccount, error: accountUpdateError } = await supabase
    .from("accounts")
    .update(updatePayload)
    .eq("id", accountId)
    .select("*")
    .maybeSingle();

  if (accountUpdateError) {
    console.error("Account update failed:", accountUpdateError);
    const duplicate = accountUpdateError.code === "23505";
    return send(res, duplicate ? 409 : 500, {
      success: false,
      error: duplicate ? "duplicate_email" : "account_update_failed",
    });
  }
  if (!updatedAccount) {
    return send(res, 409, { success: false, error: "account_update_returned_no_row" });
  }

  const emailChanged = normalizeEmail(existingAccount.email) !== email;
  const linksQuery = supabase
    .from("customer_links")
    .select("*")
    .eq("account_id", accountId);
  const { data: updatedLinks, error: linksUpdateError } = emailChanged
    ? await supabase
        .from("customer_links")
        .update({ email })
        .eq("account_id", accountId)
        .select("*")
    : await linksQuery;

  if (linksUpdateError) {
    console.error("Customer link email update failed:", linksUpdateError);
    await supabase
      .from("accounts")
      .update({
        email: existingAccount.email,
        password: existingAccount.password,
        supplier_code_url: existingAccount.supplier_code_url,
        code_fetch_method: existingAccount.code_fetch_method,
        use_automated_code: existingAccount.use_automated_code,
        compensation_tutorial_url: existingAccount.compensation_tutorial_url,
        is_reported_closed: existingAccount.is_reported_closed,
        reported_closed_at: existingAccount.reported_closed_at,
        created_at: existingAccount.created_at,
        expires_at: existingAccount.expires_at,
      })
      .eq("id", accountId);
    return send(res, 500, { success: false, error: "customer_links_update_failed" });
  }

  return send(res, 200, {
    success: true,
    account: updatedAccount,
    links: updatedLinks || [],
  });
}

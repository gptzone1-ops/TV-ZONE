import { createClient } from "@supabase/supabase-js";
import { encryptImapPassword } from "./_imap-crypto.js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const adminPassword = process.env.ADMIN_PASSWORD || process.env.VITE_ADMIN_PASSWORD || "Net123213Net@";

function send(res, status, payload) {
  return res.status(status).json(payload);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { success: false, error: "method_not_allowed" });
  if (req.headers["x-admin-password"] !== adminPassword) {
    return send(res, 401, { success: false, error: "unauthorized" });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return send(res, 500, { success: false, error: "supabase_not_configured" });
  }

  const accountId = String(req.body?.account_id || "").trim();
  const appPassword = String(req.body?.app_password || "").replace(/\s+/g, "");
  if (!accountId || !/^[A-Za-z0-9]{16}$/.test(appPassword)) {
    return send(res, 400, { success: false, error: "invalid_imap_credentials" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id,account_type")
      .eq("id", accountId)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account || account.account_type === "temporary" || account.account_type === "compensation") {
      return send(res, 400, { success: false, error: "imap_not_allowed" });
    }

    const encrypted = encryptImapPassword(appPassword);
    const { error: credentialError } = await supabase
      .from("account_imap_credentials")
      .upsert({
        account_id: accountId,
        provider: "outlook",
        ...encrypted,
        updated_at: new Date().toISOString(),
      }, { onConflict: "account_id" });
    if (credentialError) throw credentialError;

    const { error: enableError } = await supabase
      .from("accounts")
      .update({ email_provider: "outlook", imap_enabled: true })
      .eq("id", accountId);
    if (enableError) throw enableError;

    return send(res, 200, { success: true });
  } catch (error) {
    console.error("Save IMAP credential failed:", error);
    return send(res, 500, { success: false, error: "imap_credential_save_failed" });
  }
}

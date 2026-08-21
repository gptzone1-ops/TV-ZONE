import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  return res.status(status).json(payload);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return send(res, 405, { success: false, error: "method_not_allowed" });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return send(res, 500, { success: false, error: "supabase_not_configured" });
  }

  const linkId = String(req.body?.link_id || "").trim();
  if (!linkId) return send(res, 400, { success: false, error: "invalid_link" });

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: link, error: linkError } = await supabase
      .from("customer_links")
      .select("id,account_id,accounts!inner(id,email,service_type,osn_subscription_mode)")
      .eq("id", linkId)
      .maybeSingle();

    if (linkError) throw linkError;
    const account = Array.isArray(link?.accounts) ? link.accounts[0] : link?.accounts;
    if (!link || account?.service_type !== "osn" || account?.osn_subscription_mode !== "auto_otp") {
      return send(res, 404, { success: false, error: "auto_otp_link_not_found" });
    }

    const email = String(account.email || "").trim().toLowerCase();
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: otp, error: otpError } = await supabase
      .from("osn_codes")
      .select("code,updated_at")
      .ilike("email", email)
      .gte("updated_at", cutoff)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpError) throw otpError;
    const code = String(otp?.code || "").replace(/\s+/g, "");
    if (!/^\d{4}$/.test(code)) {
      return send(res, 200, { success: false, pending: true });
    }

    return send(res, 200, {
      success: true,
      code,
      updated_at: otp.updated_at,
    });
  } catch (error) {
    console.error("OSN OTP lookup failed:", error);
    return send(res, 500, { success: false, error: "osn_code_lookup_failed" });
  }
}

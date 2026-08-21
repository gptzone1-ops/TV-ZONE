import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const osnMonthlyAutoOtpLaunchAt = "2026-08-21T03:21:29.272Z";

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
  const phase = String(req.body?.phase || "fresh").trim().toLowerCase();
  if (!linkId) return send(res, 400, { success: false, error: "invalid_link" });
  if (!['fresh', 'fallback'].includes(phase)) {
    return send(res, 400, { success: false, error: "invalid_search_phase" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: link, error: linkError } = await supabase
      .from("customer_links")
      .select("id,account_id,code_request_limit,code_requested_count,accounts!inner(id,email,service_type,osn_subscription_mode,created_at)")
      .eq("id", linkId)
      .maybeSingle();

    if (linkError) throw linkError;
    const account = Array.isArray(link?.accounts) ? link.accounts[0] : link?.accounts;
    const accountCreatedAtMs = Date.parse(account?.created_at || "");
    if (
      !link ||
      account?.service_type !== "osn" ||
      account?.osn_subscription_mode !== "monthly_rotation" ||
      !Number.isFinite(accountCreatedAtMs) ||
      accountCreatedAtMs < Date.parse(osnMonthlyAutoOtpLaunchAt)
    ) {
      return send(res, 404, { success: false, error: "auto_otp_link_not_found" });
    }

    const requestLimit = Math.max(0, Number(link.code_request_limit ?? 1));
    const requestedCount = Math.max(0, Number(link.code_requested_count ?? 0));
    if (requestedCount >= requestLimit) {
      return send(res, 409, {
        success: false,
        error: "osn_otp_credit_exhausted",
        credit_remaining: 0,
      });
    }

    // During polling, only a just-arrived code can end the search early. The
    // five-minute fallback is intentionally checked once after all 15 seconds.
    const maxAgeSeconds = phase === "fallback" ? 5 * 60 : 90;
    const cutoff = new Date(Date.now() - maxAgeSeconds * 1000).toISOString();
    const { data: otpRows, error: otpError } = await supabase.rpc(
      "get_latest_customer_message",
      {
        p_customer_link_id: linkId,
        p_message_type: "code",
        p_since: cutoff,
      },
    );

    if (otpError) throw otpError;
    const otp = Array.isArray(otpRows) ? otpRows[0] : otpRows;
    if (!otp?.id) {
      return send(res, 200, { success: false, pending: true });
    }

    const { data: consumedRows, error: consumeError } = await supabase.rpc(
      "consume_customer_message",
      {
        p_message_id: otp.id,
        p_customer_link_id: linkId,
        p_used_at: new Date().toISOString(),
      },
    );
    if (consumeError) throw consumeError;

    const consumed = Array.isArray(consumedRows) ? consumedRows[0] : consumedRows;
    const code = String(consumed?.code || "").replace(/\s+/g, "");
    if (!/^\d{4}$/.test(code)) {
      return send(res, 200, { success: false, pending: true });
    }

    return send(res, 200, {
      success: true,
      code,
      updated_at: consumed.received_at,
      credit_remaining: 0,
    });
  } catch (error) {
    console.error("OSN OTP lookup failed:", error);
    return send(res, 500, { success: false, error: "osn_code_lookup_failed" });
  }
}

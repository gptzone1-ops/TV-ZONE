import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const adminPassword = process.env.ADMIN_PASSWORD || process.env.VITE_ADMIN_PASSWORD || "Net123213Net@";

function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store");
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
  if (!accountId) return send(res, 400, { success: false, error: "account_id_required" });

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: links, error: rotationError } = await supabase.rpc("rotate_osn_monthly_cycle", {
    p_account_id: accountId,
  });

  if (rotationError) {
    console.error("OSN monthly cycle rotation failed:", rotationError);
    const message = String(rotationError.message || "rotation_failed");
    const knownConflict = /current_cycle_not_finished|all_monthly_cycles_completed|account_expired|not_osn_monthly_rotation/i.test(message);
    return send(res, knownConflict ? 409 : 500, { success: false, error: message });
  }

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();

  if (accountError || !account) {
    console.error("Rotated OSN account reload failed:", accountError);
    return send(res, 500, { success: false, error: "account_reload_failed" });
  }

  const expectedCount = account.account_type === "private" ? 5 : 10;
  if (!Array.isArray(links) || links.length !== expectedCount) {
    return send(res, 500, { success: false, error: "invalid_generated_links_count" });
  }

  return send(res, 200, { success: true, account, links });
}

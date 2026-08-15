import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const adminPassword = process.env.ADMIN_PASSWORD || process.env.VITE_ADMIN_PASSWORD || "Gpt123Gpt@@";

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

  const linkId = String(req.body?.link_id || "").trim();
  if (!linkId) return send(res, 400, { success: false, error: "invalid_link_id" });

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from("customer_links")
    .update({ external_code_used: false, external_code_used_at: null })
    .eq("id", linkId)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("External code access reset failed:", error);
    return send(res, 500, { success: false, error: "reset_failed" });
  }
  if (!data) return send(res, 404, { success: false, error: "customer_link_not_found" });
  return send(res, 200, { success: true, link: data });
}

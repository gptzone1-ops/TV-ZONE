import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const adminPassword = process.env.ADMIN_PASSWORD || process.env.VITE_ADMIN_PASSWORD || "Gpt123Gpt@@";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "method_not_allowed" });
  }

  if (req.headers["x-admin-password"] !== adminPassword) {
    return res.status(401).json({ success: false, error: "unauthorized" });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ success: false, error: "supabase_not_configured" });
  }

  const requestId = String(req.body?.request_id || "").trim();
  const status = String(req.body?.status || "").trim();
  if (!requestId || !["approved", "rejected"].includes(status)) {
    return res.status(400).json({ success: false, error: "invalid_request" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("review_extra_credit_request", {
    p_request_id: requestId,
    p_status: status,
  });

  if (error) {
    console.error("Extra credit request review failed:", error);
    return res.status(500).json({ success: false, error: "review_failed" });
  }

  if (!data) {
    return res.status(409).json({ success: false, error: "request_already_reviewed" });
  }

  return res.status(200).json({ success: true });
}

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const adminPassword = process.env.ADMIN_PASSWORD || process.env.VITE_ADMIN_PASSWORD || "Gpt123Gpt@@";

function send(res, status, payload) {
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
  const email = String(req.body?.email || "").trim().toLowerCase();
  const links = Array.isArray(req.body?.links) ? req.body.links : null;

  if (!accountId || !email || !links) {
    return send(res, 400, { success: false, error: "invalid_payload" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("create_strict_customer_links", {
    p_account_id: accountId,
    p_email: email,
    p_links: links,
  });

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
  if (createdLinks.length !== 5 && createdLinks.length !== 8) {
    console.error("Strict customer link creation returned an invalid count:", createdLinks.length);
    return send(res, 500, { success: false, error: "invalid_generated_links_count" });
  }

  return send(res, 200, { success: true, links: createdLinks });
}

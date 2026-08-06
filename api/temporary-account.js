import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

function send(res, status, payload) {
  return res.status(status).json(payload);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    return send(res, 405, { success: false, error: "method_not_allowed" });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return send(res, 500, { success: false, error: "supabase_not_configured" });
  }

  const identifier = String(req.body?.id || "").trim();
  if (!/^[A-Za-z0-9]{6,10}$/.test(identifier)) {
    return send(res, 400, { success: false, error: "invalid_identifier" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data, error } = await supabase
      .from("accounts")
      .select("email,password")
      .eq("account_type", "temporary")
      .eq("temporary_short_id", identifier)
      .maybeSingle();

    if (error) {
      console.error("Temporary account lookup failed:", error);
      return send(res, 500, { success: false, error: "lookup_failed" });
    }
    if (!data) return send(res, 404, { success: false, error: "not_found" });

    return send(res, 200, {
      success: true,
      account: { email: data.email, password: data.password },
    });
  } catch (error) {
    console.error("Temporary account endpoint failed:", error);
    return send(res, 500, { success: false, error: "unexpected_error" });
  }
}

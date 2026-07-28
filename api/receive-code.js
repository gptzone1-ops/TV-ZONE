import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const jsonHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function send(res, status, body) {
  Object.entries(jsonHeaders).forEach(([key, value]) => res.setHeader(key, value));
  return res.status(status).json(body);
}

function readBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    Object.entries(jsonHeaders).forEach(([key, value]) => res.setHeader(key, value));
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return send(res, 405, { success: false, error: "method_not_allowed" });
  }

  if (!supabaseUrl || !supabaseKey) {
    return send(res, 500, { success: false, error: "supabase_not_configured" });
  }

  const body = readBody(req.body);
  const email = String(body.email || "").trim().toLowerCase();
  const code = String(body.code || "").trim();
  const createdAt = body.created_at ? new Date(body.created_at) : new Date();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return send(res, 400, { success: false, error: "invalid_email" });
  }

  if (!/^\d{4}$/.test(code)) {
    return send(res, 400, { success: false, error: "invalid_code" });
  }

  if (Number.isNaN(createdAt.getTime())) {
    return send(res, 400, { success: false, error: "invalid_created_at" });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: customerLink, error: findError } = await supabase
    .from("customer_links")
    .select("id,account_id,email")
    .ilike("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) {
    console.error("Supabase customer_links lookup error:", findError);
    return send(res, 500, { success: false, error: "account_lookup_failed" });
  }

  if (!customerLink) {
    return send(res, 404, { success: false, error: "account_not_found" });
  }

  const { error: updateError } = await supabase
    .from("customer_links")
    .update({
      verification_code: code,
      verification_code_received_at: createdAt.toISOString(),
    })
    .eq("id", customerLink.id);

  if (updateError) {
    console.error("Supabase customer_links update error:", updateError);
    return send(res, 500, { success: false, error: "code_save_failed" });
  }

  return send(res, 200, { success: true });
}

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(payload);
}

function validExternalUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { success: false, error: "method_not_allowed" });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return send(res, 503, { success: false, error: "service_unavailable" });
  }

  const identifier = String(req.body?.link_id || req.body?.code || "").trim();
  if (!identifier) return send(res, 400, { success: false, error: "invalid_link_id" });

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let lookupQuery = supabase
    .from("customer_links")
    .select("id,external_code_used,accounts!inner(service_type,account_type,code_fetch_method,supplier_code_url)");

  lookupQuery = uuidPattern.test(identifier)
    ? lookupQuery.eq("id", identifier)
    : lookupQuery.ilike("short_id", identifier);

  const { data: customerLink, error: lookupError } = await lookupQuery.maybeSingle();
  if (lookupError) {
    console.error("External code access lookup failed:", lookupError);
    return send(res, 500, { success: false, error: "lookup_failed" });
  }
  if (!customerLink) return send(res, 404, { success: false, error: "customer_link_not_found" });
  if (customerLink.external_code_used === true) {
    return send(res, 410, { success: false, error: "external_code_already_used" });
  }

  const account = Array.isArray(customerLink.accounts) ? customerLink.accounts[0] : customerLink.accounts;
  const supportedAccountType = account?.account_type === "private" || account?.account_type === "shared";
  const externalUrl = account?.service_type === "netflix" && supportedAccountType && account?.code_fetch_method === "external_link"
    ? validExternalUrl(account?.supplier_code_url)
    : null;
  if (!externalUrl) {
    return send(res, 409, { success: false, error: "external_code_not_enabled" });
  }

  const usedAt = new Date().toISOString();
  const { data: claimedLink, error: claimError } = await supabase
    .from("customer_links")
    .update({ external_code_used: true, external_code_used_at: usedAt })
    .eq("id", customerLink.id)
    .eq("external_code_used", false)
    .select("id")
    .maybeSingle();

  if (claimError) {
    console.error("External code access claim failed:", claimError);
    return send(res, 500, { success: false, error: "claim_failed" });
  }
  if (!claimedLink) {
    return send(res, 410, { success: false, error: "external_code_already_used" });
  }

  return send(res, 200, {
    success: true,
    external_url: externalUrl,
    used_at: usedAt,
  });
}

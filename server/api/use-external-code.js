import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const accessDurationMs = 30 * 60 * 1000;

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

function validTimestamp(value) {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { success: false, error: "method_not_allowed" });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return send(res, 503, { success: false, error: "service_unavailable" });
  }

  const identifier = String(req.body?.link_id || req.body?.codeId || req.body?.code || "").trim();
  const requestedMode = String(req.body?.mode || "start");
  const mode = requestedMode === "expire" || requestedMode === "status" ? requestedMode : "start";
  if (!identifier) return send(res, 400, { success: false, error: "invalid_link_id" });

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let lookupQuery = supabase
    .from("customer_links")
    .select("id,account_id,is_active,external_code_used,external_code_first_opened_at");
  lookupQuery = uuidPattern.test(identifier)
    ? lookupQuery.eq("id", identifier)
    : lookupQuery.ilike("short_id", identifier);

  const { data: customerLink, error: lookupError } = await lookupQuery.maybeSingle();
  if (lookupError) {
    console.error("External code access lookup failed:", lookupError);
    return send(res, 500, { success: false, error: "lookup_failed" });
  }
  if (!customerLink) return send(res, 404, { success: false, error: "customer_link_not_found" });
  if (customerLink.is_active === false) {
    return send(res, 410, { success: false, error: "customer_link_expired" });
  }
  if (customerLink.external_code_used === true) {
    return send(res, 410, { success: false, error: "external_code_expired" });
  }

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", customerLink.account_id)
    .maybeSingle();
  if (accountError) {
    console.error("External code account lookup failed:", accountError);
    return send(res, 500, { success: false, error: "account_lookup_failed" });
  }
  if (!account) return send(res, 404, { success: false, error: "account_not_found" });

  const serviceType = String(account.service_type || "netflix").trim().toLowerCase();
  const accountType = String(account.account_type || "").trim().toLowerCase();
  const supportedAccountType = accountType === "private" || accountType === "shared";
  const configuredUrl = account.supplier_code_url || account.external_link || account.external_code_url || account.code_fetch_url;
  const externalUrl = serviceType === "netflix" && supportedAccountType ? validExternalUrl(configuredUrl) : null;
  if (!externalUrl) return send(res, 409, { success: false, error: "external_code_not_enabled" });

  const nowMs = Date.now();
  const existingFirstOpenedMs = validTimestamp(customerLink.external_code_first_opened_at);
  let firstOpenedAt = existingFirstOpenedMs ? new Date(existingFirstOpenedMs).toISOString() : null;

  if (!firstOpenedAt && mode === "start") {
    const serverStartedAt = new Date(nowMs).toISOString();
    const { data: startedLink, error: startError } = await supabase
      .from("customer_links")
      .update({ external_code_first_opened_at: serverStartedAt })
      .eq("id", customerLink.id)
      .or("external_code_used.eq.false,external_code_used.is.null")
      .is("external_code_first_opened_at", null)
      .select("external_code_first_opened_at")
      .maybeSingle();
    if (startError) {
      console.error("External code timer start failed:", startError);
      return send(res, 500, { success: false, error: "timer_start_failed" });
    }
    firstOpenedAt = startedLink?.external_code_first_opened_at || null;
    if (!firstOpenedAt) {
      const { data: refreshedLink, error: refreshError } = await supabase
        .from("customer_links")
        .select("external_code_used,external_code_first_opened_at")
        .eq("id", customerLink.id)
        .maybeSingle();
      if (refreshError) {
        console.error("External code timer refresh failed:", refreshError);
        return send(res, 500, { success: false, error: "timer_refresh_failed" });
      }
      if (refreshedLink?.external_code_used === true) {
        return send(res, 410, { success: false, error: "external_code_expired" });
      }
      firstOpenedAt = refreshedLink?.external_code_first_opened_at || null;
    }
  }

  const firstOpenedMs = validTimestamp(firstOpenedAt);
  if (!firstOpenedMs) {
    if (mode === "status") {
      return send(res, 200, {
        success: true,
        available: true,
        first_opened_at: null,
        expires_at: null,
        remaining_seconds: null,
      });
    }
    return send(res, 409, { success: false, error: "external_code_not_started" });
  }

  const expiresAtMs = firstOpenedMs + accessDurationMs;
  const expired = nowMs >= expiresAtMs;
  if (expired || mode === "expire") {
    if (!expired) {
      return send(res, 409, {
        success: false,
        error: "external_code_still_active",
        expires_at: new Date(expiresAtMs).toISOString(),
      });
    }
    const usedAt = new Date(nowMs).toISOString();
    const { error: expireError } = await supabase
      .from("customer_links")
      .update({ external_code_used: true, external_code_used_at: usedAt })
      .eq("id", customerLink.id);
    if (expireError) {
      console.error("External code expiry update failed:", expireError);
      return send(res, 500, { success: false, error: "expiry_update_failed" });
    }
    return send(res, 410, { success: false, error: "external_code_expired", expired_at: usedAt });
  }

  return send(res, 200, {
    success: true,
    url: externalUrl,
    first_opened_at: new Date(firstOpenedMs).toISOString(),
    expires_at: new Date(expiresAtMs).toISOString(),
    remaining_seconds: Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000)),
  });
}

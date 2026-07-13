import { createClient } from "@supabase/supabase-js";

export const config = { maxDuration: 30 };

const REQUEST_DELAY_MS = 15_000;
const SUPPLIER_TIMEOUT_MS = 4_500;
const STALE_PENDING_MS = 45_000;
const MAX_HTML_BYTES = 2_000_000;

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
}

function parseBody(req) {
  if (typeof req.body === "string") return JSON.parse(req.body);
  return req.body || {};
}

function allowedHosts() {
  return (process.env.OTP_ALLOWED_HOSTS || "code.tvleb.com")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

function normalizeSupplierUrl(value, base) {
  const raw = String(value || "").trim();
  const candidate = base ? new URL(raw, base) : new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);

  if (candidate.protocol !== "https:" || candidate.username || candidate.password || isPrivateHost(candidate.hostname)) {
    throw new Error("supplier_url_not_allowed");
  }

  const hostname = candidate.hostname.toLowerCase();
  const allowed = allowedHosts().some((host) => hostname === host || hostname.endsWith(`.${host}`));
  if (!allowed) throw new Error("supplier_url_not_allowed");

  candidate.hash = "";
  return candidate;
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

export function extractSignInCode(html) {
  const text = decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--([\s\S]*?)-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  );

  const patterns = [
    /sign\s*in\s*code[^0-9]{0,180}(\d{4})(?!\d)/i,
    /(\d{4})(?!\d)[^0-9a-z]{0,180}sign\s*in\s*code/i,
    /(?:verification|login|otp)\s*code[^0-9]{0,180}(\d{4})(?!\d)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

async function fetchSupplierHtml(initialUrl) {
  let currentUrl = normalizeSupplierUrl(initialUrl);
  const deadline = Date.now() + SUPPLIER_TIMEOUT_MS;

  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const remainingTime = deadline - Date.now();
    if (remainingTime <= 0) throw new Error("supplier_request_failed");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingTime);

    try {
      const response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "ZoneStore-OTP/1.0",
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("supplier_redirect_failed");
        currentUrl = normalizeSupplierUrl(location, currentUrl);
        continue;
      }

      if (!response.ok) throw new Error("supplier_request_failed");

      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > MAX_HTML_BYTES) throw new Error("supplier_response_too_large");

      const html = await response.text();
      if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) throw new Error("supplier_response_too_large");
      return html;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("supplier_too_many_redirects");
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "method_not_allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return send(res, 503, { error: "server_not_configured" });

  let body;
  try {
    body = parseBody(req);
  } catch {
    return send(res, 400, { error: "invalid_json" });
  }

  const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
  const linkId = typeof body.linkId === "string" ? body.linkId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(accountId) || !/^[0-9a-f-]{36}$/i.test(linkId)) {
    return send(res, 400, { error: "invalid_input" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [{ data: link, error: linkError }, { data: account, error: accountError }] = await Promise.all([
    supabase
      .from("customer_links")
      .select("id, account_id, otp_status, otp_requested_at")
      .eq("id", linkId)
      .eq("account_id", accountId)
      .maybeSingle(),
    supabase
      .from("accounts")
      .select("id, service_type, supplier_code_url")
      .eq("id", accountId)
      .maybeSingle(),
  ]);

  if (linkError || accountError || !link || !account) return send(res, 404, { error: "subscription_not_found" });
  if (account.service_type === "shahid") return send(res, 400, { error: "netflix_only" });
  if (!account.supplier_code_url) return send(res, 422, { error: "supplier_url_missing" });
  if (link.otp_status === "used") return send(res, 409, { error: "already_used" });

  if (link.otp_status === "pending") {
    const requestedAt = link.otp_requested_at ? new Date(link.otp_requested_at).getTime() : Date.now();
    if (Date.now() - requestedAt < STALE_PENDING_MS) return send(res, 409, { error: "request_pending" });

    const resetQuery = supabase
      .from("customer_links")
      .update({ otp_status: "not_requested", otp_requested_at: null })
      .eq("id", linkId)
      .eq("otp_status", "pending");
    const { error: resetError } = link.otp_requested_at
      ? await resetQuery.eq("otp_requested_at", link.otp_requested_at)
      : await resetQuery.is("otp_requested_at", null);
    if (resetError) return send(res, 500, { error: "otp_state_failed" });
  }

  const requestedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("customer_links")
    .update({ otp_status: "pending", otp_requested_at: requestedAt, otp_used_at: null })
    .eq("id", linkId)
    .eq("account_id", accountId)
    .eq("otp_status", "not_requested")
    .select("id")
    .maybeSingle();

  if (claimError) return send(res, 500, { error: "otp_state_failed" });
  if (!claimed) return send(res, 409, { error: "request_pending" });

  async function resetClaim() {
    await supabase
      .from("customer_links")
      .update({ otp_status: "not_requested", otp_requested_at: null })
      .eq("id", linkId)
      .eq("otp_status", "pending")
      .eq("otp_requested_at", requestedAt);
  }

  try {
    await wait(REQUEST_DELAY_MS);
    const html = await fetchSupplierHtml(account.supplier_code_url);
    const code = extractSignInCode(html);
    if (!code) throw new Error("code_not_found");

    const { data: consumed, error: consumeError } = await supabase
      .from("customer_links")
      .update({ otp_status: "used", otp_used_at: new Date().toISOString() })
      .eq("id", linkId)
      .eq("otp_status", "pending")
      .eq("otp_requested_at", requestedAt)
      .select("id")
      .maybeSingle();

    if (consumeError || !consumed) throw new Error("otp_state_failed");
    return send(res, 200, { code, expiresIn: 60 });
  } catch (error) {
    await resetClaim();
    const reason = error instanceof Error ? error.message : "otp_fetch_failed";
    const publicError = reason === "supplier_url_not_allowed" ? reason : reason === "code_not_found" ? reason : "otp_fetch_failed";
    return send(res, 502, { error: publicError });
  }
}

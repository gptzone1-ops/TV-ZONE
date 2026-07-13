import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
}

function sameSecret(received, expected) {
  if (!received || !expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseBody(req) {
  if (typeof req.body === "string") return JSON.parse(req.body);
  return req.body || {};
}

function normalizeSupplierUrl(value) {
  const raw = String(value || "").trim();
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid_supplier_url");

  const hostname = url.hostname.toLowerCase();
  const allowedHosts = (process.env.OTP_ALLOWED_HOSTS || "code.tvleb.com")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (!allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    throw new Error("invalid_supplier_url");
  }

  url.hash = "";
  return url.toString();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "method_not_allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminPassword = process.env.ADMIN_PASSWORD || process.env.VITE_ADMIN_PASSWORD;

  if (!supabaseUrl || !serviceRoleKey || !adminPassword) {
    return send(res, 503, { error: "server_not_configured" });
  }

  if (!sameSecret(req.headers["x-admin-password"], adminPassword)) {
    return send(res, 401, { error: "unauthorized" });
  }

  let body;
  try {
    body = parseBody(req);
  } catch {
    return send(res, 400, { error: "invalid_json" });
  }

  const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
  const supplierCodeUrl = typeof body.supplierCodeUrl === "string" ? body.supplierCodeUrl.trim() : "";

  if (!/^[0-9a-f-]{36}$/i.test(accountId) || !supplierCodeUrl || supplierCodeUrl.length > 2048) {
    return send(res, 400, { error: "invalid_input" });
  }

  let normalizedSupplierCodeUrl;
  try {
    normalizedSupplierCodeUrl = normalizeSupplierUrl(supplierCodeUrl);
  } catch {
    return send(res, 400, { error: "invalid_supplier_url" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("id, service_type")
    .eq("id", accountId)
    .maybeSingle();

  if (accountError || !account) return send(res, 404, { error: "account_not_found" });
  if (account.service_type === "shahid") return send(res, 400, { error: "netflix_only" });

  const { error } = await supabase
    .from("accounts")
    .update({ supplier_code_url: normalizedSupplierCodeUrl })
    .eq("id", accountId);

  if (error) return send(res, 500, { error: "save_failed" });
  return send(res, 200, { ok: true });
}

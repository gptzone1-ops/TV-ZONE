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

const netflixTvLinkPattern = /https?:\/\/(?:www\.)?netflix\.com\/ilum\?code=[\w-]+/i;
const validEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function normalizeEmail(value) {
  return String(value || "").trim().replace(/^mailto:/i, "").toLowerCase();
}

function uniqueValidEmails(values) {
  return [...new Set(values.map(normalizeEmail).filter((email) => validEmailPattern.test(email)))].slice(0, 50);
}

async function findLinksForEmail(supabase, email) {
  const { data: directLinks, error: directError } = await supabase
    .from("customer_links")
    .select("id,account_id,email")
    .ilike("email", email);

  if (!directError && directLinks?.length) return directLinks;
  if (directError) console.error("Direct customer link lookup failed:", directError);

  const { data: relatedLinks, error: relationError } = await supabase
    .from("customer_links")
    .select("id,account_id,accounts!inner(id,email)")
    .ilike("accounts.email", email);

  if (!relationError && relatedLinks?.length) return relatedLinks;
  if (relationError) console.error("Customer link relation lookup failed:", relationError);

  const { data: accounts, error: accountError } = await supabase
    .from("accounts")
    .select("id,email")
    .ilike("email", email);

  if (accountError) throw accountError;
  const accountIds = (accounts || []).map((account) => account.id).filter(Boolean);
  if (!accountIds.length) return [];

  const { data: fallbackLinks, error: fallbackError } = await supabase
    .from("customer_links")
    .select("id,account_id,email")
    .in("account_id", accountIds);

  if (fallbackError) throw fallbackError;
  return fallbackLinks || [];
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    Object.entries(jsonHeaders).forEach(([key, value]) => res.setHeader(key, value));
    return res.status(204).end();
  }

  if (req.method !== "POST") return send(res, 405, { success: false, error: "method_not_allowed" });
  if (!supabaseUrl || !supabaseKey) return send(res, 500, { success: false, error: "supabase_not_configured" });

  const configuredSecret = String(process.env.RECEIVE_CODE_WEBHOOK_SECRET || "").trim();
  if (configuredSecret && req.headers.authorization !== `Bearer ${configuredSecret}`) {
    return send(res, 401, { success: false, error: "unauthorized_webhook" });
  }

  const body = readBody(req.body);
  const incomingServiceType = String(body.service_type || body.service || "netflix").trim().toLowerCase();
  const rawAccountEmail = String(body.accountEmail || body.account_email || "").trim();
  const accountEmail = normalizeEmail(rawAccountEmail);
  const hasAccountEmail = rawAccountEmail.length > 0;

  if (hasAccountEmail && !validEmailPattern.test(accountEmail)) {
    return send(res, 400, { success: false, error: "invalid_account_email" });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // OSN auto OTP is an explicit new payload mode. Legacy Netflix payloads do
  // not include service_type=osn and continue through the unchanged path below.
  if (incomingServiceType === "osn") {
    const code = String(body.code || "").replace(/\s+/g, "").trim();
    if (!hasAccountEmail || !validEmailPattern.test(accountEmail)) {
      return send(res, 400, { success: false, error: "invalid_account_email" });
    }
    if (!/^\d{4}$/.test(code)) {
      return send(res, 400, { success: false, error: "invalid_osn_code" });
    }

    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id,email")
      .ilike("email", accountEmail)
      .eq("service_type", "osn")
      .eq("osn_subscription_mode", "auto_otp")
      .limit(1)
      .maybeSingle();

    if (accountError) {
      console.error("OSN auto OTP account lookup failed:", accountError);
      return send(res, 500, { success: false, error: "osn_account_lookup_failed" });
    }
    if (!account) {
      return send(res, 404, { success: false, error: "osn_auto_otp_account_not_found" });
    }

    const receivedAt = new Date().toISOString();
    const { error: saveError } = await supabase
      .from("osn_codes")
      .upsert({ email: accountEmail, code, updated_at: receivedAt }, { onConflict: "email" });

    if (saveError) {
      console.error("OSN auto OTP save failed:", saveError);
      return send(res, 500, { success: false, error: "osn_code_save_failed" });
    }

    return send(res, 200, {
      success: true,
      service_type: "osn",
      account_email: accountEmail,
      code_saved: true,
      updated_at: receivedAt,
    });
  }

  // New Cloudflare payloads are matched strictly by accountEmail. Legacy payloads
  // keep the previous email/candidate fallback without changing old records.
  const candidates = hasAccountEmail
    ? [accountEmail]
    : uniqueValidEmails([
      body.email,
      body.original_email,
      ...(Array.isArray(body.original_email_candidates) ? body.original_email_candidates : []),
      body.forwarded_to,
    ]);
  const code = String(body.code || "").replace(/\s+/g, "").trim();
  const rawEmail = String(body.raw_email || body.rawEmail || "");
  const explicitTvApprovalUrl = String(body.tv_approval_url || "").trim();
  const tvApprovalUrl = explicitTvApprovalUrl || rawEmail.match(netflixTvLinkPattern)?.[0] || "";
  const createdAt = body.created_at ? new Date(body.created_at) : new Date();
  const sourceKey = String(body.source_key || "").trim().slice(0, 500);

  if (!candidates.length) return send(res, 400, { success: false, error: "invalid_email" });
  if (code && !/^\d{4,6}$/.test(code)) return send(res, 400, { success: false, error: "invalid_code" });
  if (tvApprovalUrl && !netflixTvLinkPattern.test(tvApprovalUrl)) {
    return send(res, 400, { success: false, error: "invalid_tv_approval_url" });
  }
  if (!code && !tvApprovalUrl) {
    return send(res, 400, { success: false, error: "missing_code_or_tv_approval_url" });
  }
  if (Number.isNaN(createdAt.getTime())) return send(res, 400, { success: false, error: "invalid_created_at" });

  let matchingLinks = [];
  let matchedEmail = "";

  try {
    for (const candidate of candidates) {
      const links = await findLinksForEmail(supabase, candidate);
      if (links.length) {
        matchingLinks = links;
        matchedEmail = candidate;
        break;
      }
    }
  } catch (error) {
    console.error("Forwarded email account matching failed:", error);
    return send(res, 500, { success: false, error: "customer_link_lookup_failed" });
  }

  if (!matchingLinks.length) {
    console.warn("No account matched forwarded email candidates:", candidates);
    return send(res, 404, { success: false, error: "customer_link_not_found", candidates });
  }

  const accountIds = [...new Set(matchingLinks.map((link) => link.account_id).filter(Boolean))];
  const linkIds = matchingLinks.map((link) => link.id).filter(Boolean);
  const receivedAt = createdAt.toISOString();
  const baseSourceKey = sourceKey || `${matchedEmail}:${receivedAt}`;
  const messageRows = [];

  if (code) {
    messageRows.push({
      email: matchedEmail,
      message_type: "code",
      code,
      received_at: receivedAt,
      is_used: false,
      source_key: `${baseSourceKey}:code`,
    });
  }
  if (tvApprovalUrl) {
    messageRows.push({
      email: matchedEmail,
      message_type: "tv_approval_url",
      tv_approval_url: tvApprovalUrl,
      received_at: receivedAt,
      is_used: false,
      source_key: `${baseSourceKey}:tv`,
    });
  }

  const cleanupCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { error: cleanupError } = await supabase
    .from("verification_messages")
    .delete()
    .eq("is_used", false)
    .lt("received_at", cleanupCutoff);
  if (cleanupError) console.error("Old verification message cleanup failed:", cleanupError);

  const messageSourceKeys = messageRows.map((row) => row.source_key);
  const { data: existingMessages, error: duplicateLookupError } = await supabase
    .from("verification_messages")
    .select("id,message_type,source_key")
    .in("source_key", messageSourceKeys);
  if (duplicateLookupError) {
    console.error("Verification message duplicate lookup failed:", duplicateLookupError);
    return send(res, 500, { success: false, error: "verification_message_save_failed" });
  }

  const existingSourceKeys = new Set((existingMessages || []).map((message) => message.source_key));
  const newMessageRows = messageRows.filter((row) => !existingSourceKeys.has(row.source_key));
  let savedMessages = existingMessages || [];

  if (newMessageRows.length) {
    const { data: insertedMessages, error: messageSaveError } = await supabase
      .from("verification_messages")
      .insert(newMessageRows)
      .select("id,message_type,source_key");

    if (messageSaveError && messageSaveError.code !== "23505") {
      console.error("Verification message save failed:", messageSaveError);
      return send(res, 500, { success: false, error: "verification_message_save_failed" });
    }

    savedMessages = [...savedMessages, ...(insertedMessages || [])];
  }

  if (code) {
    const accountUpdate = accountIds.length
      ? await supabase.from("accounts").update({
        verification_code: code,
        verification_code_received_at: receivedAt,
      }).in("id", accountIds)
      : { error: null };
    if (accountUpdate.error) {
      console.error("Account verification code save failed:", accountUpdate.error);
      return send(res, 500, { success: false, error: "code_save_failed" });
    }

    const linkUpdate = await supabase.from("customer_links").update({
      verification_code: code,
      verification_code_received_at: receivedAt,
    }).in("id", linkIds);
    if (linkUpdate.error) {
      console.error("Customer link verification code save failed:", linkUpdate.error);
      return send(res, 500, { success: false, error: "code_save_failed" });
    }
  }

  if (tvApprovalUrl) {
    const { error: tvLinkSaveError } = await supabase
      .from("customer_links")
      .update({ tv_approval_url: tvApprovalUrl, updated_at: new Date().toISOString() })
      .in("id", linkIds);
    if (tvLinkSaveError) {
      console.error("TV approval URL save failed:", tvLinkSaveError);
      return send(res, 500, { success: false, error: "tv_approval_url_save_failed" });
    }
  }

  return send(res, 200, {
    success: true,
    account_email: matchedEmail,
    used_account_email: hasAccountEmail,
    matched_email: matchedEmail,
    code_saved: Boolean(code),
    tv_approval_url_saved: Boolean(tvApprovalUrl),
    message_ids: (savedMessages || []).map((message) => ({ id: message.id, type: message.message_type })),
    matched_links: matchingLinks.length,
  });
}

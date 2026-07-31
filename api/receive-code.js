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
  const rawEmail = String(body.raw_email || body.rawEmail || "");
  const explicitTvApprovalUrl = String(body.tv_approval_url || "").trim();
  const extractedTvApprovalUrl = rawEmail.match(netflixTvLinkPattern)?.[0] || "";
  const tvApprovalUrl = explicitTvApprovalUrl || extractedTvApprovalUrl;
  const createdAt = body.created_at ? new Date(body.created_at) : new Date();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return send(res, 400, { success: false, error: "invalid_email" });
  }

  if (code && !/^\d{4}$/.test(code)) {
    return send(res, 400, { success: false, error: "invalid_code" });
  }

  if (tvApprovalUrl && !netflixTvLinkPattern.test(tvApprovalUrl)) {
    return send(res, 400, { success: false, error: "invalid_tv_approval_url" });
  }

  if (!code && !tvApprovalUrl) {
    return send(res, 400, { success: false, error: "missing_code_or_tv_approval_url" });
  }

  if (Number.isNaN(createdAt.getTime())) {
    return send(res, 400, { success: false, error: "invalid_created_at" });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let matchingLinks = [];
  const { data: directLinks, error: directLinksError } = await supabase
    .from("customer_links")
    .select("id,account_id,email")
    .ilike("email", email);

  if (!directLinksError && directLinks?.length) {
    matchingLinks = directLinks;
  } else {
    if (directLinksError) {
      console.error("Direct customer link email lookup failed, using relation fallback:", directLinksError);
    }

    const { data: relatedLinks, error: relatedLinksError } = await supabase
      .from("customer_links")
      .select("id,account_id,accounts!inner(id,email)")
      .ilike("accounts.email", email);

    if (!relatedLinksError && relatedLinks?.length) {
      matchingLinks = relatedLinks;
    } else {
      if (relatedLinksError) {
        console.error("Customer link relation lookup failed, using account fallback:", relatedLinksError);
      }

      const { data: matchingAccounts, error: accountLookupError } = await supabase
        .from("accounts")
        .select("id,email")
        .ilike("email", email);

      if (accountLookupError) {
        console.error("Account email fallback lookup failed:", accountLookupError);
        return send(res, 500, { success: false, error: "customer_link_lookup_failed" });
      }

      const accountIds = (matchingAccounts || []).map((account) => account.id);
      if (accountIds.length) {
        const { data: fallbackLinks, error: fallbackLinksError } = await supabase
          .from("customer_links")
          .select("id,account_id")
          .in("account_id", accountIds);

        if (fallbackLinksError) {
          console.error("Customer link fallback lookup failed:", fallbackLinksError);
          return send(res, 500, { success: false, error: "customer_link_lookup_failed" });
        }

        matchingLinks = fallbackLinks || [];
      }
    }
  }

  if (!matchingLinks.length) {
    return send(res, 404, { success: false, error: "customer_link_not_found" });
  }

  const accountIds = [...new Set(matchingLinks.map((link) => link.account_id).filter(Boolean))];
  const linkIds = matchingLinks.map((link) => link.id);

  const receivedAt = createdAt.toISOString();
  const messageRows = [];

  if (code) {
    messageRows.push({
      email,
      message_type: "code",
      code,
      received_at: receivedAt,
      is_used: false,
    });
  }

  if (tvApprovalUrl) {
    messageRows.push({
      email,
      message_type: "tv_approval_url",
      tv_approval_url: tvApprovalUrl,
      received_at: receivedAt,
      is_used: false,
    });
  }

  const { data: savedMessages, error: messageSaveError } = await supabase
    .from("verification_messages")
    .insert(messageRows)
    .select("id,message_type");

  if (messageSaveError) {
    console.error("Verification message save failed:", messageSaveError);
    return send(res, 500, { success: false, error: "verification_message_save_failed" });
  }

  if (code) {
    const { error: updateError } = await supabase
      .from("accounts")
      .update({
        verification_code: code,
        verification_code_received_at: receivedAt,
      })
      .in("id", accountIds);

    if (updateError) {
      console.error("Verification code save failed:", updateError);
      return send(res, 500, { success: false, error: "code_save_failed" });
    }
  }

  if (tvApprovalUrl) {
    const updatedAt = new Date().toISOString();
    const { error: tvLinkSaveError } = await supabase
      .from("customer_links")
      .update({
        tv_approval_url: tvApprovalUrl,
        updated_at: updatedAt,
      })
      .in("id", linkIds);

    if (tvLinkSaveError) {
      console.error("TV approval URL save failed:", tvLinkSaveError);
      return send(res, 500, { success: false, error: "tv_approval_url_save_failed" });
    }
  }

  return send(res, 200, {
    success: true,
    code_saved: Boolean(code),
    tv_approval_url_saved: Boolean(tvApprovalUrl),
    message_ids: (savedMessages || []).map((message) => ({
      id: message.id,
      type: message.message_type,
    })),
    matched_links: matchingLinks.length,
  });
}

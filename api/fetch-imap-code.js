import { createClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { decryptImapPassword } from "./_imap-crypto.js";

export const config = { maxDuration: 30 };

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const netflixSender = "info@account.netflix.com";
const fifteenMinutesMs = 15 * 60 * 1000;
const recentRequests = new Map();

function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(status).json(payload);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { success: false, error: "method_not_allowed" });
  if (!supabaseUrl || !serviceRoleKey) {
    return send(res, 500, { success: false, error: "supabase_not_configured" });
  }

  const customerLinkId = String(req.body?.customer_link_id || "").trim();
  if (!customerLinkId) return send(res, 400, { success: false, error: "invalid_customer_link" });

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let imap = null;
  let lock = null;

  try {
    const { data: link, error: linkError } = await supabase
      .from("customer_links")
      .select("id,account_id,code_request_limit,code_requested_count,accounts!inner(id,email,account_type,email_provider,imap_enabled)")
      .eq("id", customerLinkId)
      .maybeSingle();
    if (linkError) throw linkError;

    const account = link?.accounts;
    if (!link || !account || account.account_type === "temporary" || !account.imap_enabled || account.email_provider !== "outlook") {
      return send(res, 400, { success: false, error: "imap_not_enabled" });
    }
    if (Math.max(0, Number(link.code_requested_count || 0)) >= Math.max(0, Number(link.code_request_limit ?? 1))) {
      return send(res, 409, { success: false, error: "code_credit_exhausted" });
    }

    const lastRequestAt = Number(recentRequests.get(customerLinkId) || 0);
    if (Date.now() - lastRequestAt < 5_000) {
      return send(res, 429, { success: false, error: "request_too_frequent" });
    }
    recentRequests.set(customerLinkId, Date.now());
    if (recentRequests.size > 500) {
      const cutoff = Date.now() - 60_000;
      for (const [key, requestedAt] of recentRequests) {
        if (requestedAt < cutoff) recentRequests.delete(key);
      }
    }

    const { data: credential, error: credentialError } = await supabase
      .from("account_imap_credentials")
      .select("encrypted_password,encryption_iv,encryption_tag")
      .eq("account_id", account.id)
      .maybeSingle();
    if (credentialError) throw credentialError;
    if (!credential) return send(res, 404, { success: false, error: "imap_credentials_not_found" });

    imap = new ImapFlow({
      host: "outlook.office365.com",
      port: 993,
      secure: true,
      auth: { user: account.email, pass: decryptImapPassword(credential) },
      logger: false,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });

    await imap.connect();
    lock = await imap.getMailboxLock("INBOX");
    const since = new Date(Date.now() - fifteenMinutesMs);
    const matches = await imap.search({ from: netflixSender, since }, { uid: true });
    const uids = Array.isArray(matches) ? matches : [];
    if (!uids.length) return send(res, 404, { success: false, error: "no_recent_code" });

    const uid = Math.max(...uids);
    const message = await imap.fetchOne(uid, { source: true, internalDate: true }, { uid: true });
    const receivedAtDate = message?.internalDate ? new Date(message.internalDate) : new Date();
    const age = Date.now() - receivedAtDate.getTime();
    if (!message?.source || !Number.isFinite(age) || age < 0 || age > fifteenMinutesMs) {
      return send(res, 404, { success: false, error: "no_recent_code" });
    }

    const rawEmail = message.source.toString("utf8");
    const bodyStart = rawEmail.search(/\r?\n\r?\n/);
    const searchableBody = bodyStart >= 0 ? rawEmail.slice(bodyStart) : rawEmail;
    const code = searchableBody.match(/\b\d{4}\b/)?.[0] || null;
    if (!code) return send(res, 404, { success: false, error: "code_not_found" });

    const sourceKey = `outlook:${account.id}:${uid}`;
    const { data: existingMessage, error: existingError } = await supabase
      .from("verification_messages")
      .select("id,is_used")
      .eq("source_key", sourceKey)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existingMessage?.is_used) {
      return send(res, 409, { success: false, error: "code_already_used" });
    }

    if (!existingMessage) {
      const { error: messageError } = await supabase.from("verification_messages").insert({
        email: String(account.email).trim().toLowerCase(),
        message_type: "code",
        code,
        received_at: receivedAtDate.toISOString(),
        is_used: false,
        source_key: sourceKey,
      });
      if (messageError && messageError.code !== "23505") throw messageError;
    }

    const receivedAt = receivedAtDate.toISOString();
    const [{ error: accountUpdateError }, { error: linkUpdateError }] = await Promise.all([
      supabase.from("accounts").update({
        verification_code: code,
        verification_code_received_at: receivedAt,
      }).eq("id", account.id),
      supabase.from("customer_links").update({
        verification_code: code,
        verification_code_received_at: receivedAt,
      }).eq("account_id", account.id),
    ]);
    if (accountUpdateError || linkUpdateError) throw accountUpdateError || linkUpdateError;

    return send(res, 200, { success: true, received_at: receivedAt });
  } catch (error) {
    console.error("Outlook IMAP code fetch failed:", error);
    return send(res, 500, { success: false, error: "imap_fetch_failed" });
  } finally {
    try { lock?.release(); } catch (error) { console.error("IMAP lock release failed:", error); }
    if (imap) {
      try { await imap.logout(); } catch (error) { console.error("IMAP logout failed:", error); }
    }
  }
}

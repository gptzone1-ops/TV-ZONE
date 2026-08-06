import { createClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { decryptImapPassword } from "./_imap-crypto.js";

export const config = { maxDuration: 30 };

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const recentRequests = new Map();
const messagesPerFolder = 30;
const noCodeMessage = "تم الاتصال بالبريد بنجاح لكن لم تصل رسالة جديدة من نتفليكس بعد، يرجى إعادة المحاولة خلال ثوانٍ";

function isJunkMailbox(mailbox) {
  const searchableName = `${mailbox?.path || ""} ${mailbox?.name || ""}`.toLowerCase();
  return mailbox?.specialUse === "\\Junk"
    || /(^|[\s/._-])(junk|spam)([\s/._-]|$)/i.test(searchableName)
    || searchableName.includes("غير هام")
    || searchableName.includes("البريد غير الهام");
}

function normalizeDigits(value) {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  let normalized = String(value || "")
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)));

  // Outlook HTML can insert spaces or non-breaking spaces between code digits.
  for (let index = 0; index < 6; index += 1) {
    normalized = normalized.replace(/(\d)[\s\u00a0]+(?=\d)/g, "$1");
  }
  return normalized;
}

function extractNetflixCode(content) {
  const normalized = normalizeDigits(content);
  const contextualCode = normalized.match(/(?:sign[\s-]*in\s+code|security\s+code|verification\s+code|code|كود|رمز)[^0-9]{0,100}(\d{4,6})/i)?.[1];
  if (contextualCode) return contextualCode;
  return normalized.match(/\b\d{4,6}\b/g)?.[0] || null;
}

function mailboxSourceKey(accountId, mailboxPath, uid) {
  const encodedPath = Buffer.from(mailboxPath, "utf8").toString("base64url");
  return `outlook:${accountId}:${encodedPath}:${uid}`;
}

async function scanMailbox(imap, mailboxPath) {
  let mailboxLock = null;
  const scanned = [];
  let scannedCount = 0;

  try {
    mailboxLock = await imap.getMailboxLock(mailboxPath);
    const messageCount = Number(imap.mailbox?.exists || 0);
    if (!messageCount) return { candidates: scanned, scannedCount };

    let fetchRange;
    try {
      // IMAP SEARCH runs against the complete mailbox. Outlook's Focused/Other
      // split is only a client-side category and does not exclude either tab here.
      const matchingUids = await imap.search({
        or: [
          { from: "info@account.netflix.com" },
          { text: "Netflix" },
          { text: "نتفليكس" },
        ],
      }, { uid: true });
      const recentMatchingUids = (Array.isArray(matchingUids) ? matchingUids : [])
        .slice(-messagesPerFolder);
      fetchRange = recentMatchingUids.length ? recentMatchingUids : null;
    } catch (searchError) {
      console.error("Outlook IMAP server search failed; using recent-message fallback:", {
        mailbox: mailboxPath,
        error: searchError instanceof Error ? searchError.message : String(searchError),
      });
      const firstSequence = Math.max(1, messageCount - messagesPerFolder + 1);
      fetchRange = `${firstSequence}:*`;
    }

    if (!fetchRange) return { candidates: scanned, scannedCount };
    for await (const message of imap.fetch(
      fetchRange,
      { source: true, internalDate: true },
      Array.isArray(fetchRange) ? { uid: true } : undefined,
    )) {
      scannedCount += 1;
      if (!message?.source) continue;

      try {
        const parsed = await simpleParser(message.source);
        const html = typeof parsed.html === "string" ? parsed.html : "";
        const decodedContent = [
          parsed.subject || "",
          parsed.from?.text || "",
          parsed.text || "",
          html.replace(/<[^>]*>/g, " "),
        ].join("\n");
        const hasNetflixKeyword = /netflix|نتفليكس/i.test(decodedContent);
        if (!hasNetflixKeyword) continue;

        const code = extractNetflixCode(decodedContent);
        if (!code) continue;

        const parsedDate = parsed.date ? new Date(parsed.date) : null;
        const internalDate = message.internalDate ? new Date(message.internalDate) : null;
        const receivedAtDate = internalDate && Number.isFinite(internalDate.getTime())
          ? internalDate
          : parsedDate && Number.isFinite(parsedDate.getTime())
            ? parsedDate
            : new Date();

        scanned.push({
          code,
          uid: message.uid,
          mailboxPath,
          receivedAtDate,
        });
      } catch (parseError) {
        console.error("Outlook IMAP message parsing failed:", {
          mailbox: mailboxPath,
          uid: message.uid,
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
      }
    }
    return { candidates: scanned, scannedCount };
  } finally {
    try {
      mailboxLock?.release();
    } catch (releaseError) {
      console.error("IMAP mailbox lock release failed:", releaseError);
    }
  }
}

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
    const mailboxes = await imap.list();
    const inboxPath = mailboxes.find((mailbox) => mailbox.specialUse === "\\Inbox" || mailbox.path.toUpperCase() === "INBOX")?.path || "INBOX";
    const junkPaths = mailboxes
      .filter(isJunkMailbox)
      .map((mailbox) => mailbox.path)
      .filter((path) => path && path !== inboxPath);
    const mailboxPaths = [...new Set([inboxPath, ...junkPaths])];

    const candidates = [];
    let scannedMessages = 0;
    for (const mailboxPath of mailboxPaths) {
      try {
        const mailboxResult = await scanMailbox(imap, mailboxPath);
        scannedMessages += mailboxResult.scannedCount;
        candidates.push(...mailboxResult.candidates);
      } catch (mailboxError) {
        console.error("Outlook IMAP mailbox scan failed:", {
          mailbox: mailboxPath,
          error: mailboxError instanceof Error ? mailboxError.message : String(mailboxError),
        });
      }
    }
    candidates.sort((first, second) => second.receivedAtDate.getTime() - first.receivedAtDate.getTime());
    const latestMessage = candidates[0] || null;

    console.log("Outlook IMAP Netflix scan completed:", {
      account_id: account.id,
      folders: mailboxPaths,
      scanned_messages: scannedMessages,
      matching_messages: candidates.length,
      latest_message_at: latestMessage?.receivedAtDate?.toISOString() || null,
    });

    if (!latestMessage) {
      return send(res, 404, {
        success: false,
        error: "netflix_code_not_found",
        message: noCodeMessage,
      });
    }

    const { code, uid, mailboxPath, receivedAtDate } = latestMessage;
    const sourceKey = mailboxSourceKey(account.id, mailboxPath, uid);
    const legacySourceKey = mailboxPath.toUpperCase() === "INBOX" ? `outlook:${account.id}:${uid}` : null;
    const { data: existingMessage, error: existingError } = await supabase
      .from("verification_messages")
      .select("id,is_used")
      .in("source_key", legacySourceKey ? [sourceKey, legacySourceKey] : [sourceKey])
      .limit(1)
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

    return send(res, 200, { success: true, code, received_at: receivedAt });
  } catch (error) {
    console.error("Outlook IMAP code fetch failed:", error);
    return send(res, 500, { success: false, error: "imap_fetch_failed" });
  } finally {
    if (imap) {
      try { await imap.logout(); } catch (error) { console.error("IMAP logout failed:", error); }
    }
  }
}

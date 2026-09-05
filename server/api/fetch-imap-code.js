import { createClient } from "@supabase/supabase-js";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { decryptImapPassword } from "./_imap-crypto.js";

export const config = { maxDuration: 30 };

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const recentRequests = new Map();
const messagesPerFolder = 5;

const apiMessages = {
  method_not_allowed: "نوع الطلب غير مدعوم. يجب استخدام POST.",
  supabase_not_configured: "خادم Supabase غير مكتمل الإعداد.",
  invalid_customer_link: "معرّف رابط العميل غير موجود أو غير صحيح.",
  imap_not_enabled: "جلب الكود عبر Outlook غير مفعّل لهذا الحساب.",
  code_credit_exhausted: "لا يوجد رصيد متاح لطلب كود جديد لهذا العميل.",
  request_too_frequent: "تم إرسال طلب قبل لحظات. انتظر 5 ثوانٍ ثم أعد المحاولة.",
  imap_credentials_not_found: "بيانات ربط Outlook غير محفوظة لهذا الحساب.",
  imap_credentials_invalid: "تعذر قراءة كلمة مرور تطبيق Outlook المحفوظة. أعد حفظ كلمة مرور التطبيق من لوحة التحكم.",
  netflix_code_not_found: "تم الاتصال بالبريد بنجاح وفحص أحدث الرسائل، لكن لم يتم العثور على رسالة Netflix تحتوي على رمز من 4 إلى 6 أرقام في INBOX أو Junk.",
  code_already_used: "تم العثور على أحدث رمز، لكنه سبق عرضه واستخدامه. اطلب رمزاً جديداً من Netflix ثم أعد المحاولة.",
  imap_authentication_failed: "تم الاتصال بخادم Outlook، لكن Microsoft رفض تسجيل الدخول باستخدام البريد وكلمة مرور التطبيق. هذا الحساب يتطلب OAuth2 / Modern Auth؛ إعادة إنشاء App Password لن تحل المشكلة.",
  imap_connection_timeout: "انتهت مهلة الاتصال بخادم Outlook. أعد المحاولة بعد لحظات.",
  imap_network_failed: "تعذر فتح اتصال شبكي بخادم Outlook على المنفذ 993.",
  imap_tls_failed: "فشل إنشاء الاتصال الآمن TLS مع خادم Outlook.",
  imap_connection_failed: "تعذر الاتصال أو قراءة بريد Outlook.",
  backend_processing_failed: "تم الاتصال بالخادم، لكن حدث خطأ أثناء قراءة أو حفظ بيانات الكود.",
};

function send(res, status, payload) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(status).json(payload);
}

function failure(res, status, error, extra = {}) {
  return send(res, status, {
    success: false,
    error,
    message: apiMessages[error] || apiMessages.imap_connection_failed,
    ...extra,
  });
}

function logImap(requestId, stage, details = {}) {
  console.log("[Outlook IMAP]", {
    request_id: requestId,
    stage,
    at: new Date().toISOString(),
    ...details,
  });
}

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

  for (let index = 0; index < 6; index += 1) {
    normalized = normalized.replace(/(\d)[\s\u00a0]+(?=\d)/g, "$1");
  }
  return normalized;
}

function extractNetflixCode(content) {
  const normalized = normalizeDigits(content);
  const contextualCode = normalized.match(
    /(?:sign[\s-]*in\s+code|security\s+code|verification\s+code|code|كود|رمز)[^0-9]{0,100}(\d{4,6})/i,
  )?.[1];
  if (contextualCode) return contextualCode;
  return normalized.match(/\b\d{4,6}\b/)?.[0] || null;
}

function mailboxSourceKey(accountId, mailboxPath, uid) {
  const encodedPath = Buffer.from(mailboxPath, "utf8").toString("base64url");
  return `outlook:${accountId}:${encodedPath}:${uid}`;
}

function safeErrorDetail(error) {
  const message = error instanceof Error ? error.message : String(error || "Unknown IMAP error");
  const diagnosticParts = [
    error?.name && error.name !== "Error" ? `name=${error.name}` : null,
    error?.code ? `code=${error.code}` : null,
    error?.responseCode ? `responseCode=${error.responseCode}` : null,
    error?.authenticationFailed ? "authenticationFailed=true" : null,
    message,
  ].filter(Boolean);
  return [...new Set(diagnosticParts)].join(" | ").replace(/[\r\n]+/g, " ").slice(0, 700);
}

function classifyImapError(error) {
  const detail = safeErrorDetail(error);
  const searchable = `${error?.code || ""} ${error?.responseCode || ""} ${detail}`.toLowerCase();
  if (/pgrst|postgres|supabase|relation|column|row-level|permission denied|23505|22p02/.test(searchable)) {
    return { error: "backend_processing_failed", detail, status: 500 };
  }
  if (/auth|login|credentials|password|authenticationfailed/.test(searchable)) {
    return { error: "imap_authentication_failed", detail, status: 401 };
  }
  if (/timeout|timedout|etimedout/.test(searchable)) {
    return { error: "imap_connection_timeout", detail, status: 504 };
  }
  if (/certificate|ssl|tls|secure connection/.test(searchable)) {
    return { error: "imap_tls_failed", detail, status: 502 };
  }
  if (/econnreset|econnrefused|enotfound|enetunreach|ehostunreach|socket|connection closed|network/.test(searchable)) {
    return { error: "imap_network_failed", detail, status: 502 };
  }
  return { error: "imap_connection_failed", detail, status: 500 };
}

function maskCodes(value) {
  return String(value || "").replace(/\b\d{4,6}\b/g, "[CODE]");
}

async function scanLatestMessages(imap, mailboxPath, requestId) {
  let mailboxLock = null;
  const parsedMessages = [];

  try {
    logImap(requestId, "mailbox_open_started", { mailbox: mailboxPath });
    mailboxLock = await imap.getMailboxLock(mailboxPath);
    const messageCount = Number(imap.mailbox?.exists || 0);
    const firstSequence = Math.max(1, messageCount - messagesPerFolder + 1);

    logImap(requestId, "mailbox_open_succeeded", {
      mailbox: mailboxPath,
      total_messages: messageCount,
      requested_latest_messages: Math.min(messageCount, messagesPerFolder),
      includes_read_and_unread: true,
    });

    if (!messageCount) {
      return { candidates: [], scannedCount: 0, keywordMatches: 0, latestMessageAt: null };
    }

    for await (const message of imap.fetch(
      `${firstSequence}:*`,
      { source: true, internalDate: true, envelope: true },
    )) {
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
        const internalDate = message.internalDate ? new Date(message.internalDate) : null;
        const parsedDate = parsed.date ? new Date(parsed.date) : null;
        const receivedAtDate = internalDate && Number.isFinite(internalDate.getTime())
          ? internalDate
          : parsedDate && Number.isFinite(parsedDate.getTime())
            ? parsedDate
            : new Date(0);
        const hasKeyword = /netflix|نتفليكس|\bcode\b|كود|رمز/i.test(decodedContent);
        const code = hasKeyword ? extractNetflixCode(decodedContent) : null;

        parsedMessages.push({
          code,
          hasKeyword,
          uid: message.uid,
          mailboxPath,
          receivedAtDate,
          subject: maskCodes(parsed.subject || message.envelope?.subject || "بدون عنوان").slice(0, 160),
        });
      } catch (parseError) {
        console.error("[Outlook IMAP] Message parsing failed", {
          request_id: requestId,
          mailbox: mailboxPath,
          uid: message.uid,
          error: safeErrorDetail(parseError),
        });
      }
    }

    parsedMessages.sort((first, second) => second.receivedAtDate.getTime() - first.receivedAtDate.getTime());
    const candidates = parsedMessages.filter((message) => Boolean(message.code));
    const keywordMatches = parsedMessages.filter((message) => message.hasKeyword).length;

    logImap(requestId, "mailbox_scan_completed", {
      mailbox: mailboxPath,
      scanned_messages: parsedMessages.length,
      keyword_matches: keywordMatches,
      code_matches: candidates.length,
      latest_message_at: parsedMessages[0]?.receivedAtDate?.toISOString() || null,
      messages: parsedMessages.map((message) => ({
        uid: message.uid,
        subject: message.subject,
        received_at: message.receivedAtDate.toISOString(),
        keyword_match: message.hasKeyword,
        code_match: Boolean(message.code),
      })),
    });

    return {
      candidates,
      scannedCount: parsedMessages.length,
      keywordMatches,
      latestMessageAt: parsedMessages[0]?.receivedAtDate || null,
    };
  } finally {
    try {
      mailboxLock?.release();
    } catch (releaseError) {
      console.error("[Outlook IMAP] Mailbox lock release failed", {
        request_id: requestId,
        mailbox: mailboxPath,
        error: safeErrorDetail(releaseError),
      });
    }
  }
}

export default async function handler(req, res) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  if (req.method !== "POST") return failure(res, 405, "method_not_allowed", { request_id: requestId });
  if (!supabaseUrl || !serviceRoleKey) {
    return failure(res, 500, "supabase_not_configured", { request_id: requestId });
  }

  const customerLinkId = String(req.body?.customer_link_id || "").trim();
  if (!customerLinkId) return failure(res, 400, "invalid_customer_link", { request_id: requestId });

  logImap(requestId, "request_received", { customer_link_id: customerLinkId });

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let imap = null;

  try {
    const { data: link, error: linkError } = await supabase
      .from("customer_links")
      .select("id,account_id,is_active,code_request_limit,code_requested_count,accounts!inner(id,email,account_type,email_provider,imap_enabled)")
      .eq("id", customerLinkId)
      .maybeSingle();
    if (linkError) throw linkError;

    const account = link?.accounts;
    if (!link || link.is_active === false || !account || account.account_type === "temporary" || account.account_type === "compensation" || !account.imap_enabled || account.email_provider !== "outlook") {
      logImap(requestId, "account_validation_failed", { reason: "imap_not_enabled" });
      return failure(res, 400, "imap_not_enabled", { request_id: requestId });
    }
    if (Math.max(0, Number(link.code_requested_count || 0)) >= Math.max(0, Number(link.code_request_limit ?? 1))) {
      logImap(requestId, "account_validation_failed", { account_id: account.id, reason: "code_credit_exhausted" });
      return failure(res, 409, "code_credit_exhausted", { request_id: requestId });
    }

    const lastRequestAt = Number(recentRequests.get(customerLinkId) || 0);
    if (Date.now() - lastRequestAt < 5_000) {
      return failure(res, 429, "request_too_frequent", { request_id: requestId });
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
    if (!credential) {
      return failure(res, 404, "imap_credentials_not_found", { request_id: requestId });
    }

    logImap(requestId, "connection_started", {
      account_id: account.id,
      host: "outlook.office365.com",
      port: 993,
      secure: true,
    });

    let appPassword;
    try {
      appPassword = decryptImapPassword(credential);
    } catch (credentialDecryptError) {
      console.error("[Outlook IMAP] Credential decryption failed", {
        request_id: requestId,
        account_id: account.id,
        error: safeErrorDetail(credentialDecryptError),
      });
      return failure(res, 500, "imap_credentials_invalid", {
        request_id: requestId,
        technical_detail: safeErrorDetail(credentialDecryptError),
      });
    }

    imap = new ImapFlow({
      host: "outlook.office365.com",
      port: 993,
      secure: true,
      auth: { user: account.email, pass: appPassword },
      logger: false,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });

    await imap.connect();
    logImap(requestId, "connection_succeeded", {
      account_id: account.id,
      elapsed_ms: Date.now() - startedAt,
    });

    const mailboxes = await imap.list();
    const inboxPath = mailboxes.find(
      (mailbox) => mailbox.specialUse === "\\Inbox" || mailbox.path.toUpperCase() === "INBOX",
    )?.path || "INBOX";
    const junkPaths = [...new Set(mailboxes.filter(isJunkMailbox).map((mailbox) => mailbox.path))]
      .filter((path) => path && path !== inboxPath);

    logImap(requestId, "mailboxes_discovered", {
      inbox: inboxPath,
      junk_folders: junkPaths,
      available_mailbox_count: mailboxes.length,
    });

    const scanTotals = { scannedMessages: 0, keywordMatches: 0 };
    const folderErrors = [];
    const inboxResult = await scanLatestMessages(imap, inboxPath, requestId);
    scanTotals.scannedMessages += inboxResult.scannedCount;
    scanTotals.keywordMatches += inboxResult.keywordMatches;
    let candidates = [...inboxResult.candidates];
    const scannedFolders = [inboxPath];

    // Junk is a fallback only. INBOX includes both Outlook Focused and Other tabs.
    if (!candidates.length) {
      for (const junkPath of junkPaths) {
        try {
          const junkResult = await scanLatestMessages(imap, junkPath, requestId);
          scannedFolders.push(junkPath);
          scanTotals.scannedMessages += junkResult.scannedCount;
          scanTotals.keywordMatches += junkResult.keywordMatches;
          candidates.push(...junkResult.candidates);
        } catch (junkError) {
          folderErrors.push({ mailbox: junkPath, error: safeErrorDetail(junkError) });
          console.error("[Outlook IMAP] Junk mailbox scan failed", {
            request_id: requestId,
            mailbox: junkPath,
            error: safeErrorDetail(junkError),
          });
        }
      }
    }

    candidates.sort((first, second) => second.receivedAtDate.getTime() - first.receivedAtDate.getTime());
    const latestMessage = candidates[0] || null;

    logImap(requestId, "search_completed", {
      account_id: account.id,
      folders: scannedFolders,
      scanned_messages: scanTotals.scannedMessages,
      keyword_matches: scanTotals.keywordMatches,
      code_matches: candidates.length,
      latest_code_message_at: latestMessage?.receivedAtDate?.toISOString() || null,
      elapsed_ms: Date.now() - startedAt,
    });

    if (!latestMessage) {
      const responseMessage = folderErrors.length
        ? `تم فحص INBOX، لكن تعذر فحص مجلد البريد غير الهام: ${folderErrors[0].error}`
        : junkPaths.length
          ? apiMessages.netflix_code_not_found
          : "تم فحص آخر 5 رسائل في INBOX ولم يتم العثور على كود. لم يظهر مجلد Junk ضمن مجلدات Outlook المتاحة لهذا البريد.";
      return failure(res, 404, "netflix_code_not_found", {
        request_id: requestId,
        message: responseMessage,
        details: {
          scanned_folders: scannedFolders,
          scanned_messages: scanTotals.scannedMessages,
          keyword_matches: scanTotals.keywordMatches,
          folder_errors: folderErrors,
        },
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
      return failure(res, 409, "code_already_used", {
        request_id: requestId,
        details: { mailbox: mailboxPath, received_at: receivedAtDate.toISOString() },
      });
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

    logImap(requestId, "code_saved", {
      account_id: account.id,
      mailbox: mailboxPath,
      uid,
      received_at: receivedAt,
      code_length: code.length,
      elapsed_ms: Date.now() - startedAt,
    });

    return send(res, 200, {
      success: true,
      code,
      received_at: receivedAt,
      request_id: requestId,
      message: "تم العثور على كود Netflix بنجاح.",
    });
  } catch (error) {
    const classified = classifyImapError(error);
    console.error("[Outlook IMAP] Request failed", {
      request_id: requestId,
      error: classified.error,
      technical_detail: classified.detail,
      elapsed_ms: Date.now() - startedAt,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return failure(res, classified.status, classified.error, {
      request_id: requestId,
      technical_detail: classified.detail,
      action_required: classified.error === "imap_authentication_failed" ? "microsoft_oauth2" : undefined,
    });
  } finally {
    if (imap) {
      try {
        await imap.logout();
        logImap(requestId, "connection_closed", { elapsed_ms: Date.now() - startedAt });
      } catch (logoutError) {
        console.error("[Outlook IMAP] Logout failed", {
          request_id: requestId,
          error: safeErrorDetail(logoutError),
        });
      }
    }
  }
}

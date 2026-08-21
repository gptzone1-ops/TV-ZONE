const tvApprovalLinkPattern = /https?:\/\/(?:www\.)?netflix\.com\/ilum\?code=[\w-]+/i;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const codeContextPattern = /(?:sign[\s-]*in\s*code|verification\s*code|security\s*code|access\s*code|رمز(?:\s+تسجيل\s+الدخول|\s+التحقق)?|كود)[\s\S]{0,500}?([0-9٠-٩۰-۹][0-9٠-٩۰-۹\s-]{2,12}[0-9٠-٩۰-۹])/i;

function normalizeDigits(value) {
  return String(value || "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}

function normalizeEmail(value) {
  return String(value || "").trim().replace(/^mailto:/i, "").toLowerCase();
}

function decodeQuotedPrintable(value) {
  const unfolded = String(value || "").replace(/=\r?\n/g, "");
  const bytes = [];

  for (let index = 0; index < unfolded.length; index += 1) {
    if (unfolded[index] === "=" && /^[0-9a-f]{2}$/i.test(unfolded.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(unfolded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      const encoded = new TextEncoder().encode(unfolded[index]);
      bytes.push(...encoded);
    }
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
}

function decodeBase64Parts(rawEmail) {
  const decoded = [];
  const partPattern = /content-transfer-encoding:\s*base64[^\r\n]*\r?\n(?:[^\r\n]*\r?\n)*?\r?\n([a-z0-9+/=\r\n]+?)(?=\r?\n--|$)/gi;
  let match;

  while ((match = partPattern.exec(rawEmail)) !== null) {
    try {
      const binary = atob(match[1].replace(/\s+/g, ""));
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      decoded.push(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
    } catch (error) {
      console.warn("Unable to decode a base64 email part:", error);
    }
  }

  return decoded.join("\n");
}

function searchableEmailText(rawEmail) {
  return [rawEmail, decodeQuotedPrintable(rawEmail), decodeBase64Parts(rawEmail)].join("\n");
}

function detectServiceType(rawEmail) {
  const text = searchableEmailText(rawEmail);
  return /\bosn\+?\b|osnplus/i.test(text) ? "osn" : "netflix";
}

function parseHeaders(rawEmail) {
  const headerBlock = String(rawEmail || "").split(/\r?\n\r?\n/, 1)[0] || "";
  const unfolded = headerBlock.replace(/\r?\n[\t ]+/g, " ");
  const headers = new Map();

  for (const line of unfolded.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers.set(name, [...(headers.get(name) || []), value]);
  }

  return headers;
}

function emailsFromValue(value) {
  return (String(value || "").match(emailPattern) || []).map(normalizeEmail);
}

function extractOriginalEmailCandidates(rawEmail, message, overrideEmail) {
  const headers = parseHeaders(rawEmail);
  const candidates = [];
  const destinationEmail = normalizeEmail(message?.to);
  const senderEmails = new Set([
    ...(headers.get("from") || []),
    ...(headers.get("sender") || []),
    ...(headers.get("return-path") || []),
  ].flatMap(emailsFromValue));
  const add = (value, allowDestination = false) => {
    for (const email of emailsFromValue(value)) {
      const domain = email.split("@")[1] || "";
      if (
        !email ||
        senderEmails.has(email) ||
        domain === "netflix.com" ||
        domain.endsWith(".netflix.com") ||
        (!allowDestination && email === destinationEmail) ||
        candidates.includes(email)
      ) continue;
      candidates.push(email);
    }
  };

  add(overrideEmail, true);

  const preferredHeaders = [
    "x-original-to",
    "x-original-recipient",
    "original-recipient",
    "x-ms-exchange-original-recipient",
    "x-forwarded-to",
    "x-forwarded-for",
    "resent-to",
    "delivered-to",
    "envelope-to",
  ];

  for (const name of preferredHeaders) {
    for (const value of headers.get(name) || []) add(value);
  }

  const decodedText = searchableEmailText(rawEmail);
  const forwardedLabelPattern = /(?:original\s+(?:recipient|to)|forwarded\s+to|delivered\s+to|to|إلى|المستلم)\s*:\s*([^\r\n]+)/gi;
  let labelMatch;
  while ((labelMatch = forwardedLabelPattern.exec(decodedText)) !== null) add(labelMatch[1]);

  // Forwarded Outlook messages often keep the original To header inside the body.
  for (const email of emailsFromValue(decodedText)) add(email);

  // Keep the Cloudflare envelope recipient as a final fallback only.
  add(message?.to, true);
  return candidates;
}

function extractSignInCode(rawEmail) {
  const decodedText = normalizeDigits(searchableEmailText(rawEmail));
  const contextual = decodedText.match(codeContextPattern)?.[1]?.replace(/[^0-9]/g, "") || "";
  if (/^\d{4,6}$/.test(contextual)) return contextual;

  const serviceSection = decodedText.match(/(?:netflix|osn\+?)[\s\S]{0,2000}/i)?.[0] || "";
  return serviceSection.match(/\b\d{4,6}\b/)?.[0] || null;
}

async function createMessageKey(rawEmail, message) {
  const messageId = message?.headers?.get?.("message-id") || parseHeaders(rawEmail).get("message-id")?.[0];
  if (messageId) return String(messageId).replace(/[<>]/g, "").trim();

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawEmail));
  return [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default {
  async email(message, env) {
    const rawEmail = await new Response(message.raw).text();
    const serviceType = detectServiceType(rawEmail);
    const code = extractSignInCode(rawEmail);
    const tvApprovalUrl = searchableEmailText(rawEmail).match(tvApprovalLinkPattern)?.[0] || null;

    if (!code && !tvApprovalUrl) {
      console.log("Forwarded email ignored: no supported sign-in code or approval link was found.");
      return;
    }

    const webhookUrl = env.RECEIVE_CODE_WEBHOOK_URL;
    if (!webhookUrl) throw new Error("RECEIVE_CODE_WEBHOOK_URL is not configured");

    const emailCandidates = extractOriginalEmailCandidates(
      rawEmail,
      message,
      env.ACCOUNT_EMAIL_OVERRIDE,
    );
    const forwardedTo = normalizeEmail(message.to);
    const configuredAccountEmail = normalizeEmail(env.ACCOUNT_EMAIL_OVERRIDE);
    const accountEmail = configuredAccountEmail
      || emailCandidates.find((candidate) => candidate !== forwardedTo)
      || null;
    const messageKey = await createMessageKey(rawEmail, message);
    const headers = { "Content-Type": "application/json" };
    if (env.RECEIVE_CODE_WEBHOOK_SECRET) {
      headers.Authorization = `Bearer ${env.RECEIVE_CODE_WEBHOOK_SECRET}`;
    }

    let webhookError = null;
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          service_type: serviceType,
          accountEmail,
          email: forwardedTo,
          original_email_candidates: emailCandidates,
          forwarded_to: forwardedTo,
          code,
          tv_approval_url: tvApprovalUrl,
          source_key: messageKey,
          created_at: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        throw new Error(`Zone webhook failed with status ${response.status}: ${responseText}`);
      }

      console.log("Forwarding webhook accepted", {
        serviceType,
        accountEmail,
        forwardedTo,
        candidateCount: emailCandidates.length,
        hasCode: Boolean(code),
        hasTvApprovalUrl: Boolean(tvApprovalUrl),
      });
    } catch (error) {
      webhookError = error;
      console.error("Unable to save the forwarded sign-in code:", error);
    }

    const adminForwardEmail = normalizeEmail(env.ADMIN_FORWARD_EMAIL);
    if (adminForwardEmail) {
      try {
        await message.forward(adminForwardEmail);
      } catch (error) {
        console.error("Unable to forward the message to the admin mailbox:", error);
      }
    }

    if (webhookError) throw webhookError;
  },
};

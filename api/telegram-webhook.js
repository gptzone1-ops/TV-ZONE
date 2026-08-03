import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramChatId = process.env.TELEGRAM_CHAT_ID;
const telegramWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

function parseStorageObject(publicUrl) {
  if (!publicUrl) return null;

  try {
    const parsedUrl = new URL(publicUrl);
    const markers = ["/storage/v1/object/public/", "/storage/v1/object/sign/"];
    const marker = markers.find((candidate) => parsedUrl.pathname.includes(candidate));
    if (!marker) return null;

    const objectReference = parsedUrl.pathname.split(marker)[1] || "";
    const [rawBucket, ...rawPathParts] = objectReference.split("/");
    if (!rawBucket || rawPathParts.length === 0) return null;

    return {
      bucket: decodeURIComponent(rawBucket),
      path: rawPathParts.map((part) => decodeURIComponent(part)).join("/"),
    };
  } catch (error) {
    console.error("Telegram attachment URL parsing failed:", error);
    return null;
  }
}

async function callTelegram(method, payload) {
  const response = await fetch(
    `https://api.telegram.org/bot${telegramBotToken}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`telegram_${method}_failed:${response.status}:${responseText}`);
  }
}

async function answerCallbackQuery(callbackQueryId, text, showAlert = false) {
  try {
    await callTelegram("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert,
    });
  } catch (error) {
    console.error("Telegram callback answer failed:", error);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "method_not_allowed" });
  }

  if (!supabaseUrl || !serviceRoleKey || !telegramBotToken || !telegramChatId) {
    return res.status(500).json({ success: false, error: "server_not_configured" });
  }

  if (
    telegramWebhookSecret &&
    req.headers["x-telegram-bot-api-secret-token"] !== telegramWebhookSecret
  ) {
    return res.status(401).json({ success: false, error: "invalid_webhook_secret" });
  }

  const callbackQuery = req.body?.callback_query;
  if (!callbackQuery?.id) {
    return res.status(200).json({ success: true, ignored: true });
  }

  const callbackChatId = String(callbackQuery.message?.chat?.id || "");
  if (callbackChatId !== String(telegramChatId)) {
    await answerCallbackQuery(callbackQuery.id, "غير مصرح لك بتنفيذ هذا الإجراء.", true);
    return res.status(403).json({ success: false, error: "unauthorized_chat" });
  }

  const callbackData = String(callbackQuery.data || "");
  const match = callbackData.match(/^(approve|reject):([0-9a-f-]{36})$/i);
  if (!match) {
    await answerCallbackQuery(callbackQuery.id, "الأمر غير صالح.", true);
    return res.status(200).json({ success: false, error: "invalid_callback_data" });
  }

  const action = match[1].toLowerCase();
  const requestId = match[2];
  const status = action === "approve" ? "approved" : "rejected";
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: request, error: requestError } = await supabase
      .from("extra_credit_requests")
      .select("id,image_url,status")
      .eq("id", requestId)
      .maybeSingle();

    if (requestError) throw requestError;

    if (!request || request.status !== "pending") {
      await answerCallbackQuery(callbackQuery.id, "تمت معالجة هذا الطلب مسبقاً.", true);
      if (request && callbackQuery.message?.chat?.id && callbackQuery.message?.message_id) {
        try {
          await callTelegram("editMessageText", {
            chat_id: callbackQuery.message.chat.id,
            message_id: callbackQuery.message.message_id,
            text:
              request.status === "approved"
                ? `✅ تمت معالجة هذا الطلب وقبوله مسبقاً.\n\nرقم الطلب: ${requestId}`
                : `❌ تمت معالجة هذا الطلب ورفضه مسبقاً.\n\nرقم الطلب: ${requestId}`,
            reply_markup: { inline_keyboard: [] },
          });
        } catch (editError) {
          console.error("Telegram already-reviewed message update failed:", editError);
        }
      }
      return res.status(200).json({ success: true, already_reviewed: true });
    }

    const storageObject = parseStorageObject(request.image_url);
    if (request.image_url && !storageObject) {
      throw new Error("invalid_attachment_url");
    }

    if (storageObject) {
      const { error: removeError } = await supabase.storage
        .from(storageObject.bucket)
        .remove([storageObject.path]);
      if (removeError) throw removeError;
    }

    const { data: reviewed, error: reviewError } = await supabase.rpc(
      "review_extra_credit_request",
      {
        p_request_id: requestId,
        p_status: status,
      },
    );

    if (reviewError) throw reviewError;
    if (!reviewed) {
      await answerCallbackQuery(callbackQuery.id, "تمت معالجة هذا الطلب مسبقاً.", true);
      return res.status(200).json({ success: true, already_reviewed: true });
    }

    const approved = status === "approved";
    const resultText = approved
      ? "✅ تم قبول هذا الطلب وإضافة رصيد جديد للعميل وحذف المرفق."
      : "❌ تم رفض هذا الطلب وحذف المرفق.";

    await answerCallbackQuery(
      callbackQuery.id,
      approved ? "تم قبول الطلب وإضافة الرصيد." : "تم رفض الطلب.",
    );

    if (callbackQuery.message?.chat?.id && callbackQuery.message?.message_id) {
      try {
        await callTelegram("editMessageText", {
          chat_id: callbackQuery.message.chat.id,
          message_id: callbackQuery.message.message_id,
          text: `${resultText}\n\nرقم الطلب: ${requestId}`,
          reply_markup: { inline_keyboard: [] },
        });
      } catch (editError) {
        console.error("Telegram reviewed message update failed:", editError);
      }
    }

    return res.status(200).json({ success: true, status });
  } catch (error) {
    console.error("Telegram credit request review failed:", error);
    await answerCallbackQuery(
      callbackQuery.id,
      "تعذرت معالجة الطلب. حاول مرة أخرى أو استخدم لوحة التحكم.",
      true,
    );
    return res.status(500).json({ success: false, error: "review_failed" });
  }
}

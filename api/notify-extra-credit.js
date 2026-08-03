import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramChatId = process.env.TELEGRAM_CHAT_ID;

function escapeMarkdown(value) {
  return String(value ?? "غير متوفر").replace(/([\\_*\[\]()`])/g, "\\$1");
}

function customerDeviceLabel(selectedDevice) {
  if (selectedDevice === "screen") return "شاشة / سوني";
  if (selectedDevice === "mobile") return "جوال / آيباد / بي سي / لابتوب";
  return "غير محدد";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "method_not_allowed" });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ success: false, error: "supabase_not_configured" });
  }

  if (!telegramBotToken || !telegramChatId) {
    return res.status(500).json({ success: false, error: "telegram_not_configured" });
  }

  const requestId = String(req.body?.request_id || "").trim();
  if (!requestId) {
    return res.status(400).json({ success: false, error: "request_id_required" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: request, error: requestError } = await supabase
    .from("extra_credit_requests")
    .select(
      "id,reason_type,description,image_url,status,customer_links(id,email,link_number,short_id,selected_device,accounts(email))",
    )
    .eq("id", requestId)
    .eq("status", "pending")
    .maybeSingle();

  if (requestError) {
    console.error("Telegram extra credit request lookup failed:", requestError);
    return res.status(500).json({ success: false, error: "request_lookup_failed" });
  }

  if (!request) {
    return res.status(404).json({ success: false, error: "request_not_found" });
  }

  const customer = Array.isArray(request.customer_links)
    ? request.customer_links[0]
    : request.customer_links;
  const relatedAccount = Array.isArray(customer?.accounts)
    ? customer.accounts[0]
    : customer?.accounts;
  const email = relatedAccount?.email || customer?.email || "غير متوفر";
  const customerCode = customer?.link_number || customer?.short_id || customer?.id || "غير متوفر";
  const deviceType = customerDeviceLabel(customer?.selected_device);

  const messageText = [
    "🚨 *طلب رصيد إضافي جديد!*",
    "-----------------------------",
    `📧 *البريد الإلكتروني:* ${escapeMarkdown(email)}`,
    `🆔 *رقم العميل:* ${escapeMarkdown(customerCode)}`,
    `📱 *نوع الجهاز:* ${escapeMarkdown(deviceType)}`,
    `❓ *سبب المشكلة:* ${escapeMarkdown(request.reason_type)}`,
    `📝 *وصف المشكلة:* ${escapeMarkdown(request.description)}`,
    `🔗 *رابط المرفق:* ${escapeMarkdown(request.image_url)}`,
  ].join("\n");

  try {
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text: messageText,
          parse_mode: "Markdown",
        }),
      },
    );

    if (!telegramResponse.ok) {
      const responseText = await telegramResponse.text();
      console.error("Telegram notification failed:", telegramResponse.status, responseText);
      return res.status(502).json({ success: false, error: "telegram_send_failed" });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Telegram notification request failed:", error);
    return res.status(502).json({ success: false, error: "telegram_unreachable" });
  }
}

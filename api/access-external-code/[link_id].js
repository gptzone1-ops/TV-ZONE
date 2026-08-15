import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sendHtml(res, status, title, message) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).send(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f5fa;font-family:Arial,sans-serif;color:#18181b}.card{width:min(88vw,520px);padding:32px;border:1px solid #e4d6fa;border-radius:24px;background:#fff;text-align:center;box-shadow:0 18px 50px rgba(70,40,120,.12)}h1{font-size:24px;margin:0 0 14px;color:#7c2ce8}p{font-size:16px;line-height:1.9;margin:0}</style></head><body><main class="card"><h1>${title}</h1><p>${message}</p></main></body></html>`);
}

function validExternalUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendHtml(res, 405, "طلب غير مسموح", "هذا المسار مخصص لفتح رابط الكود فقط.");
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return sendHtml(res, 503, "الخدمة غير متاحة", "تعذر الاتصال بالخدمة حالياً، يرجى المحاولة لاحقاً.");
  }

  const linkId = String(req.query?.link_id || "").trim();
  if (!uuidPattern.test(linkId)) {
    return sendHtml(res, 400, "الرابط غير صحيح", "تعذر التحقق من رابط العميل.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: customerLink, error: lookupError } = await supabase
    .from("customer_links")
    .select("id,external_code_used,accounts!inner(code_fetch_method,supplier_code_url)")
    .eq("id", linkId)
    .maybeSingle();

  if (lookupError) {
    console.error("External code access lookup failed:", lookupError);
    return sendHtml(res, 500, "تعذر فتح الرابط", "حدث خطأ أثناء التحقق من صلاحية الرابط.");
  }
  if (!customerLink) return sendHtml(res, 404, "الرابط غير متاح", "لم يتم العثور على رابط العميل.");
  if (customerLink.external_code_used === true) {
    return sendHtml(res, 410, "انتهت صلاحية الرابط", "تم استهلاك رابط جلب الكود، وهو صالح للفتح مرة واحدة فقط.");
  }

  const account = Array.isArray(customerLink.accounts) ? customerLink.accounts[0] : customerLink.accounts;
  const externalUrl = account?.code_fetch_method === "external_link"
    ? validExternalUrl(account?.supplier_code_url)
    : null;
  if (!externalUrl) {
    return sendHtml(res, 409, "الرابط غير متاح", "رابط جلب الكود الخارجي غير مفعّل لهذا الحساب.");
  }

  const usedAt = new Date().toISOString();
  const { data: claimedLink, error: claimError } = await supabase
    .from("customer_links")
    .update({ external_code_used: true, external_code_used_at: usedAt })
    .eq("id", linkId)
    .eq("external_code_used", false)
    .select("id")
    .maybeSingle();

  if (claimError) {
    console.error("External code access claim failed:", claimError);
    return sendHtml(res, 500, "تعذر فتح الرابط", "حدث خطأ أثناء تسجيل استخدام الرابط.");
  }
  if (!claimedLink) {
    return sendHtml(res, 410, "انتهت صلاحية الرابط", "تم استهلاك رابط جلب الكود، وهو صالح للفتح مرة واحدة فقط.");
  }

  res.setHeader("Cache-Control", "no-store");
  return res.redirect(302, externalUrl);
}

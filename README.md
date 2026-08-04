# Zone Store Dashboard

لوحة تحكم React + Tailwind CSS لإدارة اشتراكات نتفلكس وربط روابط العملاء مع Supabase.

## التشغيل

1. انسخ `.env.example` إلى `.env`.
2. ضع قيم `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY`.
3. شغل SQL الموجود في `supabase/schema.sql` داخل Supabase SQL Editor.
4. ثبت الحزم ثم شغل التطبيق:

```bash
npm install
npm run dev
```

## منطق الروابط

- الحساب الخاص ينشئ 5 روابط: A/B/C/D/E.
- الحساب المشترك ينشئ 10 روابط: رابطان لكل ملف من A إلى E.
- رموز الملفات:
  - A: 1212
  - B: 2323
  - C: 3434
  - D: 4545
  - E: 5656

صفحة العميل المختصرة تعمل عبر:

```text
/v/:short_id
```

كلمة مرور لوحة التحكم تضبط عبر:

```text
VITE_ADMIN_PASSWORD
```

## فحص طلبات الرصيد عبر Gemini

شغّل ملف الترحيل التالي مرة واحدة داخل Supabase SQL Editor:

```text
supabase/extra_credit_ai_validation.sql
```

ثم أضف متغير الخادم التالي في Vercel للبيئات المطلوبة وأعد النشر:

```text
GEMINI_API_KEY
```

يمكن اختيار موديل مختلف اختيارياً عبر `GEMINI_MODEL`. القيمة الافتراضية هي
`gemini-3.6-flash`. لا تستخدم بادئة `VITE_` لمفتاح Gemini حتى لا يصل إلى المتصفح.

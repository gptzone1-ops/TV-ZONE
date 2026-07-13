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

## كود تسجيل الدخول المؤقت

بعد كل تحديث لمخطط قاعدة البيانات، شغل الملف `supabase/schema.sql` كاملاً داخل Supabase SQL Editor. يضيف المخطط رابط المورد إلى الحساب وحالة طلب الكود إلى رابط العميل، كما يمنع المفتاح العام من قراءة رابط المورد.

أضف المتغيرات التالية في Vercel ضمن Project Settings > Environment Variables لكل من Production وPreview:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_PASSWORD=نفس-كلمة-مرور-اللوحة
OTP_ALLOWED_HOSTS=code.tvleb.com
```

`SUPABASE_SERVICE_ROLE_KEY` متغير خادم فقط، ولا يجوز وضعه في متغير يبدأ بـ `VITE_` أو داخل GitHub. إذا كان المورد يستخدم نطاقاً آخر، أضفه إلى `OTP_ALLOWED_HOSTS`، ويمكن فصل أكثر من نطاق بفاصلة.

الدالة `/api/get-otp` لا تخزن الكود في قاعدة البيانات. تنتقل حالة رابط العميل من `not_requested` إلى `pending` ثم `used`، ويعود الكود للمتصفح مرة واحدة مع منع التخزين المؤقت.

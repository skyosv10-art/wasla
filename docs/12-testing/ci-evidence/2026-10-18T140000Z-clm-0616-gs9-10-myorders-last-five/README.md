# CLM-0616 — G-S9.10: MyOrders تطلبُ «آخرَ خمسةِ طلباتٍ» (`limit=5`)

**الحجزُ:** CLM-0616 · **العنصرُ:** M0-53 · **الأساسُ:** main `3d613e1718c524e1ceb5b6b557f513b43d8d7cf7` (بعدَ دمجِ #766 / CLM-0615). **النطاقُ:** G-S9.10 وحدَه — لا تغييرَ لعقدِ الـAPI ولا لقائمةِ سماحِ الحدِّ ولا لـ`production_open`. **لا يُعلَنُ أنَّ الميزةَ متاحةٌ للمستخدمينَ.**

## §1 القياسُ قبلَ

| المصدرُ | النصُّ/السلوكُ |
|---|---|
| المواصفةُ CMS §3.6 L86 · L90 | «قائمة آخر 5 طلبات» · `GET /customers/{id}/order-requests?limit=5` |
| العقدُ `services/customers/contracts/api.openapi.yml` `listOrderRequests` | معاملٌ واحدٌ `limit` (1..50 · افتراضيٌّ 20) · **بلا `status`** — آخرُ تغييرٍ للملفِّ `da48932b` (قبلَ CLM-0611) ← **لم يتغيّرْ** |
| الخدمةُ `services/customers/src/http/app.ts` L472 | `toListLimit` يقرأُ `limit` وحدَه (L174 `requests.ts`: خارجَ 1..50 ← 400) |
| الشاشةُ `MyOrders.tsx` (قبلَ) | التحميلُ الأوّليُّ `…/order-requests` بلا `limit` (← 20) · المرشّحُ `…?status=X` بلا `limit` |
| تفكيكُ [CLM-0611](../2026-10-18T093000Z-clm-0611-gs9-customer-decomposition/README.md) §2 | G-S9.10 «الآنَ-شاشةٌ» — «لا توكيدَ على عددِ العناصرِ المُعادةِ» في اختبارِ الخدمةِ |

## §2 التغييرُ

- `apps/customer-mini-app/src/screens/MyOrders.tsx`: `LAST_ORDERS_LIMIT = 5`؛ كلُّ تحميلٍ يبني `URLSearchParams` ← `limit=5` دائمًا، و`status` يُرسَلُ معه كما كانَ حينَ يُختارُ مرشّحٌ (المرشّحُ محفوظٌ — لم يُغيَّرْ سلوكُه).
- لا تغييرَ في `services/customers` سوى اختبارٍ.

## §3 الاختباراتُ (التوكيدُ لا الاسمُ)

**الشاشةُ** `apps/customer-mini-app/src/__tests__/MyOrders.test.tsx` (محاكاةُ `apiClient` — دليلُ **ما ترسلُه الشاشةُ** لا سلوكِ الخدمةِ):

| L | التوكيدُ |
|---|---|
| 31 | التحميلُ الأوّليُّ: `"/customers/WS-1234567890/order-requests?limit=5"` بالضبطِ · نداءٌ واحدٌ (كانَ يؤكّدُ المسارَ بلا `limit` — صُحِّحَ إلى المواصفةِ لا أُضعِفَ) |
| 71 | تغييرُ المرشّحِ: `"…?status=submitted&limit=5"` بالضبطِ · نداءانِ · قيمةُ المرشّحِ تبقى `submitted` (كانَ `?status=submitted`) |
| 94 | ثلاثةُ تحميلاتٍ (البدءُ · `submitted` · إعادةُ الضبطِ إلى الكلِّ): كلُّها المسارُ نفسُه و`searchParams.getAll("limit")` = `["5"]` بالضبطِ (لا تكرارَ) · `status` = `[null, "submitted", null]` · المرشّحُ `""` بعدَ الإعادةِ |

**الخدمةُ — اختبارٌ حقيقيٌّ** `services/customers/src/__tests__/http/app.test.ts` L578 (تطبيقُ Fastify الحقيقيُّ بهويّةِ الخدمةِ الموقَّعةِ + حالاتُ الاستخدامِ + المستودعُ في الذاكرةِ؛ لا محاكاةَ API): 7 طلباتٍ حقيقيّةٍ عبرَ `POST` (مفاتيحُ تكرارٍ مختلفةٌ · دقيقةٌ بينَ كلٍّ) ← `GET ?limit=5`: **5 عناصرَ بالضبطِ** = أحدثُ خمسةٍ بالترتيبِ (`created[6..2]`) · `created_at` تنازليٌّ · `?limit=50` ← 7 (لا حشوَ) · عميلٌ آخرُ ← `200 {items: []}` (لا تُحسبُ طلباتُ غيرِه). ويبقى L621 (400 لـ`0/51/abc`).

**Postgres:** محوِّلُ `drizzle` يطبّقُ `limit` بـ`query.limit(…)` (`repository.ts` L505-525)، ومُثبَتٌ في `postgres-repository.integration.test.ts` L346 («lists requests newest first, filtered and limited» — `limit: 2` من 3) الذي يُشغَّلُ في وظيفةِ CI `db-integration` (`@wasla/customers-service`). محلّيًّا لا Postgres (G6) ← يُقرأُ حكمُه من CI.

**المحليُّ:** customer-mini-app vitest **90/90** · Playwright **37/37** · services/customers vitest **152/152** · `tsc` 0 للاثنينِ. [raw](raw/).

**طفراتٌ مقيسةٌ (أُعيدتِ الملفّاتُ):** (أ) حذفُ `limit` من الشاشةِ ← 3 إخفاقاتٍ · (ب) `LAST_ORDERS_LIMIT = 10` ← 3 · (ج) الخدمةُ تتجاهلُ `limit` ← L578 يُخفقُ · (د) ترتيبُ المستودعِ الأقدمُ أوّلًا ← L578 يُخفقُ.

## §4 اختلافٌ مقيسٌ خارجَ النطاقِ — G-S9.15 (يُسجَّلُ ولا يُحَلُّ)

مرشّحُ الحالةِ في الشاشةِ يُرسِلُ `status`، والعقدُ لا يعلنُه والخدمةُ لا تقرؤُه: [raw/status-param-ignored-measure.txt](raw/status-param-ignored-measure.txt) — طلبٌ `submitted` يُعادُ لـ`?status=failed&limit=5`. والمواصفةُ CMS §3.6 لا تذكرُ مرشّحًا. الحلُّ (إعلانُه في العقدِ والخدمةِ، أو إزالتُه من الشاشةِ) قرارُ نطاقٍ مستقلٌّ؛ حُفِظَ المرشّحُ كما هو وفقَ التفويضِ («مع المحافظة على المرشح الحالي»). سُجِّلَ صفُّ **G-S9.15** في السجلِّ — مفتوحٌ.

## §5 الحوكمةُ والأساسُ

لا ملفَّ اختبارٍ جديدٌ (`test_files_tracked` = 578 = الأساسُ) ← لا إعادةَ توليدٍ. الفحوصُ الأربعةُ على الأساسِ في وصفِ الـPR. النشرُ: `apps/**` ← render-deploy بعدَ الدمجِ (التطبيقُ خلفَ حدٍّ مغلقٍ `production_open=false`).

## §6 الإغلاقُ

G-S9.10 يُغلَقُ في سجلٍّ لاحقٍ بعدَ نجاحِ WASLA CI على SHA الدمجِ في main وتوثيقِ النشرِ. **G-S9 الأمُّ تبقى مفتوحةً.**

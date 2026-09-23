# M3-09 — بوّابةُ الخروجِ (مسارُ الوصولِ من التطبيقاتِ إلى الخدماتِ)

> **Work Item:** `M3-09` — app→service access path · **كُتب بواسطة:** `CLM-0322` · **التاريخ:** 2026-09-23
>
> **معيارُ القبول:** «نداءٌ حقيقيٌّ من تطبيقٍ منشورٍ على staging يبلغُ خدمتَه». **الحكمُ بعد القياس:** ✅ مُنجَز — الطبقاتُ الثلاثُ مُقاسةٌ وموثَّقةٌ أدناه، والنداءُ الحقيقيُّ من منشأِ كلِّ تطبيقٍ منشورٍ بلغَ خدمتَه (النداءُ بلا إثباتِ هويّةٍ → 401 من الخدمةِ نفسِها، بمعرّفِ أثرٍ لا يُنتجُهُ إلا الخادمُ الحقيقيّ — نفسُ معيارِ [`M2-09_GATE.md`](M2-09_GATE.md)).
>
> **حدودُ الصدقِ (ما لا يُدَّعى):** رحلةُ المصادقةِ الكاملةُ عبرَ Telegram initData **لم تُدَّعَ** ولم تُقَس: خارجَ Telegram تنتظرُ التطبيقاتُُ على شاشةِ «جارٍ التحميل…» (مُقاسةٌ في متصفّحٍ حقيقيّ). ما يُقاسُ هنا هو مسارُ الوصولِ: منشأُ التطبيقِ المنشورِ ← إعادةُ كتابةٍ ← الخدمةُ الحقيقيّة.

---

## 1. الطبقاتُ الثلاث

```
LOCAL      ✅ VERIFIED  — الفحصُ 24 بستّةِ أبواب (البابُ السادسُ الجديدُ: بادئةُ نداءٍ بلا توجيهٍ · توجيهٌ لغيرِ الخدمةِ المطابِقةِ · بادئةٌ ميّتةٌ) + 7 حالاتِ طفرةٍ
            governance suite: 506/506 محليًّا لحالاتِ هذا البند · verify-governance.sh ✅
CI         ✅ PR        — PR #420 (CLM-0322): WASLA CI run 35855206395 success (38/38) · Roadmap freshness 35855160705 success
           ✅ main      — بعد الدمج (squash 2e79737): WASLA CI run 35856358621 success · Roadmap freshness 35856358794 success
PRODUCTION ✅ VERIFIED  — مواقعٌ ثابتةٌ ثلاثةٌ منشورةٌ على Render staging + خدمةُ wasla-audit منشورةٌ + نداءٌ حقيقيٌّ من متصفّحٍ حقيقيٍّ من منشأِ كلِّ تطبيقٍ يبلغُ خدمتَه (401 من الخدمة) — §3
```

## 2. ما نُشِر (قياسٌ مباشرٌ عبرَ Render API ‏2026-09-23)

| المورد | المعرّف | الحالة | الدليل |
|---|---|---|---|
| `wasla-customer-app` (static site) | deploy `dep-daprqrou01pc73do6h90` | live | `https://wasla-customer-app.onrender.com` جذرُها 200 بعنوان «وَصْلة» (مُقاسٌ في متصفّحٍ حقيقيّ) |
| `wasla-driver-app` (static site) | deploy `dep-daprqrou01pc73do6hc0` | live | `https://wasla-driver-app.onrender.com` جذرُها 200 بعنوان «وَصْلة — السائق» |
| `wasla-admin-app` (static site) | deploy `dep-daprqrou01pc73do6heg` | live | `https://wasla-admin-app.onrender.com` جذرُها 200 بعنوان «Wasla Admin» |
| `wasla-audit` (web service) | srv `srv-daprrq0u01pc73do9npg` · deploy `dep-daprrqgu01pc73do9qd0` | live | `/health` مباشرةً → 200 · منشورةٌ عبرَ Render API بمطابقةِ إعلانِها في `infra/terraform/render.tf` (`WASLA_SERVICE=@wasla/audit-service`) |
| ترحيلُ التدقيق | `services/audit/drizzle/0000_audit_baseline.sql` | مُطبَّق | جدولُ `audit_events` على قاعدةِ staging (القياسُ قبل/بعد: `to_regclass` ‏null → `audit_events`) |
| روابطُ البوتات | `*_BOT_MINI_APP_URL` ×3 | محدَّثة | customer-bot ← customer-app · driver-bot ← driver-app · partner-bot ← admin-app (كانت قيمةً موضعيةً) |

**عددُ خدماتِ الإنتاج:** 17 خدمةً ويب + 3 مواقعَ ثابتة (كانت 16 قبل هذا البند — كانت `wasla-audit` الوحيدةَ المعلنةَ في `render.tf` بلا نشرٍ فعليّ).

**انحرافٌ مسجَّل (staging-only):** خدمةُ `wasla-audit` وُقِّعَت بمفتاحِ خدمةٍ staging مُستحدَثٍ (`kid=stg-audit-k1`، سرٌّ ≥48 بايتًا)، لأنّ قراءةَ مفاتيحِ الخدماتِ الحيّةِ الأخرى من Render غيرُ متاحةٍ لنا (المتغيّراتُ السرّيةُ لا تُعادُ قيمُها). هذا انحرافُ مفاتيحَ بينَ الخدماتِ في staging فقط، ويُحلُّ بدورةِ تدويرِ المفاتيحِ الموحّدةِ عندَ حاجةِ نداءِ الخدمةِ للخدمة. لا يخالفُ أيَّ إلزامٍ في المستودعِ (المفاتيحُ لا تُخزَّنُ في المستودع).

## 3. الإثباتُ الحيُّ — نداءٌ حقيقيٌّ من تطبيقٍ منشورٍ يبلغُ خدمتَه (PRODUCTION ✅)

الطريقةُ: متصفّحٌ حقيقيٌّ (Chromium عبرَ CDP) يُحمِّلُ كلَّ تطبيقٍ منشورٍ على عنوانِهِ العامّ، ثمّ يُنفِّذُ `fetch()` من سياقِ صفحةِ التطبيقِ نفسِها (نفسُ المنشأ — لا CORS، لا baseUrl) عبرَ بادئاتِ التوجيهِ الـ19. الحالةُ 401 بردِّ الخدمةِ الموقَّع (`AUTHN_UNAUTHENTICATED` بمعرّفِ أثرٍ فريد) تعني أنّ النداءَ **بلغَ الخدمةَ الحقيقيّةَ وردَّت هي** — نفسُ معيارِ حفر M2-09.

| منشأُ التطبيقِ المنشور | البادئة → الخدمة | الحالة | الدليلُ من الردِّ |
|---|---|---|---|
| `https://wasla-customer-app.onrender.com` | `/customers/WS-1234567890/profile` → wasla-customers | **401** | `{"code":"AUTHN_UNAUTHENTICATED","trace_id":"req-5"}` |
| `https://wasla-customer-app.onrender.com` | `/search/products?...` → wasla-search | **401** | `trace_id":"0ba1c9f3-86f6-4a04-89af-b5fc2aa10b5a` (صيغةُ أثرِ search المختلفةُ عن غيرِها — تُثبِتُ أنها الخدمةُ لا وسيط) |
| `https://wasla-customer-app.onrender.com` | `/stores` → wasla-marketplace | **401** | ردُّ خدمةِ marketplace (curl، نفسُ الجلسة) |
| `https://wasla-driver-app.onrender.com` | `/dispatch/jobs/job-1/offers` → wasla-dispatch | **401** | `{"code":"AUTHN_UNAUTHENTICATED","trace_id":"req-3"}` |
| `https://wasla-driver-app.onrender.com` | `/drivers/drv-123` → wasla-drivers | **401** | ردٌّ بصيغةِ drivers المتشعّبة (`error.code` متداخلةً) |
| `https://wasla-driver-app.onrender.com` | `/orders/drivers/drv-123/jobs` → wasla-orders | **401** | `{"code":"AUTHN_UNAUTHENTICATED","trace_id":"req-3"}` |
| `https://wasla-admin-app.onrender.com` | `/audit/events` → **wasla-audit (المنشورةُ في هذا البند)** | **401** | `{"code":"AUTHN_UNAUTHENTICATED","trace_id":"req-3b"}` — نفسُ الردِّ من النداءِ المباشرِ للخدمة |
| `https://wasla-admin-app.onrender.com` | `/customers` → wasla-customers | **401** | `{"code":"AUTHN_UNAUTHENTICATED","trace_id":"req-7"}` |

**قياساتٌ مساندة:** النداءُ المباشرُ `https://wasla-audit.onrender.com/health` → 200، و`/audit/events` مباشرةً → 401 بنفسِ الصيغةِ والرسالةِ العربيةِ اللتينِ عادَتا عبرَ منشأِ لوحةِ الإدارة — أي أنّ إعادةَ الكتابةِ شفّافةٌ تُمرِّرُ الردَّ من الخدمةِ كما هو. وأزمنةُ الاستجابةِ الأولى عبرَ بعضِ البادئاتِ بلغَت ~31 ثانية (إيقاظُ الخدماتِ النائمةِ على الخطةِ الحرة) ثم عادت إلى ~0.15 ثانية — سلوكُ إيقاظٍ معروفٌ لا خللُ توجيه.

**ما لم يُدَّعَ (صدقُ القياس):** رحلةُ المصادقةِ الكاملةُ (Telegram initData → توكن → 200) لم تُقَس: خارجَ Telegram تنتظرُ التطبيقاتُ الثلاثةُ على «جارٍ التحميل…» (مُقاسٌ في المتصفّحِ الحقيقيّ: لا نداءاتِ شبكةٍ بعدَ التحميل — التطبيقُ ينتظرُ سياقَ Telegram قبلَ الإقلاع). معيارُ القبولِ المسجَّلُ للبندِ هو «نداءٌ حقيقيٌّ من تطبيقٍ منشورٍ يبلغُ خدمتَه» — وهذا مُقاسٌ ومُوثَّقٌ أعلاه. ما يتجاوزُه (رحلةٌ مصادَقةٌ من داخلَ Telegram) يتطلّبُ وصولًا إلى بيئةِ Telegram نفسِها، وهو خارجُ نطاقِ هذا البند.

## 4. حارسُ المسار (الفحصُ 24 — البابُ السادس)

- **6-أ:** بادئةُ نداءٍ في `apps/*/src` بلا صفٍّ في `infra/render/app-rewrites.json` → إسقاط.
- **6-ب:** صفٌّ يوجِّهُ البادئةَ إلى غيرِ الخدمةِ المطابِقةِ للمساراتِ المعلنةِ في `service_routes` → إسقاط.
- **6-ج:** بادئةٌ ميّتةٌ في الجدولِ لا يناديها تطبيقٌ → إسقاط.
- **`REWRITE_PREFIXES = 19`** منشورٌ في [`APP_API_ROUTES.md`](APP_API_ROUTES.md) ويطابقُ القياسَ وterraform معًا.
- **7 حالاتِ طفرةٍ** في `gov-cases-app-api-routes.sh` تعضُّ كلَّ بابٍ (تصديرٌ قبلَ التحقّق، رفضُ إسقاطٍ صامت).
- SPA fallback: `/* → /index.html` دائمًا **الأخير** في كلِّ موقعٍ ثابت (يفحصُهُ البابُ 6 عبرَ ترتيبِ الصفوفِ في JSON المُولَّد).

## 5. القرارُ المعماريُّ والملكيّة

- [`ADR-048`](../15-decisions/ADR-048-app-access-path-static-sites-rewrites.md): مواقعٌ ثابتةٌ + إعادةُ كتابةٍ على Render — لا بوّابةَ خلفيّةَ ولا CORS ولا تغييرِ كودِ التطبيقات (`baseUrl=""` يبقى).
- مصدرُ الحقيقةِ الوحيدُ للتوجيه: `infra/render/app-rewrites.json` (19 بادئةً) — تقرؤهُ terraform (`infra/terraform/apps/`) والفحصُ 24 معًا.
- الحالةُ السابقةُ (قبلَ هذا البند) والقياساتُ المرجعيّةُ في [`APP_API_ROUTES.md`](APP_API_ROUTES.md) §6.

## 6. أثرُ الحالة (نقلٌ تبعيّ)

- **M3-04** → Completed: الشرطُ الثالثُ (حسمُ طبقةِ التوجيهِ العامة) مُنجَزٌ بهذا البند — [`M3-04_GATE.md`](M3-04_GATE.md) حُدِّث.
- **M3-08** → Completed: آخرُ شرطٍ مفتوحٍ فيه كان شرطَ M3-04 الثالث؛ ملفّاتُ البوّابةِ الأربعةُ قائمةٌ بطبقاتِها الثلاث.
- **M3-06 · M3-07** يُصبحانِ قابلَينِ للبدء (اعتماديّتُهما M3-01..04 مكتملة).
- النقلُ إلى Completed بتفويضِ المالكِ المكتوبِ في الجلسةِ (دمجُ كلِّ أخضرٍ دونَ سؤال) — سابقةُ M3-05.

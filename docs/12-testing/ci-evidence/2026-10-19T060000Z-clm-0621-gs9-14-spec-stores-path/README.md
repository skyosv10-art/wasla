# CLM-0621 — G-S9.14: تصحيحُ تقادمِ CMS §8 (مسارُ marketplace)

**الحجزُ:** CLM-0621 · **العنصرُ:** M0-53 · **الأساسُ:** main `f27148b1`. **النطاقُ:** G-S9.14 وحدَه (RQ-CMA-27) — وثائقُ فقط؛ لا كودَ ولا عقدَ ولا قائمةَ سماحٍ ولا `production_open`. **لا يُعلَنُ أنَّ شاشةَ المتاجرِ متاحةٌ للمستخدمينَ.**

## §1 القياسُ قبلَ (كلُّ مصدرٍ مقروءٌ على `f27148b1`)

| المصدرُ | المسارُ |
|---|---|
| CMS §8 L184 (قبلَ) | `GET /marketplace/stores` · `GET /marketplace/stores/{slug}/products` |
| العقدُ `docs/04-api/MARKETPLACE_HTTP.md` #4 · #12 | `GET /stores` · `GET /stores/{storeSlug}/products` |
| الخدمةُ `services/marketplace/src/http/app.ts` L413 · L425… | `app.get("/stores", …)` · `/stores/:storeSlug/...` |
| التوجيهُ `infra/render/app-rewrites.json` L29 | `"/stores": "marketplace"` |
| التطبيقُ `apps/customer-mini-app/src/screens/Marketplace.tsx` L39 · L53 | `apiClient.get("/stores")` · `` `/stores/${slug}/products` `` |
| الحدُّ `packages/channel-edge/allowlist/customer-mini-app.json` | `/stores` W `production_open=false` حتى G-ENF(marketplace) · `/stores/:storeSlug/products` P `production_open=false` حتى E-20 |

خمسةُ مصادرَ متّفقةٌ على `/stores`؛ §8 وحدَها متقادمةٌ — والعقدُ المنفَّذُ مرجعٌ (نمطُ G-S11، تفكيكُ [CLM-0611](../2026-10-18T093000Z-clm-0611-gs9-customer-decomposition/README.md) §2). لا PR سابقٌ لـG-S9.14 (`gh pr list --search G-S9.14` ← #762 التفكيكُ وحدَه) وآخرُ تعديلٍ للمواصفةِ `8045af6a` (#364).

## §2 التغييرُ

- `docs/01-product/CUSTOMER_MINI_APP_SPEC.md` §8: صفُّ marketplace ← `GET /stores, GET /stores/{storeSlug}/products` مع إبقاءِ النصِّ السابقِ مقتبسًا في الملاحظةِ (تصحيحٌ بالإضافةِ لا محوٌ) وذكرِ حجبِ الحدِّ صراحةً · `Last Updated` ← 2026-10-19.
- `docs/01-product/REQUIREMENTS_REGISTRY.md`: ملاحظتا G-S9.14 وRQ-CMA-27.

## §3 ما لا يغيّرُه

الحدُّ يحجبُ المسارَينِ: هذا التصحيحُ يجعلُ المواصفةَ صادقةً في **اسمِ** المسارِ فقط، ولا يُثبتُ وصولَ العميلِ إلى قائمةِ المتاجرِ. RQ-CMA-27 بوصفِه سلوكًا للمستخدمِ يبقى معلَّقًا على G-ENF(marketplace) (قرارُ مالكٍ) وE-20.

## §4 الإغلاقُ

G-S9.14 يُغلقُ في سجلٍّ لاحقٍ بعدَ نجاحِ WASLA CI على SHA الدمجِ في main. وثائقُ فقط ← لا نشرَ. **G-S9 الأمُّ تبقى مفتوحةً.**

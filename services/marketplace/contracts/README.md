# عقود خدمة أساس السوق — `services/marketplace/contracts`

> **الطور:** 11 — Marketplace Foundation
> **المرجع الحاكم:** [ADR-016](../../../docs/15-decisions/ADR-016-marketplace-store-ownership-catalog-and-moderation-boundary.md)
> **وثيقة المجال:** [`docs/03-domain/MARKETPLACE_CATALOG.md`](../../../docs/03-domain/MARKETPLACE_CATALOG.md)
> **المنفذ:** `8094`

---

## ما هذا المجلد

عقود الخدمة **قبل** أي تنفيذ. لا كود خدمة في هذا الطور بعد: المراجعة 1/6 عقود ووثائق
وحزمة أنواع فقط، ولا `src/` في `services/marketplace`. والملفات الخمسة هي مصدر الحقيقة
لما يبنى لاحقاً:

| الملف | ما يحكمه | من يقرؤه |
|---|---|---|
| `schema.sql` | عشرة جداول: شجرة التصنيفات، المتاجر ودفتر قراراتها وطاقمها، المنتجات ودفتر اعتدالها، دفتر فروق المخزون وإسقاط رصيده، سجل المفاتيح، وصندوق الصادر | طبقة الاستمرارية وحرّاس الانحراف |
| [`api.openapi.yml`](api.openapi.yml) | خمسةَ عشرَ مساراً فريداً وتسعَ عشرةَ عمليّة على المنفذ 8094 | طبقة HTTP ومولّد الأنواع |
| `events.json` | ثلاثةَ عشرَ حدثاً بمنتج واحد `marketplace-service` | مستهلكو الأحداث |
| `errors.md` | أربعةٌ وعشرون رمز خطأ في خمسة أصناف | كل مستهلك يتعاقد على `error.code` |
| [`README.md`](README.md) | حدّ العقد وملكيته وحرّاس انحرافه | فريق Phase 11 وكل مراجع للعقد |

---

## العقد أولاً ([ADR-004](../../../docs/15-decisions/ADR-004-typed-contracts-from-openapi.md))

الأنواع تُولّد من العقد ولا تُكتب بيد ثانية:

```bash
pnpm --filter @wasla/contracts-marketplace generate   # openapi-typescript → src/api-types.ts
```

حرّاس الانحراف في `packages/contracts/marketplace/src/__tests__` يقرأون هذه العقود من
القرص. لا تُسجل هنا أرقام اختبارات أو نتائج قياس؛ لم تُقَس بعد.

| الحارس | ما يثبته |
|---|---|
| `contracts.test.ts` | أكواد `errors.md` وأصنافها ورموز HTTP = الثوابت · مسارات OpenAPI = `MARKETPLACE_API_PATHS` · المنفذ في `servers` = `MARKETPLACE_SERVICE_PORT` · لا `502` ولا مسارَ نبضة |
| `events.test.ts` | الأحداث الثلاثةَ عشرَ بأسمائها ومنتج واحد · `occurred_for` و`additionalProperties: false` في كل حدث · لا سعرَ ولا نصَّ حرٍّ في أي حمولة · لا حدثَ ظهورٍ ولا حذفٍ |
| `schema.test.ts` | الجداول العشرة بأسمائها · التعدادات = الثوابت حرفاً · القيود المسمّاة موجودة · جدولا الانتقالات بلا رجوعٍ من `archived` |
| `boundary.test.ts` | لا حركةَ مالٍ ولا FK عابر · لا هاتف ولا اسم ولا معرّف قناة · لا `is_visible` عموداً ولا `quantity_reserved` · لا `tsvector` ولا بحث · المنفذ 8094 لا يصطدم بطور سابق |

---

## من يملك ماذا

| الحقيقة | مالكها | كيف تصل هنا أو تبقى خارجه |
|---|---|---|
| هوية المالك والعضو وأهليته وإيقافه | `services/identity` · `services/drivers` | `WS-##########` opaque فقط؛ لا FK ولا قرارَ إيقافٍ على شخصٍ صادرٌ من هنا |
| اشتراك المالك واستحقاقه | `services/subscriptions` ([ADR-015](../../../docs/15-decisions/ADR-015-driver-subscription-entitlement-ledger-and-derived-referral-rewards.md)) | لا قراءةَ ولا شرطَ في هذا الطور: تسجيلُ المتجرِ لا يسأل عن اشتراك |
| المتجر وطاقمه وحالته ودفتر قراراته | `services/marketplace` | تُحفظ وتُشتق وتُعاد هنا |
| المنتج وتصنيفه وسعره واعتداله ومخزونه | `services/marketplace` | تُحفظ وتُشتق وتُعاد هنا |
| البحث والفرز بالصلة | Phase 12 (Search) | لا `tsvector` ولا `?q=` هنا؛ القراءةُ ترشيحٌ وترقيمٌ بمفتاحٍ ثابت |
| السلّة والحجز وطلب الشراء | Phase 13 (Commerce) | لا `quantity_reserved` ولا مسارَ حجزٍ؛ المخزونُ دفترُ فروقٍ يملكه المتجر |
| الشراكة ونقل الملكية والعمولة | Phase 14 (Partner & Catalog) | لا نقلَ ملكيّةٍ هنا؛ `owner` دورٌ لا يُزال |
| لوحة الاعتدال وطابورها | Phase 15 (Admin) | تستهلك أحداثَ القرارات وتقرأ `GET /stores?state=pending_review` |
| السعر والفاتورة والدفع والاسترداد | Phase 17 (Billing) | `price_minor_units` بيانُ كتالوجٍ لا حركةُ مال؛ لا مبلغَ ولا عمولةَ هنا |

---

## الحدود الملزمة

1. **القرار يُخزَّن والحالة تُشتق.** `store_reviews` و`product_reviews` append-only،
   و`stores.state` و`products.moderation_state` صفوفٌ متحقّقة. إسقاطُهما وإعادةُ بنائهما من
   الدفترِ عملٌ بلا خسارة.
2. **الاعتماد قرارُ إنسان لا نتيجةُ زمن.** لا `POST /tick` في هذا العقد ولا `is_stale` ولا
   `next_review_at`؛ مرورُ يومٍ لا يعتمد متجراً.
3. **الظهور مُشتَقٌّ لا مُخزَّن.** `is_visible` لا وجودَ له في أيِّ جدول: المتجرُ `approved` ∧
   المنتجُ `published` ∧ الاعتدالُ `approved` ∧ `quantity_on_hand > 0`.
4. **لا مالَ في العقد.** `price_minor_units` عددٌ صحيحٌ بالهللات و`currency_code = 'SAR'`
   وحدَها؛ لا `vat` ولا `discount` ولا `fee` ولا `commission` ولا `invoice` ولا `total` ولا
   `payout`، ولا `NUMERIC` ولا `FLOAT` في أيِّ حقل. **ولا سعرَ في أيِّ حمولةِ حدث.**
5. **المخزون دفترُ فروقٍ والرصيد إسقاط.** `inventory_adjustments` فروقٌ موقّعةٌ غيرُ صفريّةٍ
   بـ`quantity_after` وتسلسل، و`product_inventory.quantity_on_hand` إسقاطٌ يطابق مجموعَه.
   لا `quantity_reserved` ولا `quantity_available`.
6. **الإيقاف حدُّ اعتدالٍ على متجرٍ لا عقوبةٌ على شخص.** لا صفةَ حجبٍ على المالكِ في أيِّ
   جدولٍ هنا، ولا يمسّ قرارُ المتجرِ هويّتَه ولا سائقيّتَه ولا اشتراكَه.
7. **`slug` فريدٌ بلا حساسيةٍ لحالةِ الأحرفِ ومُقفَلٌ بعد أوّلِ اعتماد**، والأرشفةُ لا تُحرّره.
   والرابطُ العميقُ **يُبنى من قالبٍ في حزمة العقد ولا يُخزَّن**.
8. **الأدوار ثلاثةٌ والمالكُ واحد.** `owner` · `manager` · `staff`، و`ux_store_staff_single_owner`
   حارسُ الوحدانيّة، ودورُ المالكِ لا يُزال. والإزالةُ `removed_at` لا `DELETE`.
9. **لا حذفَ صلبٌ ولا بحثٌ هنا.** النهايةُ `archived` في المتجرِ والمنتج، والبحثُ Phase 12.
10. **النصُّ الحرُّ يبقى في المورد.** `title_*` و`description_ar` تُقرأ من الموردِ ولا تُسافر
    في حدثٍ ولا تُعاد في تفاصيلِ خطأ.

---

## سطح العقد الثابت

| المجال | القيم الملزمة |
|---|---|
| حالات المتجر | `STORE_STATES = ["draft","pending_review","approved","rejected","suspended","archived"]` |
| قرارات المتجر | `STORE_DECISIONS = ["review_requested","approved","rejected","suspended","reinstated","archived"]` |
| أسباب رفض المتجر | `STORE_REASON_CODES = ["incomplete_profile","prohibited_category","duplicate_store","misleading_title","unverified_owner","policy_violation","owner_request"]` |
| حالات المنتج | `PRODUCT_STATES = ["draft","published","archived"]` |
| اعتدال المنتج | `PRODUCT_MODERATION_STATES = ["pending","approved","rejected"]` · `PRODUCT_DECISIONS = ["approved","rejected"]` |
| أسباب رفض المنتج | `PRODUCT_REASON_CODES = ["prohibited_item","misleading_title","wrong_category","price_implausible","duplicate_listing","policy_violation"]` |
| أسباب فرق المخزون | `INVENTORY_REASON_CODES = ["initial_stock","restock","correction","shrinkage","archive_zeroed"]` |
| الأدوار والفاعلون | `STORE_STAFF_ROLES = ["owner","manager","staff"]` · `STORE_ACTOR_TYPES = ["owner","moderator","system"]` · `PRODUCT_ACTOR_TYPES = ["moderator","system"]` |
| ثوابت الإطلاق | `MARKETPLACE_CURRENCY_CODE = "SAR"` · `PRICE_MINOR_UNITS_MIN = 1` · `PRICE_MINOR_UNITS_MAX = 100000000` · `INVENTORY_DELTA_ABS_MAX = 1000000` · `CATEGORY_MAX_DEPTH = 2` · `STORE_ACTIVE_LIMIT_PER_OWNER = 1` |
| المنفذ والأنماط | `MARKETPLACE_SERVICE_PORT = 8094` · `^WS-[0-9]{10}$` · `^[a-z][a-z0-9-]{2,47}$` · `^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$` |
| المحجوز | `RESERVED_STORE_SLUGS = ["admin","api","app","help","store","stores","support","wasla","www"]` |

الأكواد الأربعةُ والعشرون موزّعة على: 400 `MARKETPLACE_VALIDATION_FAILED` ·
`MARKETPLACE_IDEMPOTENCY_KEY_REQUIRED` · `MARKETPLACE_FILTER_REQUIRED`؛ 404
`STORE_NOT_FOUND` · `PRODUCT_NOT_FOUND` · `STORE_CATEGORY_NOT_FOUND` ·
`STORE_STAFF_NOT_FOUND`؛ 409 `MARKETPLACE_IDEMPOTENCY_KEY_REUSED` · `STORE_SLUG_TAKEN` ·
`STORE_OWNER_LIMIT_REACHED` · `PRODUCT_SKU_TAKEN` · `STORE_STAFF_ALREADY_MEMBER` ·
`STORE_REVIEW_ALREADY_PENDING` · `STORE_DECISION_NOT_ALLOWED` ·
`PRODUCT_TRANSITION_NOT_ALLOWED`؛ 422 `STORE_SLUG_RESERVED` · `STORE_NOT_APPROVED` ·
`PRODUCT_NOT_MODERATED` · `STORE_CATEGORY_INACTIVE` · `PRODUCT_CATEGORY_NOT_LEAF` ·
`STORE_OWNER_ROLE_IMMUTABLE` · `INVENTORY_INSUFFICIENT_QUANTITY` ·
`STORE_REJECTION_REASON_REQUIRED`؛ و503 `MARKETPLACE_UNAVAILABLE`.

---

## ما ليس هنا

كود خدمة أو `src/` · نبضة زمن أو مؤقّت · `is_visible` عموداً · حجز أو سلّة أو طلب شراء
(Phase 13) · بحث أو `tsvector` أو `?q=` (Phase 12) · نقل ملكية أو عمولة أو شراكة
(Phase 14) · لوحة اعتدال (Phase 15) · سعر يتحرّك أو فاتورة أو استرداد (Phase 17) ·
هوية أو هاتف أو بريد أو إحداثية أو معرّف قناة · FK عابر لحد خدمة · حذف صلب · تقييمات
أو مراجعات مشترين · صور أو وسائط · ناشر صندوق الصادر · واجهة مستخدم.

---

> **Scope:** عقود `services/marketplace` في Phase 11، للمراجعة 1/6 (عقود ووثائق وحزمة أنواع فقط).
>
> **Last Updated:** 2026-08-24
>
> **Status:** Accepted — لا كود خدمة ضمن هذا النطاق.
>
> **Related Code:** `services/marketplace/contracts/` · `packages/contracts/marketplace/`
>
> **Related Team:** Team 06 — Marketplace (مالك `services/marketplace/` في [CODEOWNERS](../../../CODEOWNERS)) · Team 09 — Data (شجرة التصنيفات) · Team 08 — Admin (مستهلك أحداث القرارات في Phase 15)

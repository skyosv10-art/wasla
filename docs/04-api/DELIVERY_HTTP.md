# Delivery Service — طبقة HTTP (Phase 13 · المراجعة 6/N)

> **النوع:** توثيق واجهة (API Layer) · **Scope:** حدُّ HTTP لطلباتِ المتجرِ ومهمّةِ التوصيلِ: المساراتُ الخمسةُ، وشكلُ الخطأِ، وجذرُ التركيبِ، وحدودُه المُعلَنةُ.
>
> **المصدر الكنسي للعقد:** [`services/delivery/contracts/api.openapi.yml`](../../services/delivery/contracts/api.openapi.yml) · [`errors.md`](../../services/delivery/contracts/errors.md) · [`schema.sql`](../../services/delivery/contracts/schema.sql) · [`events.json`](../../services/delivery/contracts/events.json)
>
> **الخدمة:** `services/delivery` (منفذ **8097**) · **Status:** In Progress (المراجعة 6/N — HTTP مُنفَّذةٌ) · **Last Updated:** 2026-09-10
>
> **Related Code:** `services/delivery/src/http/{app,requests,errors,mappers,server}.ts` · `services/delivery/src/domain/{store-order-placement,store-order-cancellation,state-machine,events}.ts` · `services/delivery/src/use-cases/{place-store-order,cancel-store-order}.ts` · `services/delivery/src/infrastructure/store-order-store.ts` · `services/delivery/src/__tests__/{store-order-http,store-order-domain,store-order.integration}.test.ts`
>
> **Related Docs:** [ADR-026](../15-decisions/ADR-026-store-orders-and-delivery-boundary.md) · [SEARCH_HTTP](SEARCH_HTTP.md) (نسقُ الحدِّ) · [MARKETPLACE_HTTP](MARKETPLACE_HTTP.md) (مصدرُ الكتالوجِ) · [DISPATCH_HTTP](DISPATCH_HTTP.md)

---

## 1. ماذا يُضاف في هذه المراجعة

ترفعُ هذه المراجعةُ **جانبَ HTTP** من التأجيلِ المُعلَنِ في [ADR-026 §4.2](../15-decisions/ADR-026-store-orders-and-delivery-boundary.md) فوقَ المراجعاتِ 1/N–5/N (العقدُ والنطاقُ · مستهلكُ dispatch · محوّلاتُ PostgreSQL · سلكُ التفويضِ · مستهلكُ المخزونِ):

- **حدُّ HTTP** (`src/http/`): تطبيقُ Fastify مُحقَنٌ بمنافذَ، ومعالجُ أخطاءٍ واحدٌ، ومُحلِّلاتُ طلبٍ صارمةٌ، ومُعيِّناتٌ صريحةٌ.
- **قرارا نطاقٍ نقيّانِ**: `buildStoreOrderPlacement` (بناءُ الطلبِ والمهمّةِ والمجاميعِ) و`decideCancellation` (الإلغاءُ بحسبِ جدولَي §3.1 و§3.3 لا بحسبِ نيّةِ العميلِ).
- **حالتا استخدامٍ**: `placeStoreOrder` و`cancelStoreOrder` — تنسيقٌ بلا SQL وبلا HTTP.
- **مخزنُ طلباتِ المتجرِ** (`infrastructure/store-order-store.ts`): تنفيذُ منفذَي القراءةِ والكتابةِ على `pg.Pool` بمعاملةٍ واحدةٍ لكلِّ أمرٍ.
- **جذرُ تركيبٍ** (`http/server.ts`): يقرأُ `DATABASE_URL` ويوصّلُ المخزنَ ويستمعُ على `PORT`.

---

## 2. المساراتُ الخمسةُ (لا سادسَ)

| الطريقةُ والمسارُ | الغرضُ | النجاحُ |
|---|---|---|
| `POST /store-orders` | إنشاءُ طلبِ متجرٍ ومهمّةِ توصيلِه | **201** `StoreOrderResource` |
| `GET /store-orders/{orderPublicId}` | قراءةُ الطلبِ بأصنافِه | **200** `StoreOrderResource` |
| `POST /store-orders/{orderPublicId}/cancellation` | إلغاءُ الطلبِ بسببٍ من كتالوجٍ مغلقٍ | **200** `StoreOrderResource` |
| `GET /store-orders/{orderPublicId}/delivery-task` | قراءةُ مهمّةِ التوصيلِ (مرآةٌ خشنةٌ) | **200** `DeliveryTaskResource` |
| `GET /delivery/health` | **حياةٌ (liveness)** بلا تبعيّةٍ | **200** `{ status: "ok" }` |

`orderPublicId` بنمطِ `^WS-[0-9]{10}$` حصراً — كلُّ ما دونَه **400 قبلَ لمسِ القاعدةِ**. ولا مسارَ جاهزيّةٍ (`/delivery/ready`) في هذه المراجعةِ: الحدُّ مُعلَنٌ في [ADR-026 §4.9-4](../15-decisions/ADR-026-store-orders-and-delivery-boundary.md) ومقيسٌ باختبارٍ يؤكّدُ أنّ الطلبَ عليه **404** (لا يُدَّعى ما لا يُنفَّذُ).

### 2.1 الإنشاءُ: الأسعارُ لا تأتي من العميلِ

```json
POST /store-orders
{ "customer_ref": "WS-0000000009", "store_public_id": "WS-0000000002",
  "items": [{ "product_id": "…uuid…", "quantity": 2 }],
  "delivery_fee_minor_units": 500 }
```

- **لا حقلَ سعرٍ في الطلبِ**. سعرُ الوحدةِ يُلتقَطُ من الكتالوجِ (`StoreOrderCatalogPort`) لحظةَ الإنشاءِ، ويُخزَّنُ لقطةً في `store_order_items`. عميلٌ يُهرِّبُ `unit_price_minor_units` يُهمَلُ حقلُه ويبقى المجموعُ مُشتقًّا من الكتالوجِ — **مقيسٌ باختبارٍ**، لا مأمولٌ.
- **`delivery_fee_minor_units` إلزاميٌّ**: الغائبُ ليس صفراً. أجرةٌ تُفترَضُ صفراً هي خصمٌ صامتٌ على المتجرِ.
- **العملةُ `SAR` ووحداتٌ صغرى صحيحةٌ** فقط، و`total = items_total + delivery_fee` — نفسُ المعادلةِ في النطاقِ وفي قيدِ `CHECK` بالمخطّطِ.
- تبدأُ الحالتانِ المتعامدتانِ: التنفيذُ `placed` والدفعُ `pending`، ومهمّةُ التوصيلِ `pending_eligibility` بلا سائقٍ ولا مهمّةِ توزيعٍ.

### 2.2 الإلغاءُ: الجدولُ المنشورُ يُقرِّرُ

`{ "reason_code": "CUSTOMER_CHANGED_MIND" }` — كتالوجٌ مغلقٌ (`STORE_ORDER_CANCEL_REASON_CODES`). والقرارُ من جدولَي الانتقالِ لا من الرغبةِ:

- **يُقبَلُ** من `draft` · `placed` · `confirmed` · `ready_for_delivery` (§3.1).
- **يُرفَضُ** بـ**409 `DELIVERY_CANCEL_NOT_ALLOWED`** من `picking` وما بعدَها — والرفضُ **لا يكتبُ شيئاً** (لا صفَّ دفترٍ ولا حدثاً في الصادرِ).
- **مهمّةُ التوصيلِ تُلغى معَه فقط حيثُ ينشرُ §3.3 حافّةً**: `eligible` · `dispatch_requested` · `driver_assigned`. وطلبٌ يُلغى بعدَ إنشائِه لحظةً تبقى مهمّتُه `pending_eligibility` — لا حافّةَ منشورةً منها، والحدُّ لا يخترعُها ([§4.9-1](../15-decisions/ADR-026-store-orders-and-delivery-boundary.md)).

---

## 3. شكلُ الخطأِ: `error_code` لا `code`

```json
{ "error_code": "DELIVERY_CANCEL_NOT_ALLOWED", "message": "…", "trace_id": "…" }
```

جسمٌ مسطّحٌ بثلاثةِ حقولٍ حسبَ [`errors.md`](../../services/delivery/contracts/errors.md) — **ويختلفُ عن البحثِ** الذي يُسمّي الحقلَ `code`. الاختلافُ مُثبَّتٌ باختبارٍ يقايسُ مفاتيحَ الجسمِ حرفاً بحرفٍ، لأنّ نسخَ نسقِ خدمةٍ أخرى بحسنِ نيّةٍ هو أكثرُ ما يُكسِرُ عميلاً مُولَّداً من العقدِ.

الترجمةُ من الخطأِ إلى الحالةِ في مكانٍ واحدٍ (`httpStatusForDeliveryError`): `validation ⇒ 400` · `not_found ⇒ 404` · `conflict ⇒ 409` · `dependency_unavailable ⇒ 503` · `internal ⇒ 500`.

### 3.1 الملاذُ الأخيرُ 500 لا 503 — عكسَ البحثِ عن قصدٍ

خطأٌ غيرُ مُصنَّفٍ يُرَدُّ **`500 DELIVERY_INTERNAL_ERROR`**. البحثُ يختارُ 503 لأنّ إعادةَ استعلامٍ آمنةٌ ورخيصةٌ. أمّا هنا فالمسارُ الحارُّ **يكتبُ**، ولا يقبلُ الحدُّ بعدُ مفتاحَ تماثُلٍ (`Idempotency-Key` — دَينٌ مُعلَنٌ في [§4.9-3](../15-decisions/ADR-026-store-orders-and-delivery-boundary.md)). فقولُ «أعد» لعميلٍ فشلَ إنشاءُ طلبِه لسببٍ مجهولٍ يُنتِجُ طلبَينِ على القاعدةِ ودفعتَينِ محتملتَينِ؛ و`500` تقولُ الحقيقةَ: عيبٌ يُفحَصُ لا عبورٌ يُعاد. والأخطاءُ المُعلَنةُ تبعيّةً (`DELIVERY_MARKETPLACE_UNAVAILABLE` · `DELIVERY_DISPATCH_UNAVAILABLE`) تبقى **503** — الملاذُ لا يبتلعُها (مقيسٌ باختبارَين متقابلَين).

---

## 4. الحدُّ مُحقَنٌ لا مُتصلٌ

`buildDeliveryHttpApp(deps)` يأخذُ `readPort` و`writePort` و`catalogPort` (اختياريٌّ) و`newUuid` و`now`. فلا يفتحُ التطبيقُ اتصالاً بنفسِه: 22 اختباراً على الحدِّ تركضُ بلا قاعدةِ بياناتٍ في أجزاءٍ من الثانيةِ، والتوصيلُ الفعليُّ في `http/server.ts` وحدَه.

- **معالجُ أخطاءٍ واحدٌ** (`setErrorHandler`) ولا `try/catch` في أيِّ معالِجٍ — ترجمةٌ واحدةٌ لا ترجمتانِ متباعدتانِ تنجرفانِ.
- **`genReqId`** يُولِّدُ `trace_id` لكلِّ طلبٍ، ويسيرُ مع الحدثِ إلى الصادرِ (`delivery_outbox.trace_id`) — مقيسٌ على قاعدةٍ حقيقيّةٍ.
- **المُعيِّناتُ صريحةٌ حقلاً حقلاً** (لا `...spread` ولا `as`): `store_id` الداخليُّ للسوقِ و`payment_ref` **لا يظهرانِ أبداً**، ولا اسمَ ولا هاتفَ ولا إحداثيَّ في مواردِ المهمّةِ (§2.6 — مقيسٌ باختبارٍ يفحصُ الجسمَ كلَّه بنمطٍ).

### 4.1 جذرُ التركيبِ جزئيٌّ — **مُعلَنٌ**

`catalogPort` **غيرُ موصولٍ** في `server.ts`. عقدُ السوقِ لا ينشرُ مرجعاً عامّاً للمتجرِ (`StoreResource` فيه `store_id` داخليٌّ و`store_slug` و`owner_public_id`، ولا `WS-` للمتجرِ نفسِه)، وADR-026 §2.3 يمنعُ الوصولَ المباشرَ لجداولِ السوقِ — فمحوّلُ HTTP للكتالوجِ **متعذّرٌ معماريّاً** حتى يُحسَمَ تعيينُ `store_public_id ⇄ store_id` ([§4.9-2](../15-decisions/ADR-026-store-orders-and-delivery-boundary.md)). ولا يُزيَّفُ الحدُّ ذلك: بلا منفذِ كتالوجٍ يُرَدُّ **`503 DELIVERY_MARKETPLACE_UNAVAILABLE`** على الإنشاءِ — لا سعرٌ مُخترَعٌ ولا صفرٌ افتراضيٌّ. والقراءاتُ والإلغاءُ تعملُ كاملةً بلا كتالوجٍ.

---

## 5. المخزنُ: معاملةٌ واحدةٌ لكلِّ أمرٍ

- **`nextOrderPublicId`** من متتالٍ في القاعدةِ (`store_order_public_id_seq` تبدأُ من `5000000001`) — لا عدَّادَ في الذاكرةِ ولا تصادمَ بينَ نسخٍ.
- **`placeOrder`**: معاملةٌ واحدةٌ تكتبُ `store_orders` + `store_order_items` + صفَّ دفترٍ `draft→placed` بسببِ `CART_CONFIRMED` وفاعلِ `customer` + `delivery_tasks` + حدثَي الصادرِ. فشلُ أيِّ صفٍّ ⇒ **لا شيءَ نجَا** (مقيسٌ بقيدٍ محقونٍ على قاعدةٍ حقيقيّةٍ).
- **`cancelOrder`**: `SELECT … FOR UPDATE` ثمّ فحصُ النسخةِ ⇒ اختلافُها **`DELIVERY_CONCURRENT_UPDATE`** بصفرِ كتابةٍ، ثمّ تحديثُ الحالةِ ودفترا الطلبِ والمهمّةِ والصادرُ في المعاملةِ نفسِها.
- **قوائمُ الأعمدةِ صريحةٌ** ولا `SELECT *`. وقراءةُ المهمّةِ بمعرّفِ الطلبِ العامِّ تُؤهِّلُ أعمدتَها بلقبِ الجدولِ لأنّ `order_id` في الجدولَينِ كليهما — وهذا **ما كشفَه اختبارُ التكاملِ** لا المراجعةُ الذهنيّةُ (§7 من إدخالِ السجلِّ).

---

## 6. ما لا يُدَّعى بعدَ هذه المراجعةِ

| المؤجَّلُ | أين يُسجَّلُ |
|---|---|
| محوّلُ كتالوجِ السوقِ (`catalogPort`) موصولاً في الإنتاجِ | [ADR-026 §4.9-2](../15-decisions/ADR-026-store-orders-and-delivery-boundary.md) — حجبٌ معماريٌّ (لا مرجعَ عامًّا للمتجرِ) |
| `Idempotency-Key` على `POST /store-orders` | [ADR-026 §4.9-3](../15-decisions/ADR-026-store-orders-and-delivery-boundary.md) — دَينٌ مُعلَنٌ يحكمُ اختيارَ 500 |
| حافّةُ `pending_eligibility → cancelled` في §3.3 | [ADR-026 §4.9-1](../15-decisions/ADR-026-store-orders-and-delivery-boundary.md) — قرارُ عقدٍ لا إصلاحُ شيفرةٍ |
| مسارُ جاهزيّةٍ يسألُ القاعدةَ (`/delivery/ready`) | [ADR-026 §4.9-4](../15-decisions/ADR-026-store-orders-and-delivery-boundary.md) · درسُ [`RISK-0030`](../07-security/RISK_REGISTER.md) في البحثِ |
| بوّابةُ خروجِ الطورِ (inventory/payment E2E) | ADR-026 §4 (البندُ 4) |
| ترحيلاتٌ مولَّدةٌ (drizzle) بدلَ `schema.sql` يدويّاً | ADR-026 §4 (البندُ 5) |

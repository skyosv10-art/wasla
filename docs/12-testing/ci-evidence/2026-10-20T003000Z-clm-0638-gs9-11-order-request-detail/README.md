# CLM-0638 — G-S9.11: شاشةُ تفاصيلِ الطلبِ في «طلباتي» + مدخلُ الحدّ (M0-53)

**الفرع:** `stage-zero/clm-0638-gs9-11-order-request-detail` · **البند:** M0-53 · **الفجوة:** G-S9.11 · **المتطلب:** RQ-CMA-41 (CMS §3.6 L87)
**الحالة عند البدء:** `main` = `f45391b8` (بعدَ CLM-0637) · WASLA CI على main ✓ (آخر تشغيلٍ ناجحٍ `39334683664`) · لا حجزٍ نشطٍ مطابقٍ (`find-existing-work.sh` — لا نتائج) · لا فرعٍ أو PR متعارضٍ.

## ما نُفِّذ

1. **الشاشة (CMS §3.6 L87 · L90):** النقرُ على طلبٍ في MyOrders يفتحُ «تفاصيلَ الحالةِ والمسارِ»: الحالةُ · فئةُ المركبةِ · السعرُ · تاريخُ الإنشاءِ · الملاحظاتُ · **المسارُ** (نقاطُ الالتقاط/التسليم معَ المسارِ أو المعرّفِ)، عبرَ `GET /customers/{id}/order-requests/{orderRequestId}` — زرُّ رجوعٍ يعيدُ إلى القائمة، و404 يُعرضُ «الطلبُ غيرُ موجود».
2. **مدخلُ الحدّ:** `GET /customers/:waslaPublicId/order-requests/:orderRequestId` (customers · **O** · `customers:order-request:read` · `production_open=false`) في `packages/channel-edge/allowlist/customer-mini-app.json` معَ دليلِ ملكيةٍ حقيقيٍّ: `returns one request and scopes it to its owner` (200 للمالكِ · 404 لغيرِهِ).
3. **قرارٌ موثَّق (ADR-074):** المسارُ موجودٌ في الشيفرةِ وغيرُ موجودٍ في لقطةِ CLM-0518 (كان التطبيقُ لا يناديه يومَ القياسِ)؛ فالحارسُ 28 يرفضُ `[EA-SNAPSHOT-NEW]`. أُضيف المسارُ إلى `route-enforcement.json` **بإضافةٍ مؤرَّخةٍ** (`added_by` على الصفِّ + سجلُّ `additions` علويٍّ؛ القياسُ الأصليُّ 67 مسارًا محفوظٌ حرفيًّا) بقرارٍ موثَّقٍ في [ADR-074](../../../15-decisions/ADR-074-edge-snapshot-gs9-11-addition.md) استنادًا إلى التفويضِ التنفيذيِّ المكتوبِ (مقتبسٌ هناك).
4. **اكتشافٌ مُصلَحٌ (سببٌ جذريٌّ):** التطبيقُ كان يقرأُ `order_request_id` من استجاباتِ الخدمةِ (القائمةُ · نتيجةُ الإرسالِ في RideOrder/DeliveryOrder) بينما العقدُ المنشورُ (`OrderRequest` في `packages/contracts/customer/src/api-types.ts`) والخدمةُ (`toOrderRequestDto`) يُرجعانِ `id` — فكانت القائمةُ تعرضُ مفاتيحَ `undefined` وشاشاتُ الإرسالِ تعرضُ «رقم الطلب: undefined». صُحِّح إلى `id` في MyOrders ومخزنِ النموذجِ (OrderRequestResult) والشاشتين، معَ تحديثِ الاختباراتِ. سُجِّلَ كاكتشافٍ في سطرِ G-S9.17 باللوحةِ (بالإضافةِ لا بالمحوِ).

## الفحوص المحلية (قبل الدفع)

| الفحص | النتيجة |
|---|---|
| `apps/customer-mini-app` unit (14 ملفًا) | ✓ **104/104** — [raw/unit-customer-mini-app.txt](raw/unit-customer-mini-app.txt) |
| `apps/customer-mini-app` typecheck | ✓ [raw/unit-customer-mini-app.txt](raw/unit-customer-mini-app.txt) |
| `services/customers` http (دليلُ الملكيةِ) | ✓ **35/35** — [raw/unit-services-customers.txt](raw/unit-services-customers.txt) |
| حارسُ قائمةِ السماحِ (28) | ✓ **30 مدخلًا** — [raw/edge-allowlist-guard.txt](raw/edge-allowlist-guard.txt) |

## النطاق المتأثر

- `apps/customer-mini-app/src/screens/MyOrders.tsx` (تفاصيل + `id`) · `src/store/order-form.ts` · `src/screens/RideOrder.tsx` · `src/screens/DeliveryOrder.tsx` (`id`) · `src/i18n/index.ts` (مفاتيحُ التفاصيلِ بالثلاثِ) · `src/__tests__/MyOrders.test.tsx` (+4 اختباراتِ تفاصيلٍ · `id`) · `__tests__/RideOrder.test.tsx` · `__tests__/DeliveryOrder.test.tsx`.
- `packages/channel-edge/allowlist/customer-mini-app.json` (مدخلٌ واحدٌ) · لقطةُ `route-enforcement.json` (إضافةٌ مؤرَّخةٌ).
- [ADR-074](../../../15-decisions/ADR-074-edge-snapshot-gs9-11-addition.md) · [EDGE_ALLOWLIST.md](../../EDGE_ALLOWLIST.md) (تحديثٌ مؤرَّخٌ).

## حكمُ CI على main (بعدَ الدمجِ)

- **PR #784** مدموجٌ (squash على main) — التزامُ الدمجِ `b65b2805` (2026-10-20T00:36:59Z) — [raw/pr-784-merged.json](raw/pr-784-merged.json).
- **WASLA CI** على `b65b280` (السيرُ 39348695447): **نجاحٌ — 41/41 وظيفةً كلُّها success** (typecheck · test · verify · governance-guard · db-integration ×14 · exit-gate-e2e · …) — [raw/ci-main-verdict-b65b280.json](raw/ci-main-verdict-b65b280.json).
- **Roadmap freshness** على `b65b280` (السيرُ 39348695716): **نجاحٌ** — [raw/ci-main-roadmap-freshness-b65b280.json](raw/ci-main-roadmap-freshness-b65b280.json).
- لا نشرَ ولا تشغيلَ لـRender (الهدفُ `frozen` — ADR-073)؛ تشغيلاتُ النبضِ والنسخِ الاحتياطيِّ المجدولةُ مستمرةٌ على main كالمعتادِ.

**الحُكمُ:** G-S9.11 / RQ-CMA-41 أُصلِحَ على main بدليلِ CI حيٍّ (b65b280)؛ G-S9 الأمُّ تبقى مفتوحةً حتى إغلاقِ بقيةِ البنودِ.

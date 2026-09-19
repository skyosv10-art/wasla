# ADR-042: آلية توصيل الصادر (Outbox Delivery Mechanism) — عقد مشترك ومحوّلات رقيقة

**الحالة:** Proposed
**التاريخ:** 2026-09-20
**مالك القرار:** Program Owner
**يُلزِم:** كل خدمة تملك جدول صادر في المستودع
**يُبطِل:** لا شيء
**ذو صلة:** [ADR-037](ADR-037-outbox-monotonic-sequence-number.md) · [ADR-026](ADR-026-store-orders-and-delivery-boundary.md) · [ADR-025](ADR-025-marketplace-search-read-model.md) · [ADR-017](ADR-017-unified-roadmap-governance-and-work-claim-system.md)

## السياق

فجوةُ `G1` الموثَّقةُ في [`M2-07_OUTBOX_TICK_DLQ_INVENTORY.md`](../08-infrastructure/M2-07_OUTBOX_TICK_DLQ_INVENTORY.md) §10:
**9 من 13 جدولَ صادرٍ بلا أيِّ آليةِ توصيلٍ** — أحداثٌ تُكتبُ ولا تُسلَّمُ.

| الخدماتُ التسعُ بلا آليّةٍ | الأربعُ التي لديها |
|---|---|
| customers · delivery · drivers · geography · identity · matching · negotiations · orders · search | reputation (drain) · subscriptions (drain) · dispatch (relay في delivery) · marketplace (relay ×2) |

### القياس الفعلي (لا التقدير)

النمطان الموجودان متطابقان في الجوهر:

- **`reputation`** ([`drain-outbox.ts`](../../services/reputation/src/outbound/drain-outbox.ts)): `claimUnpublished(limit)` ← حلقةٌ تُسلِّمُ كلَّ صفٍّ إلى `EventSinkPort` ← فشلُ صفٍّ لا يُوقفُ الدفعةَ ← `last_error` يُسجَّل.
- **`subscriptions`** ([`events.ts`](../../services/subscriptions/src/app/events.ts)): نفسُ النمطِ، لكن داخل `UnitOfWork.write` (معاملةٌ واحدةٌ تنتظرُ الشبكة).

لكنَّ الجداولِ التسعَ **غيرُ موحَّدة** (قياسٌ من `services/*/contracts/schema.sql`):

| الفرق | الخدمات |
|---|---|
| `id` ضدَّ `outbox_id` كمفتاحٍ أساسيٍّ | delivery يستخدم `outbox_id`، الباقي `id` |
| `event_id` كمفتاحٍ أساسيٍّ (لا `id` منفصل) | matching |
| `aggregate_type` غائب | geography |
| `aggregate_id` من نوع `UUID` | identity |
| `trace_id` غائب | customers · drivers · geography · identity · marketplace · search |
| `attempts`/`last_error` غائبان | كلُّ التسع (G3) |

فلا يمكنُ كتابةُ `drain` واحدٍ يفترضُ مخططًا موحَّدًا.

## القرار

**عقدُ صادرٍ مشتركٌ (`OutboxRecord`) + محوّلاتٌ رقيقةٌ لكلِّ خدمة**، لا تسعةُ `drain` مستقلّة.

### 1. عقدٌ مشتركٌ واحدٌ لا تسعة

حزمةٌ مشتركةٌ (مقترَحٌ: `packages/outbox/`) تُصدِّرُ:

- **`OutboxRecord`** — نموذجٌ عاديٌّ: `{ id: bigint, eventId: uuid, eventType: string, eventVersion: string, aggregateType?: string, aggregateId: string, payload: jsonb, traceId?: string, occurredAt: timestamptz }`. الحقولُ الاختياريّةُ تُقرأُ بـ`null` لا تُفترَضُ.
- **`OutboxDrainPort`** — `claimUnpublished(limit) → OutboxRecord[]` + `markPublished(id)` + `recordFailure(id, error)`.
- **`drainOutbox(port, sink, options)`** — الدالةُ المشتركةُ (نقلُ `reputation/drain-outbox.ts` إلى الحزمة، لا إعادةُ كتابتِه). `sink: EventSinkPort` وسيطٌ صريحٌ، وفشلُ صفٍّ لا يُوقفُ الدفعةَ، و`limit` مُصادَقٌ عليه.
- **`EventSinkPort`** — `deliver(record) → Promise<void>` (نقلٌ من موقعِه الحالي).

### 2. محوّلاتٌ رقيقةٌ لكلِّ خدمة

كلُّ خدمةٍ تُصدِّرُ مُحوّلًا واحدًا يربطُ جداولها الفعليّةَ بالعقد المشترك:

- يقرأُ `aggregate_type`/`aggregate_id`/`trace_id` إن وُجدت، ويُعيدُ `null` إن لم تكن.
- يُعرِّفُ `claimUnpublished` بـ`SELECT … WHERE published_at IS NULL ORDER BY <id-column> LIMIT n FOR UPDATE SKIP LOCKED` (عمودُ التسلسلِ من ADR-037).
- **لا يُكرِّرُ منطقَ الدفعِ أو معالجةَ الفشل** — ذلك في العقد المشترك.

### 3. موجاتُ التنفيذ

لا تُنفَّذُ التسعُ دفعةً واحدة. الموجات:

1. **موجةٌ أوّلٌ (إثباتُ النمط):** خدمةٌ واحدةٌ (مقترَحٌ `customers` — أصغرُ جدولٍ، `id BIGSERIAL`، `aggregate_type` موجود). تُنشأُ الحزمةُ المشتركةُ + المحوّلُ + اختبارُ تكاملٍ يُثبتُ `claim → deliver → markPublished` على PostgreSQL حقيقيّة.
2. **موجةٌ ثانية:** `drivers` + `geography` + `identity` (تغطي الفروق: `aggregate_type` غائب، `UUID aggregate_id`).
3. **موجةٌ ثالثة:** `delivery` + `matching` + `negotiations` + `orders` + `search` (تغطي `outbox_id`، `event_id` كمفتاحٍ أساسيٍّ، الجداولُ ذاتُ الحملِ).

### 4. حارسٌ آليٌّ لاحقٌ

بعدَ الموجةِ الأولى، يُضافُ فحصٌ في `verify-governance.sh` يُثبتُ أنَّ كلَّ `_outbox` في `services/*/contracts/schema.sql` له محوّلٌ مطابقٌ في `services/*/src/`. هذا يمنعُ رجوعَ الفجوةِ.

## البدائل المرفوضة

| البديل | سبب الرفض |
|---|---|
| **تسعةُ `drain` مستقلّة** | يُكرِّرُ المنطقَ نفسَه 9 مرّاتٍ، ويُنتجُ 9 مصادرَ حقيقةٍ لما يجبُ أن يكونَ واحدًا — ينافي ADR-017 §«أقلُّ مصادرِ حقيقةٍ مكرَّرة». |
| **relay consumer لكلِّ خدمة** | relay يستهلكُ صادرَ **خدمةٍ أخرى**؛ G1 هو تصريفُ صادرِ **الخدمةِ نفسها**. نمطٌ مختلفٌ لا حلٌّ لهذه الفجوة. |
| **انتظارُ منصةِ نشرٍ (M2-02)** | الفجوةُ منطقيّةٌ لا تشغيليّة: الكودُ يُكتبُ الآنَ ولا يُسلِّمُ. ولا يعتمدُ على Render. |
| **توحيدُ الجداولِ التسعِ أولًا** | يكسرُ ترحيلاتٍ عكوسةً مولَّدةً (ADR-024) ويأخذُ نطاقًا أوسعَ من M2-07. المحوّلاتُ تعزلُ الفرقَ دونَ لمسِ الجداول. |

## النتائج

**المكسوب:** مصدرُ حقيقةٍ واحدٌ لمنطقِ الدفعِ · عقدٌ قابلٌ للقياسِ الآليّ · موجاتٌ تُثبتُ النمطَ قبلَ التوسّعِ · لا انتظارٌ على M2-02.

**المفقود:** حزمةٌ مشتركةٌ جديدةٌ (`packages/outbox/`) تُضافُ إلى `WORK_INDEX.md` · 9 محوّلاتٍ تُكتبُ على موجاتٍ · اختباراتُ تكاملٍ لكلِّ موجة.

**الحدّ المُعلَن:** هذا القرار **لا يُسلِّمُ الأحداثَ فعلًا** — يُنشئُ العقدَ والمحوّلاتِ فقط. التسليمُ الفعليُّ يتطلّبُ `EventSinkPort` مُوصَلًا بوسيطٍ (Kafka/NATS/webhook) وهو قرارُ نشرٍ (M2-02/M2-09). ولا يُعالجُ G3 (`attempts`/`last_error`) ولا G5 (DLQ لـ search) — هذه ديونٌ منفصلة.

**لا يُرفعُ حاجزُ M2-02:** M2-07 يبقى `In Progress` حتى يكتملَ M2-02، حتى لو أُغلقتْ G1. هذا القرارُ يُغلقُ فجوةً داخليةً موثَّقةً، لا ينقلُ العنصرَ إلى `Ready for Gate`.

## المراجع

- [`M2-07_OUTBOX_TICK_DLQ_INVENTORY.md`](../08-infrastructure/M2-07_OUTBOX_TICK_DLQ_INVENTORY.md) — الجردُ والفجوات
- [`M2-07_GATE.md`](../12-testing/M2-07_GATE.md) — بوّابةُ M2-07
- [ADR-037](ADR-037-outbox-monotonic-sequence-number.md) — تسلسلُ الصادرِ الرتابب
- [ADR-026](ADR-026-store-orders-and-delivery-boundary.md) · [ADR-025](ADR-025-marketplace-search-read-model.md) — حدودُ relay
- [ADR-017](ADR-017-unified-roadmap-governance-and-work-claim-system.md) — قاعدةُ منعِ التكرار

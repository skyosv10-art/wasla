# Channel Layer Contracts (Phase 03)

> **Scope:** العقود التعاقدية لطبقة القنوات (Channel Layer) وفق [ADR-007](../../../docs/15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) — Contract First ([ADR-004](../../../docs/15-decisions/ADR-004-typed-contracts-from-openapi.md)).

## الملفات

| الملف | الوصف |
|---|---|
| `api.openapi.yml` | عقد واجهة OpenAPI 3.1: استقبال التحديثات (webhook) · إرسال الرسائل · Mini App Launch · Deep Links · health |
| `events.json` | عقد أحداث المجال (JSON Schema 2020-12): `channel.update.received.v1` · `channel.message.delivered.v1` · `channel.message.failed.v1` · `channel.mini_app.launched.v1` |
| `schema.sql` | DDL لسجل التحديثات (idempotency) + الرسائل الصادرة (retry) + outbox |
| `errors.md` | كتالوج أكواد الأخطاء الثابتة + خطة إعادة المحاولة |

## المبادئ

- **محايدة القناة (Channel-Agnostic):** لا يظهر أي حقل أو جدول أو كود خطأ باسم `telegram_*`. القناة تُمرَّر كقيمة في العمود/الحقل `channel` (`telegram` منفّذة في المرحلة 03؛ `web`/`mobile`/`whatsapp` محجوزة في العقد).
- **مدخل واحد ومخرج واحد:** كل تحديث وارد يدخل من `POST /channel/{bot}/webhook`، وكل رسالة صادرة تخرج من `POST /channel/messages`. **الـCore لا ينادي واجهة القناة مباشرة** — السلسلة: Notification Service → Channel Router → Channel Adapter.
- **Idempotency في الاتجاهين:** الوارد فريد بـ`(channel, bot, channel_update_id)`؛ الصادر فريد بـ`(channel, idempotency_key)`. المكرر يُرجَع بـ`status: duplicate` وليس خطأ.
- **تغليف الخدمات:** `chat_ref` مرجع opaque. ربط `chat_ref` ↔ `wasla_public_id` ملك خدمة Identity ([ADR-001](../../../docs/15-decisions/ADR-001-identity-decoupled-from-telegram.md)) — **لا FK إلى `identity_users`** ولا تخزين للربط هنا.
- **الأمن:** التحقّق من secret token للـwebhook قبل أي معالجة (401 `CHANNEL_UNAUTHORIZED_WEBHOOK`). كل البيانات الواردة من القناة **غير موثوقة** ويجب التحقّق منها داخل حدود المُهيّئ ([SECURITY_RULES](../../../docs/00-rules/SECURITY_RULES.md)).
- **قابلية الاستبدال:** كل منفذ (Port) له مُهيّئ Mock في الاختبارات — Exit Gate للمرحلة 03 يشترط استبدال مُهيّئ Telegram بـMock دون تعديل الـCore.

## الأنواع المُولّدة

الأنواع تُولّد في الحزمة `@wasla/contracts-channel`:

```bash
pnpm --filter @wasla/contracts-channel generate   # openapi-typescript
```

## Related

- [ADR-007](../../../docs/15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md) — مكدّس القناة وحدود العزل
- [CONTAINERS](../../../docs/02-architecture/CONTAINERS.md) — موقع طبقة القنوات في الحاويات
- [MASTER_PROGRESS](../../../docs/16-progress/MASTER_PROGRESS.md) — Phase 03
- [HANDOFF_NEXT_STEPS](../../../docs/16-progress/HANDOFF_NEXT_STEPS.md) — خطة MRs للمرحلة 03

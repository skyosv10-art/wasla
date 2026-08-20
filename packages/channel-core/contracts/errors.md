# Error Contract — Channel Layer (Phase 03)

> **Scope:** كتالوج أكواد الأخطاء الثابتة لطبقة القنوات (Channel Layer) — القناة الأولى: Telegram.
>
> **القاعدة:** أكواد الأخطاء ثابتة (stable) ولا تتغير دلالتها بعد الإصدار. الأكواد الجديدة تُضاف فقط. أي تغيير في الدلالة يتطلب إصداراً جديداً + ADR.
>
> **قاعدة محايدة القناة:** لا يظهر كود خطأ خاص بـTelegram. أخطاء القناة تُخطَّط (Error Mapping) داخل المُهيّئ إلى الأكواد أدناه — الـCore لا يرى نص خطأ Telegram أبداً.
>
> **Related:** [api.openapi.yml](api.openapi.yml) · [ADR-007](../../../docs/15-decisions/ADR-007-telegram-channel-adapter-isolation-and-stack.md)

---

## أصناف الأخطاء

| الصنف (Class) | HTTP | الوصف |
|---|---|---|
| `validation_error` | 400 | مدخلات غير صالحة شكلياً |
| `unauthorized` | 401 | فشل التحقّق من secret token للـwebhook |
| `not_found` | 404 | بوت أو مورد غير معروف |
| `unprocessable` | 422 | مدخلات صالحة شكلياً وغير مقبولة منطقياً |
| `rate_limited` | 429 | تجاوز حدود القناة — قابل لإعادة المحاولة |
| `service_unavailable` | 503 | القناة أو تابع لها في وضع متدهور |

---

## كتالوج الأكواد

| Code | Class | Retryable | الوصف | متى يُرجَع |
|---|---|---|---|---|
| `CHANNEL_INVALID_UPDATE` | `validation_error` | ❌ | جسم التحديث غير صالح شكلياً | webhook بجسم ليس كائن JSON أو بلا معرّف تحديث |
| `CHANNEL_INVALID_MESSAGE` | `validation_error` | ❌ | رسالة صادرة غير صالحة | `chat_ref`/`text`/`idempotency_key` مفقود أو خارج الحدود |
| `CHANNEL_INVALID_DEEP_LINK` | `validation_error` | ❌ | طلب Deep Link غير صالح | `action` خارج قيم العقد أو `params` غير نصية |
| `CHANNEL_UNAUTHORIZED_WEBHOOK` | `unauthorized` | ❌ | secret token غير مطابق | ترويسة `X-Telegram-Bot-Api-Secret-Token` مفقودة/مختلفة |
| `CHANNEL_UNKNOWN_BOT` | `not_found` | ❌ | البوت غير مُسجّل في سجل البوتات | مسار `/channel/{bot}/…` ببوت خارج customer/driver/partner أو غير مُهيّأ |
| `CHANNEL_MINI_APP_NOT_CONFIGURED` | `not_found` | ❌ | لا Mini App مُهيّأة لهذا البوت | غياب عنوان Mini App في الإعداد |
| `CHANNEL_UNSUPPORTED_UPDATE` | `unprocessable` | ❌ | نوع تحديث غير مدعوم في المرحلة | نوع خارج قائمة `InboundUpdateKind` المدعومة |
| `CHANNEL_UNSUPPORTED_COMMAND` | `unprocessable` | ❌ | أمر غير مُسجّل لهذا البوت | `/start` مدعوم؛ أمر غير معروف يُرفض بهذا الكود |
| `CHANNEL_DEEP_LINK_TOO_LONG` | `unprocessable` | ❌ | الحمولة المُرمّزة تتجاوز حدّ القناة | `payload` بعد base64url > 64 حرفاً |
| `CHANNEL_CHAT_UNREACHABLE` | `unprocessable` | ❌ | المحادثة غير قابلة للوصول | حجب البوت أو محادثة غير مُبدوءة (خطأ نهائي — لا إعادة محاولة) |
| `CHANNEL_RATE_LIMITED` | `rate_limited` | ✅ | تجاوز حدود المعدّل | استجابة 429 من القناة أو ميزانية المعدّل المحلية |
| `CHANNEL_IDENTITY_BOOTSTRAP_FAILED` | `service_unavailable` | ✅ | تعذّر إنشاء/جلب الهوية عبر `IdentityPort` | خدمة Identity غير متاحة أثناء `/start` |
| `CHANNEL_TRANSPORT_ERROR` | `service_unavailable` | ✅ | فشل شبكي/5xx من القناة | timeout أو 5xx من واجهة القناة |
| `CHANNEL_INTERNAL_ERROR` | `service_unavailable` | ❌ | خطأ داخلي غير مُصنّف | استثناء غير متوقع (degraded) |

---

## خطة إعادة المحاولة (Retry Policy)

| البند | القيمة (Phase 03) |
|---|---|
| الأكواد القابلة لإعادة المحاولة | `CHANNEL_RATE_LIMITED` · `CHANNEL_TRANSPORT_ERROR` · `CHANNEL_IDENTITY_BOOTSTRAP_FAILED` |
| أقصى عدد محاولات | 5 (`channel_deliveries.max_attempts`) |
| التباطؤ | أسّي: 1s · 2s · 4s · 8s · 16s (+ jitter) — يُحترم `retry_after` من القناة إن وُجد |
| بعد استنفاد المحاولات | `status='failed'` + حدث `channel.message.failed.v1` مع `error_code` و`retryable` |
| الأخطاء غير القابلة لإعادة المحاولة | تُفشل فوراً (محاولة واحدة) وتُصدر نفس الحدث بـ`retryable: false` |

**قاعدة:** إعادة المحاولة **لا تُنشئ رسالة جديدة** — نفس `idempotency_key` ونفس `delivery_id`.

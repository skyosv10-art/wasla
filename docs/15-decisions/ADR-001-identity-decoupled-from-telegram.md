# ADR-001 — فصل الهوية عن Telegram (Identity Decoupled from Telegram)

> **Title:** Wasla User ID هو الهوية الأساسية، وTelegram IDs روابط Identity
>
> **Status:** Accepted
>
> **Date:** 2026-08-19
>
> **Decision Owners:** Team 01 — Identity & Auth · Team 12 — Integration · Team 09 — Data
>
> **Related:** [VISION.md](../01-product/VISION.md) (المبدأ 2, 3) · [SYSTEM_CONTEXT.md](../02-architecture/SYSTEM_CONTEXT.md) (القسم 5)

---

## Context

تبدأ WASLA من قناة Telegram كنقطة دخول للمستخدمين (Customer Bot, Driver Bot, Partner Bot). يوفر Telegram Bot API الحصول على `User` و`contact` و`location` ضمن الحالات التي يوافق فيها المستخدم.

المخاطر إن ربطنا الهوية مباشرة بـTelegram:

1. **تغيير Username:** المستخدم قد يغيّر Telegram Username أو يفقده، فيُكسر ربط حسابه بالكامل أو يُنشأ حساب مكرر.
2. **فقدان الوصول:** فقدان حساب Telegram يعني فقدان كل البيانات والسمعة والتاريخ.
3. **تبعية القناة:** لا يمكن لاحقًا إضافة قنوات بديلة (Web، Mobile، WhatsApp) دون إعادة بناء الهوية.
4. **خصوصية:** كشف Telegram IDs في الخدمات التجارية يُعرّض بيانات المستخدم.

الرؤية بعيدة المدى: WASLA قابلة للاستخدام في كل دولة يتوفر فيها Telegram، مع إمكانية إضافة قنوات بديلة لاحقًا دون إعادة بناء الـCore.

---

## Decision

**Wasla User ID هو الهوية الداخلية الأساسية** للنظام. Telegram IDs وأرقام الهواتف والهويات الخارجية هي **روابط Identity (Identity Links)** وليست مفتاح النظام النهائي.

لكل مستخدم:

```text
internal_uuid          UUID            # داخلي، لا يظهر للمستخدم
wasla_public_id        WS-XXXXXXXXXX  # رقم الهوية المرئي والدائم
telegram_user_id       nullable external identifier
telegram_username      history-aware
phone_number           encrypted / normalized where available
```

- **`internal_uuid`** لا يظهر للمستخدم أبدًا.
- **`wasla_public_id`** هو رقم الهوية المرئي والدائم (مثال: `WS-0000010427`).
- **Telegram IDs** روابط قابلة للتعويض، تُخزَّن في `IdentityLink` مع History.

### قواعد إضافية

1. **تغيير Username لا ينشئ User جديدًا** — يُسجَّل في Identity History (`old_username`, `new_username`, `effective_at`, `source`).
2. **استرجاع الحساب (Recovery):** إذا فقد المستخدم Telegram، يمكنه بدء Recovery باستخدام Wasla Public ID + وسيلة تحقق مناسبة، دون تجاوز الهوية. Recovery يمر بخطوات تحقق وفق مستوى الحساب والمخاطر.
3. **الحصول على البيانات الخارجية والتحقق منها** يتم داخل **Adapter/Identity boundary** وليس داخل الخدمات التجارية.
4. لا يوجد اعتماد مباشر بين خدمة وخدمة عبر قاعدة بيانات خدمة أخرى بعد فصل الخدمات — الاتصال عبر Contracts.

---

## Consequences

### إيجابية

- **استقرار الهوية:** تغيير/فقدان Telegram Username لا يكسر الحساب.
- **استقلالية القناة:** يمكن إضافة Web/Mobile/WhatsApp Adapters لاحقًا دون إعادة بناء Core (Channel Independence — Phase 23).
- **Recovery:** المستخدم يستطيع استرجاع حسابه عبر Wasla Public ID.
- **خصوصية:** Telegram IDs لا تتسرب إلى الخدمات التجارية.
- **التوسع الدولي:** Identity/Core contracts عالمية عبر جميع الدول.

### سلبية / تكاليف

- طبقة IdentityLink إضافية يجب بناؤها وصيانتها.
- ضرورة إدارة Identity History والتحقق من الاتساق.
- التعقيد الأولي أعلى من ربط مباشر بـTelegram ID.

### مخاطر مُدارة

- تعقيد Recovery يتطلب خطوات تحقق مناسبة وفق مستوى الحساب والمخاطر.
- يجب ألا يصبح أي جزء من Identity معروفًا لشخص واحد فقط (Primary + Secondary Maintainer).

---

## Alternatives

### بديل 1: استخدام Telegram User ID كمفتاح أساسي مباشر

- **مرفوض:** يكسر الهوية عند تغيير/فقدان Username، ويجعل القناة جزءًا من Core، ويمنع استقلالية القنوات لاحقًا. مخالف للمبدأ الجوهري «Telegram قناة، وليس قلب النظام».

### بديل 2: رقم الهاتف كمفتاح أساسي

- **مرفوض:** ليس كل مستخدم يوفر رقم هاتف فورًا، والرقم قد يتغير، ولا يوفر استقلالية كافية عن القناة. يُستخدم رقم الهاتف كـIdentity Link مشفّر (encrypted/normalized) وليس كمفتاح أساسي.

### بديل 3: UUID عشوائي فقط بدون Public ID

- **مرفوض:** المستخدم يحتاج معرّفًا مرئيًا ودائمًا للدعم/الاسترجاع/الإحالات. Wasla Public ID (`WS-XXXXXXXXXX`) يُلبّي هذه الحاجة مع إبقاء `internal_uuid` داخليًا.

---

## Compliance Notes

- هذا القرار يخدم مبادئ VISION.md (المبدأ 2, 3) ومبدأ Channel Independence.
- التوثيق وفق [ENGINEERING_DOCUMENTATION_LAW.md](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md).
- تنفيذه ضمن **Phase 01 — Identity Foundation**، وExit Gate: «إنشاء مستخدم من Telegram وبقاء هويته مستقرة عبر تغيير Username».

---

## المراجع التقنية الخارجية

- Telegram Bot API: https://core.telegram.org/bots/api
- Telegram Web Apps / Mini Apps: https://core.telegram.org/bots/webapps
- Telegram Web Events: https://core.telegram.org/api/web-events

> تُستخدم للتحقق من قدرات Telegram الحالية، ولا تجعل Telegram جزءًا من Core Domain.

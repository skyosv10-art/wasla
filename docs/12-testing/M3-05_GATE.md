# بوّابةُ M3-05 — دورُ البوتات مقيَّدٌ بالمواصفة

> **العنصر:** `M3-05` · **الحجز:** `CLM-0312` (يخلُف `CLM-0311`) · **المواصفة:** [`BOT_ROLE_SPEC.md`](../01-product/BOT_ROLE_SPEC.md)
>
> **نموذجُ الحالات:** [`STATUS_MODEL.md`](../00-rules/STATUS_MODEL.md)
>
> **Last Updated:** 2026-09-23 · **الحالةُ المُعلَنة:** `READY FOR GATE` — التنفيذُ والتحقّقُ المحلّيُّ مكتملان؛ حكمُ CI يُسجَّلُ في §5 بعدَ قراءتِه فعلاً لا قبلَه.

---

## 0. لماذا يوجد هذا الملف — وما الذي صُحِّح

دُمج `CLM-0311` (PR [#404](https://github.com/skyosv10-art/wasla/pull/404)) بـ73 اختبارًا، وفتح PR [#405](https://github.com/skyosv10-art/wasla/pull/405) لنقل `M3-05` إلى `Completed`.
إعادةُ قراءةِ `main` كشفت أنّ بندَ القبول الرابع («لا يوجد أمر جديد أُضيف خارج هذه المواصفة») **غيرُ منفَّذ**:

| الملاحظة | الدليل |
|---|---|
| القوائمُ منسوخةٌ محليًّا | `bot-role-journey.test.ts` و`bot-role-abuse.test.ts` عرّفا `CUSTOMER_COMMANDS`/`DRIVER_COMMANDS` بأيديهما |
| «matches BOT_ROLE_SPEC» يقارن الثابت بنفسه | `expect([...CUSTOMER_COMMANDS]).toEqual([...نفس القيم])` — لا يلمس `CUSTOMER_SUPPORTED_COMMANDS` في البوت |
| الأداةُ تتجاوز جذرَ التركيب | `harnessFor` يبني `createBotApp` مباشرة، فلا يمرّ بـ`buildBotApp`/`buildBotRuntime` الذي تُقلع به البوتات |
| لا ملفَّ بوّابة | لا `M3-05_GATE.md` (شرط `GATED` في STATUS_MODEL §1) |

**الطفرةُ التي تُثبت الفجوة (مقيسةً على شجرةٍ منفصلةٍ من `main` @ `a33a7ad`):** إضافةُ `"help"` إلى `CUSTOMER_SUPPORTED_COMMANDS` تُبقي bot-runtime 178/178 وcustomer-bot 36/36 خضراءَ — **لا يسقط أيُّ اختبار** — البوت يُجيب `/help` والمواصفةُ تمنعه.

لذلك لم يُدمَج #405، وبقي `M3-05` في `In Progress`، وحُرِّر `CLM-0311` بسجلٍّ تدقيقيٍّ صريح في [`WORK_CLAIMS.md`](../16-progress/WORK_CLAIMS.md) دون محو دليله.

---

## 1. الحالةُ بثلاثِ طبقات

```
LOCAL      ✅ VERIFIED       — §3 (أرقامٌ من تشغيلٍ واحدٍ) + §4 (طفراتٌ تعضّ)
CI         ⏳ PENDING        — يُملأ في §5 من حكمِ GitHub Actions المقروء
PRODUCTION ⚪ NOT VERIFIED   — لا بوتَ منشورٌ على Telegram في هذا النطاق؛ الإقلاعُ fail-closed مُثبَتٌ في الاختبار فقط
```

---

## 2. ما بُني (`CLM-0312`)

| الطبقة | الملف | السلوك |
|---|---|---|
| مصدرٌ واحدٌ في الشفرة | [`packages/contracts/channel/src/index.ts`](../../packages/contracts/channel/src/index.ts) | `BOT_ALLOWED_COMMANDS` لكل بوت |
| الوثيقة ⇔ الشفرة | [`bot-role-spec.test.ts`](../../packages/contracts/channel/src/__tests__/bot-role-spec.test.ts) | يقرأ جداول §2 من المواصفة ويطلب تطابقَ المجموعتين في الاتجاهين |
| إقلاعٌ fail-closed | [`packages/bot-runtime/src/runtime.ts`](../../packages/bot-runtime/src/runtime.ts) | `assertCommandsWithinRole` في `buildBotRuntime` يرمي `BOT_COMMAND_OUTSIDE_ROLE_SPEC` |
| حارسُ الإقلاع | [`bot-role-runtime.test.ts`](../../packages/bot-runtime/src/__tests__/bot-role-runtime.test.ts) | 3 بوتات × (مسموح يُقلع · افتراضيٌّ يُقلع · 6 أوامر محظورة ترفض الإقلاع) + تهريبُ أمرِ بوتٍ إلى آخر |
| البوتات المنشورة | `bots/{customer,driver,partner}-bot/src/__tests__/bot-role.test.ts` | عبر `buildApp` الحقيقي: القائمةُ المشحونة = المسموح · كلُّ مسموحٍ → 202 · كلُّ محظورٍ → 422 `CHANNEL_UNSUPPORTED_COMMAND` · override خارجيٌّ يرفض الإقلاع |
| إزالةُ التكرار | `bot-role-journey.test.ts` · `bot-role-abuse.test.ts` | القوائمُ تُقرأ من `BOT_ALLOWED_COMMANDS`؛ حُذف اختباران كانا يقارنان الثابت بنفسه |

---

## 3. القياسُ المحلّي (2026-09-23)

| الحزمة | قبل | بعد |
|---|---|---|
| `@wasla/contracts-channel` | 34 | **43** (+9) |
| `@wasla/bot-runtime` | 178 | **202** (+26 −2 تكراريّان) |
| `@wasla/customer-bot` | 36 | **51** (+15) |
| `@wasla/driver-bot` | 43 | **60** (+17) |
| `@wasla/partner-bot` | 6 | **16** (+10) |

`pnpm -r typecheck` → exit 0. والتشغيلُ الكاملُ `pnpm test` مُسجَّلٌ في [`TASK_LOG.md`](../16-progress/TASK_LOG.md).

---

## 4. الطفرات — كلُّ بابٍ يعضّ

| # | الطفرة | النتيجة |
|---|---|---|
| M1 | `"help"` يُضاف إلى `CUSTOMER_SUPPORTED_COMMANDS` | **24 فاشلًا** في customer-bot — البوت لا يُقلع: `BOT_COMMAND_OUTSIDE_ROLE_SPEC: customer bot registers /help` |
| M2a | حذفُ استدعاء `assertCommandsWithinRole` من `buildBotRuntime` | **18 فاشلًا** في `bot-role-runtime.test.ts` |
| M2b | الطفرةُ نفسها، مقيسةً من جذر partner-bot | **1 فاشل** — «refuses to boot when an override registers a command outside the spec» |
| M3 | صفُّ `/help` يُضاف إلى جدول §2.1 في المواصفة دون الشفرة | **1 فاشل** — `customer: the spec table lists exactly the allowed commands` |
| M4 | `BOT_ALLOWED_COMMANDS.partner` يصير `["start","orders"]` دون المواصفة | **1 فاشل** — `partner: the spec table lists exactly the allowed commands` |

كلُّ طفرةٍ أُعيدت بعدها الشجرةُ وأُعيد التشغيلُ أخضرَ (§3).

**سجلٌّ تدقيقيّ:** أوّلُ تشغيلٍ لـM4 جرى والشجرةُ ما زالت تحمل طفرةَ M3 (خطأُ استعادةٍ في سكربت الطفرات)، فأظهر فاشلَين بدل واحد. أُعيدت الملفّاتُ يدويًّا وأُعيد M4 نظيفًا، والرقمُ أعلاه من التشغيل النظيف.

---

## 5. بنودُ البوّابة

| # | البند | الحالة | الدليل |
|---|---|---|---|
| 1 | مواصفةُ الأوامر منشورة | ✅ | [`BOT_ROLE_SPEC.md`](../01-product/BOT_ROLE_SPEC.md) §2 |
| 2 | رحلةٌ لكلّ بوت تغطي كلَّ أمرٍ مسموح عبر جذر التركيب الحقيقي | ✅ | `bots/*/src/__tests__/bot-role.test.ts` |
| 3 | إساءة: غيرُ مدعوم · حقن · مجموعةٌ غيرُ مُعلَنة · أوامرُ إدارة | ✅ | `bot-role-abuse.test.ts` (PR #404) + المحظوراتُ في `bot-role.test.ts` |
| 4 | لا أمرَ خارج المواصفة — منفَّذٌ آليًّا | ✅ | §2 + طفرات M1–M4 |
| 5 | حكمُ CI أخضرُ على الفرع | ⏳ | يُملأ بعد قراءة الحكم |
| 6 | حكمُ CI أخضرُ على `main` بعد الدمج | ⏳ | يُملأ بعد الدمج |

---

## 6. حدودٌ مُعلَنة (لا تُقرأ خُضرة)

- **Rate limiting:** غيرُ موجود، كما تنصّ المواصفة §7؛ منعُ التكرار وحده (`ProcessedUpdateStore`). خارج نطاق M3-05.
- **الإقلاعُ في الإنتاج:** مُثبَتٌ باختبار، لا بنشرٍ حقيقيّ على Telegram.
- **قائمةُ الأوامر لدى BotFather (`setMyCommands`):** لا تُدار من المستودع؛ الحارسُ يمنع **الإجابة** على أمرٍ خارج المواصفة، لا ظهورَه في قائمة Telegram إن أُضيف يدويًّا.

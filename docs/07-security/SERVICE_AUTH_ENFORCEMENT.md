# SERVICE_AUTH_ENFORCEMENT — خريطةُ إنفاذِ هويّةِ الخدمةِ وسجلُّ التغطية (ملزم)

> **الحالة:** ساريةٌ · **العنصر:** `M1-03` · **آخر تحديث:** 2026-08-31 · **المالك:** @uxxxu
>
> **المرجع:** [`ADR-020`](../02-adr/ADR-020-service-to-service-authentication.md) · [`ADR-021`](../02-adr/ADR-021-service-token-replay-policy.md) · [`ADR-022`](../02-adr/ADR-022-service-auth-key-rotation.md) · [`M1-03_GATE.md`](../12-testing/M1-03_GATE.md) · محروسٌ بالفحصِ **12** في [`verify-governance.sh`](../../scripts/checks/verify-governance.sh)

---

## 0. القاعدة في سطر

**أن تعملَ حزمةُ `service-auth` شيءٌ، وأن يفرضَ النظامُ هويّةَ الخدمةِ شيءٌ آخر.**
هذه الوثيقةُ تقول بالتحديدِ **أيُّ حدٍّ يفرضُ اليومَ**، و**أيُّ نداءٍ صادرٍ يوقِّعُ
اليومَ**، و**ما لم يُفرَض بعدُ** — بلا تجميلٍ ولا تعميمٍ من الجزءِ إلى الكلّ.

---

## 1. لماذا هذه الوثيقة (العيبُ الذي أنشأها)

كانت الدفعةُ الأولى من `M1-03` تُبرهنُ أنّ **الحزمةَ** صحيحةٌ: توليدُ الرمزِ،
والتحقّقُ منه، ورفضُ التوقيعِ الفاسدِ، وانتهاءُ الصلاحيّةِ، ومطابقةُ الجمهور. وكلُّ
ذلك صحيحٌ ولا يُنقَض. لكنَّه **لا يجيبُ السؤالَ الذي تُسأل عنه المنظومة**:

> إذا وصلَ إلى خدمةِ المطابقةِ طلبٌ **بلا** ترويسةِ هويّةٍ، فماذا يحدث؟

وكان الجوابُ قبلَ هذه الدفعةِ: **يمرُّ الطلب**. فالحزمةُ كانت مكتبةً لا يستدعيها
حدٌّ. والاستنتاجُ من `service-auth works` إلى `the system enforces service identity`
قفزةٌ غيرُ مشروعةٍ، وهي بالضبطِ نوعُ التجميلِ الذي يُسقِطُ الثقةَ بكلِّ ما بُنيَ.

فهذه الوثيقةُ تفصلُ الشيئَين فصلاً دائماً: **صحّةُ الحزمة** لها اختباراتُها في
`packages/service-auth`، و**انتشارُ الإنفاذِ** له هذا السجلُّ وحارسُه.

---

## 2. الحدُّ المُثبَتُ في هذه الدفعة

**حدٌّ واحدٌ، مفروضٌ ببرهانٍ عبرَ مقبسٍ حقيقيّ: خدمةُ المطابقة.**

الترتيبُ في `services/matching/src/http/app.ts`:

1. `registerServiceIdentity(app, …)` **قبلَ** تسجيلِ أيِّ مسار.
2. حارسٌ عندَ الإقلاعِ (`onRoute`): كلُّ مسارٍ يُسجَّلُ بلا `config.serviceIdentity`
   **يُسقِطُ الخدمةَ عندَ بدئها**، لا عندَ أوّلِ طلبٍ في الإنتاج. فلا يمكن أن
   يُضافَ مسارٌ جديدٌ فينسى كاتبُه تصنيفَه ويمرَّ صامتاً.
3. إنفاذٌ عندَ الطلبِ (`onRequest`): الافتراضُ **منعٌ لا سماح** — المسارُ غيرُ
   المصنَّفِ وغيرُ المعروفِ يُرفَضُ بـ401 **قبلَ** 404، لأنّ 404 على مسارٍ محميٍّ
   تُخبِرُ مهاجماً بما لا يحتاجُ أن يعرفَه.
4. `/health` وحدَه مفتوحٌ بتصنيفٍ صريحٍ (`OPEN`): الإنفاذُ لا يُعمي المراقبة.

### 2.1 مصفوفةُ القرار

| الحالة | الجواب | الرمز | لماذا |
|---|---|---|---|
| بلا ترويسةِ هويّة | `401` | `AUTHN_UNAUTHENTICATED` | لا هويّةَ تُفحَص |
| ترويسةٌ بسرٍّ آخرَ (تزوير) | `401` | `AUTHN_UNAUTHENTICATED` | التوقيعُ يُفحَص، لا وجودُ الترويسة |
| رمزٌ منتهي الصلاحيّة | `401` | `AUTHN_UNAUTHENTICATED` | العمرُ محدودٌ بالنيّة |
| جمهورٌ غيرُ الخدمة | `401` | `AUTHN_UNAUTHENTICATED` | رمزُ خدمةٍ لا يُقبَلُ في غيرِها |
| رمزٌ لمسارٍ أو طريقةٍ أخرى | `401` | `AUTHN_UNAUTHENTICATED` | الرمزُ مربوطٌ بالطلب |
| رمزٌ مُستعمَلٌ ثانيةً | `401` | `AUTHN_UNAUTHENTICATED` | `jti` يُحرَق (ADR-021) |
| مفتاحٌ مسحوبٌ (`revoked`) | `401` | `AUTHN_UNAUTHENTICATED` | السحبُ فوريٌّ (ADR-022) |
| هويّةٌ صحيحةٌ، صلاحيّةٌ ناقصة | `403` | `AUTHZ_FORBIDDEN` | التوثيقُ ليس التخويل |
| هويّةٌ صحيحةٌ وصلاحيّةٌ كافية | يمرُّ | — | إلى منطقِ العمل |
| متجرُ الإعادةِ غيرُ متاح | `503` | خدمةٌ غيرُ متاحة | فشلٌ مُغلَقٌ لا مفتوح (ADR-021 §5) |

وغلافُ الخطأِ ثلاثةُ حقولٍ فقط — `code` و`message` و`trace_id` — فلا يُسرِّبُ
سبباً يُعينُ مهاجماً على التمييزِ بين «لا مفتاح» و«توقيعٌ خاطئ». والسببُ الدقيقُ
يُكتَبُ في السجلِّ التقنيِّ (`logReason`) لا في الجواب.

### 2.2 البرهان

`packages/dispatch-e2e/src/__tests__/service-identity-enforcement.e2e.test.ts` —
ثمانيةُ اختباراتٍ **عبرَ TCP** إلى الخدمةِ نفسِها التي تُشغّلُها بوّابةُ المرحلةِ
السابعةِ، بلا `app.inject`: بلا هويّةٍ · مزوَّرةٌ · صحيحةٌ · صلاحيّةٌ خاطئةٌ ·
إعادةُ الرمزِ نفسِه · ربطُ المسار · مسارٌ غيرُ مصنَّفٍ · `/health` مفتوح.

وفي طبقةِ الخدمةِ: `services/matching/src/__tests__/http-service-identity.test.ts`
(اثنا عشرَ اختباراً) للحالاتِ التي لا يبلغُها مقبسٌ بسهولةٍ كتعذُّرِ متجرِ الإعادة.

---

## 3. ما لم يُفرَض بعدُ (إعلانٌ لا اعتذار)

**بقيّةُ حدودِ النظامِ لا تفرضُ هويّةَ خدمةٍ اليوم.** هذا قرارٌ مُعلَنٌ لا سهوٌ:
سحبُ التغطيةِ الكاملةِ إلى هذه الدفعةِ كان يُوسِّعُ نطاقَها إلى ما لا يُراجَع، فآلَ
الأمرُ إلى **تقدُّمٍ تدريجيٍّ قابلٍ للإثبات**: حدٌّ واحدٌ مبرهَنٌ الآنَ، وحارسٌ
يمنعُ الانحدارَ، وبوّابةٌ مستقلّةٌ (`M1-04`) للتغطيةِ الكاملة.

ويُقال صريحاً أيضاً: **التوقيعُ الحاليُّ سرٌّ مشترَكٌ (HMAC)** لا هويّةُ حِملٍ
مُصدَّقةٌ بـmTLS. حدُّ الثقةِ هذا موصوفٌ في `ADR-020` §6 (**الآن:** HMAC ·
**لاحقاً:** mTLS + workload identity)، ومَن يملكُ السرَّ يملكُ الهويّة.

---

## 4. سجلُّ التغطية (يقرأه الحارس)

الحارسُ `scripts/checks/validate-service-auth-coverage.sh` يقرأُ ما بين العلامتَين
أدناه. كلُّ ملفِّ عميلٍ صادرٍ على القرصِ (`services/*/src/infrastructure/http-*.ts`)
**يجبُ أن يكونَ له صفٌّ**، وإلّا سقطَ الفحص. وكلُّ صفٍّ يقولُ «موقَّع» يُثبِتُه
الحارسُ في الشفرةِ نفسِها، فلا سجلَّ يدَّعي ما ليس فيه.

<!-- coverage-ledger:start -->

**الحدودُ المفروضة:** `enforced: matching`

| العميلُ الصادر | إلى | الحالة | البرهان أو المرجع |
|---|---|---|---|
| `services/dispatch/src/infrastructure/http-matching.ts` | matching | موقَّع | `service-identity-enforcement.e2e.test.ts` · `DISPATCH_MATCHING_SCOPES` |
| `services/drivers/src/infrastructure/http-candidacy.ts` | matching | موقَّع | `services/drivers/src/__tests__/outbound-ports.test.ts` · `DRIVERS_MATCHING_SCOPES` |
| `services/customers/src/infrastructure/http-geography.ts` | geography | مؤجَّل | حدُّ geography غيرُ مفروضٍ — بوّابةُ M1-04 |
| `services/customers/src/infrastructure/http-identity-lookup.ts` | identity | مؤجَّل | حدُّ identity غيرُ مفروضٍ — بوّابةُ M1-04 |
| `services/customers/src/infrastructure/http-order-intake.ts` | orders | مؤجَّل | حدُّ orders غيرُ مفروضٍ — بوّابةُ M1-04 |
| `services/dispatch/src/infrastructure/http-order-engine.ts` | orders | مؤجَّل | حدُّ orders غيرُ مفروضٍ — بوّابةُ M1-04 |
| `services/drivers/src/infrastructure/http-zone-catalog.ts` | geography | مؤجَّل | حدُّ geography غيرُ مفروضٍ — بوّابةُ M1-04 |
| `services/geography/src/infrastructure/http-identity-lookup.ts` | identity | مؤجَّل | حدُّ identity غيرُ مفروضٍ — بوّابةُ M1-04 |
| `services/matching/src/infrastructure/http-geography.ts` | geography | مؤجَّل | حدُّ geography غيرُ مفروضٍ — بوّابةُ M1-04 |
| `services/negotiations/src/infrastructure/http-agreed-price.ts` | orders | مؤجَّل | حدُّ orders غيرُ مفروضٍ — بوّابةُ M1-04 |
| `services/negotiations/src/infrastructure/http-dispatch-offer.ts` | dispatch | مؤجَّل | حدُّ dispatch غيرُ مفروضٍ — بوّابةُ M1-04 |

<!-- coverage-ledger:end -->

**قراءةُ العدد:** عميلانِ موقِّعانِ من أحدَ عشرَ. وهذا هو الرقمُ الصحيحُ الذي
يُقال، لا «هويّةُ الخدمةِ مُنجَزةٌ».

---

## 5. صلاحيّاتُ حدِّ المطابقة

النحوُ ثلاثيٌّ (`domain:resource:action`) كما في `auth-sdk`، والصلاحيّةُ تُطلَبُ
بمقدارِ المسارِ لا بمقدارِ الخدمة:

| المسار | الصلاحيّةُ المطلوبة |
|---|---|
| `POST /matching/candidates` | `matching:candidates:evaluate` |
| `PUT /candidacy/{driver}` | `matching:candidacy:write` |
| `GET /candidacy/{driver}` | `matching:candidacy:read` |
| `POST /candidacy/{driver}/availability` | `matching:candidacy:write` |
| `GET /matching/rulesets` | `matching:rulesets:read` |
| `GET /matching/decisions/{id}` | `matching:decisions:read` |
| `GET /health` | مفتوحٌ بتصنيفٍ صريح |

وهذه صلاحيّاتُ **خدمةٍ** لا صلاحيّاتُ مستخدم. نموذجُ التخويلِ الكاملُ (خدمةٌ ·
عمليّةٌ · موردٌ · نطاقٌ · أثرٌ) عنصرٌ مستقلٌّ هو `M1-05`، ولا يُدَّعى أنّ
`role = admin` يكفيه.

---

## 6. حدودُ هذا الحارس

يُقال بلا تلطيفٍ ما **لا** يفعلُه `validate-service-auth-coverage.sh`:

- **لا يُثبِتُ أنّ الإنفاذَ صحيحٌ**، بل أنّ السجلَّ صادقٌ وأنّ الحدَّ المُعلَنَ فيه
  استدعاءُ الإنفاذ. صحّةُ الإنفاذِ برهانُها الاختباراتُ في §2.2.
- **لا يقرأُ إلّا `services/*/src/infrastructure/http-*.ts`**. لو بُنيَ نداءٌ صادرٌ
  في موضعٍ آخرَ لما رآه — ولذلك يُسقِطُ الفحصَ نفسَه إن لم يجدْ عميلاً واحداً، كي
  لا يبقى حارساً يفحصُ موضعاً هُجِر.
- **لا يسألُ الإنتاجَ عن شيء**. لا يعرفُ أيُّ متغيّرِ بيئةٍ مُعَدٌّ في أيِّ نشرٍ،
  ولا يُدَّعى أنّ ما يمرُّ محلّيّاً منشورٌ.

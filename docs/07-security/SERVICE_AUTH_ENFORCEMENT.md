# SERVICE_AUTH_ENFORCEMENT — خريطةُ إنفاذِ هويّةِ الخدمةِ وسجلُّ التغطية (ملزم)

> **الحالة:** ساريةٌ · **العنصر:** `M1-03` ثمّ `M1-04` · **آخر تحديث:** 2026-09-05 · **المالك:** @uxxxu
>
> **المرجع:** [`ADR-020`](../15-decisions/ADR-020-service-to-service-authentication.md) · [`ADR-021`](../15-decisions/ADR-021-service-token-replay-policy.md) · [`ADR-022`](../15-decisions/ADR-022-service-auth-key-rotation.md) · [`M1-03_GATE.md`](../12-testing/M1-03_GATE.md) · محروسٌ بالفحصِ **12** في [`verify-governance.sh`](../../scripts/checks/verify-governance.sh)

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

## 2. الحدودُ المُثبَتة

**أربعةُ حدودٍ اليوم: خدمةُ المطابقة (`M1-03`) · حدُّ الطلبات (`M1-04` · الموجةُ
الثانية) · حدُّ الهويّة (`M1-04` · الموجةُ الثالثة) · حدُّ التوزيع (`M1-04` ·
الموجةُ الرابعة).**

الترتيبُ في الحدودِ واحدٌ لأنّ الوسيطَ واحدٌ: منذُ الموجةِ الأولى من `M1-04` صارَ
الربطُ بـFastify كلُّه في
[`packages/service-auth/src/fastify.ts`](../../packages/service-auth/src/fastify.ts)،
ولا يبقى في الخدمةِ إلّا ثلاثةٌ تخصُّها: **جمهورُها** و**صلاحيّاتُها**
و**مغلَّفُ خطئِها** — و`audience` و`denialBody` إلزاميّانِ عندَ الوسيطِ بلا قيمةٍ
افتراضيّةٍ، فلا يخترعُ لخدمةٍ جمهورَ أخرى.

### 2.0 لماذا الطلباتُ قبلَ الجغرافيا

حدُّ الجغرافيا له ثلاثةُ عملاءَ أحدُهم في `services/drivers/`، وهي **محجوزةٌ لمالكٍ
بشريٍّ** (`CLM-0004`). **وفرضُ حدٍّ قبلَ توقيعِ كلِّ عملائِه يعني `401` في الإنتاج**،
فلا يُفرَضُ حدٌّ ما لم يُوقَّعْ كلُّ منادٍ له في الدفعةِ نفسِها. وعملاءُ الطلباتِ
الأربعةُ كلُّهم خارجَ الحجزِ، فكانَ هذا الحدَّ **الممكنَ لا الأسهل**.

### 2.1 الترتيبُ (واحدٌ في الحدَّين)

1. `registerServiceIdentity(app, …)` **قبلَ** تسجيلِ أيِّ مسار.
2. حارسٌ عندَ الإقلاعِ (`onRoute`): كلُّ مسارٍ يُسجَّلُ بلا `config.serviceIdentity`
   **يُسقِطُ الخدمةَ عندَ بدئها**، لا عندَ أوّلِ طلبٍ في الإنتاج. فلا يمكن أن
   يُضافَ مسارٌ جديدٌ فينسى كاتبُه تصنيفَه ويمرَّ صامتاً.
3. إنفاذٌ عندَ الطلبِ (`onRequest`): الافتراضُ **منعٌ لا سماح** — المسارُ غيرُ
   المصنَّفِ وغيرُ المعروفِ يُرفَضُ بـ401 **قبلَ** 404، لأنّ 404 على مسارٍ محميٍّ
   تُخبِرُ مهاجماً بما لا يحتاجُ أن يعرفَه.
4. `/health` وحدَه مفتوحٌ بتصنيفٍ صريحٍ (`OPEN`): الإنفاذُ لا يُعمي المراقبة.

### 2.2 مصفوفةُ القرار

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

### 2.3 برهانُ حدِّ المطابقة

`packages/dispatch-e2e/src/__tests__/service-identity-enforcement.e2e.test.ts` —
ثمانيةُ اختباراتٍ **عبرَ TCP** إلى الخدمةِ نفسِها التي تُشغّلُها بوّابةُ المرحلةِ
السابعةِ، بلا `app.inject`: بلا هويّةٍ · مزوَّرةٌ · صحيحةٌ · صلاحيّةٌ خاطئةٌ ·
إعادةُ الرمزِ نفسِه · ربطُ المسار · مسارٌ غيرُ مصنَّفٍ · `/health` مفتوح.

وفي طبقةِ الخدمةِ: `services/matching/src/__tests__/http-service-identity.test.ts`
(اثنا عشرَ اختباراً) للحالاتِ التي لا يبلغُها مقبسٌ بسهولةٍ كتعذُّرِ متجرِ الإعادة.

### 2.4 برهانُ حدِّ الطلبات (`M1-04` · الموجةُ الثانية)

- **الوسيطُ نفسُه:** `packages/service-auth/src/__tests__/fastify.test.ts` — أحدَ
  عشرَ اختباراً على السلوكِ المشترَك (تصنيفٌ عندَ الإقلاع · مُغلَقٌ افتراضاً ·
  `503` عندَ تعذُّرِ متجرِ الإعادة · السببُ يُسجَّلُ ولا يُعاد · قطعُ الاستعلام).
- **الحدُّ نفسُه:** `services/orders/src/__tests__/http/service-identity.test.ts` —
  أحدَ عشرَ اختباراً على جمهورِ الطلباتِ وصلاحيّاتِ مساراتِه ومغلَّفِ خطئِه.
- **العملاءُ الأربعة:** لكلِّ عميلٍ اختبارٌ يقرأُ الترويسةَ على السلكِ نفسِه:
  `services/customers/src/__tests__/http-order-intake.test.ts` ·
  `services/dispatch/src/__tests__/http-order-engine.test.ts` ·
  `services/negotiations/src/__tests__/outbound-ports.test.ts` (منفذانِ:
  السعرُ المتفَقُ والقراءةُ الخدميّة).
- **السلسلةُ كاملةً عبرَ مقابسَ حقيقيّة:** بوّاباتُ الخروجِ الخمسُ التي تُشغّلُ
  محرّكَ الطلباتِ (`order-e2e` · `dispatch-e2e` · `driver-e2e` ·
  `negotiation-e2e` · `reputation-e2e`) تبني الحدَّ **مفروضاً** وتُوقّعُ نداءاتِها،
  فما تُبرهنُه هو السلسلةُ تعملُ موقَّعةً — لا حدٌّ خُفِّفَ لراحةِ الاختبار.

**ما لا يُدَّعى هنا:** توقيعُ عملاءِ الطلباتِ لا يجعلُ `M1-04` منجَزاً. حدودُ
`geography` و`identity` و`dispatch` لم تكن مفروضةً **يومَ كُتِبَ هذا القسمُ**
(وقد فُرِضَ حدّا الهويّةِ والتوزيعِ في الموجتَينِ الثالثةِ والرابعةِ بعدَه)،
والسجلُّ في §4 هو الرقمُ لا هذه الفقرةُ.

### 2.5 برهانُ حدِّ الهويّة (`M1-04` · الموجةُ الثالثة)

- **الحدُّ نفسُه:** `services/identity/src/__tests__/http/service-identity.test.ts`
  — أربعَ عشرةَ حالةً: بلا ترويسةٍ ⇒ `401` · ترويسةٌ مزوَّرةٌ ⇒ `401` ·
  الصلاحيّةُ الصحيحةُ ⇒ `201` · صلاحيّةٌ ناقصةٌ ⇒ `403` · إعادةٌ ⇒ `401` ·
  تعذُّرُ متجرِ الإعادةِ ⇒ `503` · رمزُ قراءةٍ لا يربطُ هويّةً ⇒ `403` · رمزُ
  قراءةٍ لا يبدأُ استعادةً ⇒ `403` · استعادةٌ بلا توقيعٍ ⇒ `401` · رمزٌ لمسارٍ
  آخرَ ⇒ `401` · **رمزٌ لمستخدمٍ آخرَ ⇒ `401`** (المعرِّفُ داخلَ المسارِ هنا،
  فالربطُ كاملٌ — بخلافِ `RISK-0026`) · `/health` مفتوحٌ ⇒ `200` · مسارٌ مجهولٌ
  ⇒ `401` قبلَ `404` · مسارٌ غيرُ مصنَّفٍ يُسقِطُ الخدمةَ عندَ الإقلاع.
- **العملاءُ الثلاثةُ للحدِّ:** عميلا القراءةِ في `services/customers` و
  `services/geography` (`CUSTOMERS_IDENTITY_SCOPES` · `GEOGRAPHY_IDENTITY_SCOPES`
  — `identity:user:read` وحدَها)، و**منفذُ إقلاعِ الهويّةِ في طبقةِ القنواتِ**
  `packages/bot-runtime/src/identity-bootstrap.ts`
  (`CHANNEL_IDENTITY_SCOPES` — `identity:resolve:write` وحدَها؛ الاختبارُ
  `packages/bot-runtime/src/__tests__/identity-bootstrap.test.ts` يقرأُ الترويسةَ
  على السلكِ). ومنه تُبنى بوتاتُ العميلِ والسائقِ والشريكِ الثلاثةُ، وكذلك
  `bots/customer-bot/src/customer-core.ts`.
- **السلسلةُ كاملةً عبرَ مقابسَ حقيقيّة:** بوّاباتُ الخروجِ التي تُشغّلُ خدمةَ
  الهويّةِ (`order-e2e` · `dispatch-e2e` · `driver-e2e` · `negotiation-e2e` ·
  `customer-e2e` · `channel-e2e` · بوّابةُ الطورِ الثاني في `services/geography`)
  تبني الحدَّ **مفروضاً** وتوقّعُ نداءاتِها.
- **الإقلاعُ يرفضُ التناقضَ:** `packages/bot-runtime/src/config.ts` يُسقِطُ أيَّ
  بوتٍ وُصِلَ بـ`IDENTITY_SERVICE_URL` بلا `WASLA_SERVICE_AUTH_KEYS` و
  `WASLA_SERVICE_AUTH_ACTIVE_KID`. والسببُ يُقالُ صريحاً: بوتٌ يُقلِعُ بلا مفاتيحَ
  يُرَدُّ `401` عندَ كلِّ `/start`، فيُخبِرُ المستخدمَ أنّ هويّتَه تعذَّرت وهي
  متاحةٌ — ورسالةٌ تُسمّي المتغيّرَ الناقصَ أرخصُ من ذلك.

**ما لا يُدَّعى هنا:** فرضُ حدِّ الهويّةِ لا يجعلُ `M1-04` منجَزاً. حدُّ
`geography` **لم يُفرَضْ بعدُ** (وحدُّ `dispatch` فُرِضَ في الموجةِ الرابعةِ
بعدَ كتابةِ هذا القسمِ)، والسجلُّ في §4 هو الرقمُ. ولا يُدَّعى أنّ متغيّراتِ
البيئةِ مُعَدّةٌ في أيِّ نشرٍ — لم يُقَسْ ذلك.

### 2.6 برهانُ حدِّ التوزيع (`M1-04` · الموجةُ الرابعة)

- **لماذا التوزيعُ رابعاً لا الجغرافيا:** السببُ نفسُه المذكورُ في §2.0 ولم
  يتغيّر — عميلُ الجغرافيا الثالثُ في `services/drivers/` وهي **محجوزةٌ لمالكٍ
  بشريٍّ** (`CLM-0004`). أمّا مُنادي التوزيعِ فواحدٌ لا غير
  (`services/negotiations/src/infrastructure/http-dispatch-offer.ts`)، وهو خارجَ
  كلِّ حجزٍ — فكانَ هذا الحدَّ **الممكنَ لا الأسهل**.
- **الحدُّ نفسُه:** `services/dispatch/src/__tests__/service-identity.test.ts` —
  خمسَ عشرةَ حالةً: بلا ترويسةٍ ⇒ `401` · ترويسةٌ مزوَّرةٌ ⇒ `401` · الصلاحيّةُ
  الصحيحةُ ⇒ `201` · صلاحيّةٌ ناقصةٌ ⇒ `403` · إعادةٌ ⇒ `401` · تعذُّرُ متجرِ
  الإعادةِ ⇒ `503` · **رمزُ قراءةٍ لا يقبلُ عرضاً نيابةً عن سائقٍ ⇒ `403`** ·
  رمزُ قبولٍ لا يُلغي وظيفةً ⇒ `403` · رمزُ قراءةٍ لا يدفعُ النبضةَ ⇒ `403` ·
  نبضةٌ بلا توقيعٍ ⇒ `401` · رمزٌ لمسارٍ آخرَ ⇒ `401` · **رمزٌ لوظيفةٍ أخرى ⇒
  `401`** (المعرِّفُ داخلَ المسارِ، فالربطُ كاملٌ — بخلافِ `RISK-0026`) ·
  `/health` مفتوحٌ ⇒ `200` · مسارٌ مجهولٌ ⇒ `401` قبلَ `404` · مسارٌ غيرُ
  مصنَّفٍ يُسقِطُ الخدمةَ عندَ الإقلاع.
- **الصلاحيّاتُ سبعٌ لا واحدةٌ**، لأنّ مساراتِ التوزيعِ التسعةَ ليست خطراً
  واحداً: قبولُ عرضٍ نيابةً عن سائقٍ ودفعُ نبضةِ المحرّكِ وإلغاءُ وظيفةٍ ثلاثةُ
  أفعالٍ لا يجوزُ أن يبلغَها رمزٌ طُلِبَ لقراءةِ عرضٍ.

  | الصلاحيّة | المسارُ الذي تفتحُه |
  |---|---|
  | `dispatch:job:write` | `POST /dispatch/jobs` |
  | `dispatch:job:read` | `GET /dispatch/jobs/:id` · `GET /dispatch/jobs/:id/offers` · `GET /dispatch/jobs/:id/waves` |
  | `dispatch:offer:read` | `GET /dispatch/offers/:id` |
  | `dispatch:offer:accept` | `POST /dispatch/offers/:id/accept` |
  | `dispatch:offer:reject` | `POST /dispatch/offers/:id/reject` |
  | `dispatch:job:cancel` | `POST /dispatch/jobs/:id/cancel` |
  | `dispatch:tick:write` | `POST /dispatch/tick` |

- **المُنادي الوحيدُ صارَ يحملُ موقِّعَينِ صريحَينِ:** `http-dispatch-offer.ts`
  ينادي حدَّينِ بجمهورَينِ مختلفَينِ، فحقلُ `signRequest` الواحدُ انقسمَ إلى
  `signOrdersRequest` و`signDispatchRequest` — كما وُعِدَ نصّاً في الموجةِ
  الثانية. والاختبارُ `services/negotiations/src/__tests__/outbound-ports.test.ts`
  **يفكُّ حِمْلَ الرمزَينِ ويقرأُ `aud` و`scp` منهما**، فلا يكفي أن يكونَ هناك
  توقيعٌ: يجبُ أن يكونَ توقيعَ الوجهةِ الصحيحةِ بصلاحيّةِ القراءةِ وحدَها.
- **السلسلةُ كاملةً عبرَ مقابسَ حقيقيّة:** بوّاباتُ الخروجِ الثلاثُ التي تُشغّلُ
  خدمةَ التوزيعِ (`dispatch-e2e` · `driver-e2e` · `negotiation-e2e`) تبني الحدَّ
  **مفروضاً** وتوقّعُ نداءاتِها. وبوّابةُ التفاوضِ خاصّةً تُشغّلُ **التوصيلَ
  الإنتاجيَّ نفسَه** (`configuredDispatchOffers`)، فما تُبرهنُه هو أنّ سلسلةَ
  «تفاوضٌ → توزيعٌ» تعملُ موقَّعةً عبرَ مقبسٍ حقيقيٍّ لا أنّ اختباراً وُقِّعَ له.
- **ما كشفَه التشغيلُ لا القراءةُ:** بوّابةُ السائقِ كانت تنادي مسارَ القبولِ
  بـ`fetch` عارٍ يتجاوزُ مُساعِدَ البوّابةِ، فردَّ الحدُّ `401` وسقطَ اختباران.
  والعلاجُ تمريرُ النداءَينِ عبرَ `callDispatch` الموقِّع — لا تخفيفُ الحدِّ.

**ما لا يُدَّعى هنا:** فرضُ حدِّ التوزيعِ لا يجعلُ `M1-04` منجَزاً. حدُّ
`geography` **لم يُفرَضْ بعدُ** وعملاؤه الثلاثةُ مؤجَّلونَ، والسجلُّ في §4 هو
الرقمُ. ولا يُدَّعى أنّ متغيّراتِ البيئةِ مُعَدّةٌ في أيِّ نشرٍ — لم يُقَسْ ذلك.

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

**الحدودُ المفروضة:** `enforced: matching` · `enforced: orders` · `enforced: identity` · `enforced: dispatch`

| العميلُ الصادر | إلى | الحالة | البرهان أو المرجع |
|---|---|---|---|
| `services/dispatch/src/infrastructure/http-matching.ts` | matching | موقَّع | `service-identity-enforcement.e2e.test.ts` · `DISPATCH_MATCHING_SCOPES` |
| `services/drivers/src/infrastructure/http-candidacy.ts` | matching | موقَّع | `services/drivers/src/__tests__/outbound-ports.test.ts` · `DRIVERS_MATCHING_SCOPES` |
| `services/customers/src/infrastructure/http-geography.ts` | geography | مؤجَّل | حدُّ geography غيرُ مفروضٍ — بوّابةُ M1-04 |
| `services/customers/src/infrastructure/http-identity-lookup.ts` | identity | موقَّع | `services/identity/src/__tests__/http/service-identity.test.ts` · `CUSTOMERS_IDENTITY_SCOPES` |
| `services/customers/src/infrastructure/http-order-intake.ts` | orders | موقَّع | `services/customers/src/__tests__/http-order-intake.test.ts` · `CUSTOMERS_ORDERS_SCOPES` |
| `services/dispatch/src/infrastructure/http-order-engine.ts` | orders | موقَّع | `services/dispatch/src/__tests__/http-order-engine.test.ts` · `DISPATCH_ORDERS_SCOPES` |
| `services/drivers/src/infrastructure/http-zone-catalog.ts` | geography | مؤجَّل | حدُّ geography غيرُ مفروضٍ — بوّابةُ M1-04 |
| `services/geography/src/infrastructure/http-identity-lookup.ts` | identity | موقَّع | `services/geography/src/__tests__/phase02-exit-gate.e2e.test.ts` · `GEOGRAPHY_IDENTITY_SCOPES` |
| `services/matching/src/infrastructure/http-geography.ts` | geography | مؤجَّل | حدُّ geography غيرُ مفروضٍ — بوّابةُ M1-04 |
| `services/negotiations/src/infrastructure/http-agreed-price.ts` | orders | موقَّع | `services/negotiations/src/__tests__/outbound-ports.test.ts` · `NEGOTIATIONS_ORDERS_SCOPES` |
| `services/negotiations/src/infrastructure/http-dispatch-offer.ts` | dispatch + orders | موقَّع | موقِّعانِ صريحانِ بجمهورَينِ: `NEGOTIATIONS_ORDER_LOOKUP_SCOPES` و`NEGOTIATIONS_DISPATCH_OFFER_SCOPES` · `services/negotiations/src/__tests__/outbound-ports.test.ts` يقرأُ `aud` و`scp` من الرمزَين |

<!-- coverage-ledger:end -->

**قراءةُ العدد:** ثمانيةٌ موقِّعونَ من أحدَ عشرَ في هذا السجلِّ — اثنانِ إلى
المطابقةِ وأربعةٌ إلى الطلباتِ واثنانِ إلى الهويّةِ — **وأحدُ الثمانيةِ
(`http-dispatch-offer.ts`) صارَ يوقِّعُ نداءَيه كلَيهما** منذُ الموجةِ الرابعةِ،
بموقِّعَينِ صريحَينِ لجمهورَينِ (`orders` و`dispatch`). وبقيَ ثلاثةٌ مؤجَّلونَ،
**كلُّهم إلى حدِّ `geography` وحدَه** — وهو الحدُّ الأخيرُ غيرُ المفروضِ، وسببُ
تأجيلِه حجزُ `CLM-0004` لا صعوبتُه.

**وثغرةٌ بنيويّةٌ في هذا السجلِّ تُقالُ هنا لا تُخفى:** الحارسُ لا يقيسُ إلّا
`services/*/src/infrastructure/http-*.ts`، فمُنادو حدِّ الهويّةِ **من خارجِ
`services/` غيرُ مرئيّينَ له أصلاً** — وهم اليومَ ثلاثةٌ فعليّونَ:
`packages/bot-runtime/src/identity-bootstrap.ts` (منفذُ القنواتِ، ومنه البوتاتُ
الثلاثةُ) و`bots/customer-bot/src/customer-core.ts`، وقد وُقِّعا في هذه الموجةِ
**لكنّ صدقَهما لا يحرسُه أحدٌ**. الخطرُ مسجَّلٌ **RISK-0027**. والدليلُ على أنّ
الثغرةَ ليست نظريّةً: هذان المُناديانِ لم يظهرا في جردَينِ متتاليَينِ، وكشفَهما
**تشغيلُ الاختباراتِ** لا قراءةُ السجلِّ.

وهذا هو الرقمُ الصحيحُ الذي يُقال، لا «هويّةُ الخدمةِ مُنجَزةٌ». والحارسُ يقرأُ
`signRequest` في الملفِّ، فصفُّ «موقَّع جزئيّاً» يمرُّ عندَه لوجودِ التوقيعِ في
الشفرةِ — **والقيدُ الباقي مُعلَنٌ في نصِّ الصفِّ نفسِه**، وهو ما يقرأُه إنسانٌ.

---

## 5. صلاحيّاتُ الحدَّين

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

### 5.1 حدُّ الطلبات (`M1-04`)

| المسار | الصلاحيّةُ المطلوبة | المُنادي اليوم |
|---|---|---|
| `POST /orders` | `orders:intake:write` | customers |
| `POST /orders/agreed-prices` | `orders:agreed-price:write` | negotiations |
| `GET /orders/lookup` | `orders:order:read` | negotiations |
| `GET /orders/{id}` | `orders:order:read` | قارئونَ خدميّون |
| `GET /orders/{id}/history` | `orders:history:read` | قارئونَ خدميّون |
| `POST /orders/{id}/transitions` | `orders:transition:write` | dispatch |
| `POST /orders/{id}/assignments` | `orders:assignment:write` | dispatch |
| `POST /orders/{id}/assignments/{assignmentId}/resolution` | `orders:assignment:write` | dispatch |
| `GET /health` | مفتوحٌ بتصنيفٍ صريح | — |

**وقيدٌ يُقال هنا لا يُخفى:** `GET /orders/lookup` يقرأُ `order_public_id` من
**سلسلةِ الاستعلامِ**، والربطُ لا يشملُها
([`ADR-021` §4](../15-decisions/ADR-021-service-token-replay-policy.md)) — فرمزٌ
وُقِّعَ لقراءةِ طلبٍ صالحٌ لقراءةِ غيرِه. الخطرُ مسجَّلٌ **RISK-0026**، ومُخفَّفٌ
اليومَ بعمرٍ قصيرٍ للرمزِ وحرقِ `jti`، وعلاجُه الجذريُّ عندَ `M1-05`.

### 5.2 حدُّ الهويّة (`M1-04` · الموجةُ الثالثة)

| المسار | الصلاحيّةُ المطلوبة | المُنادي اليوم |
|---|---|---|
| `POST /identity/resolve` | `identity:resolve:write` | بوتاتُ القنواتِ الثلاثةُ عبرَ `bot-runtime` |
| `GET /identity/users/{waslaPublicId}` | `identity:user:read` | customers · geography · customer-bot |
| `POST /identity/users/{waslaPublicId}/links` | `identity:link:write` | لا مُناديَ خدميٌّ اليومَ |
| `POST /identity/users/{waslaPublicId}/recovery` | `identity:recovery:write` | لا مُناديَ خدميٌّ اليومَ |
| `GET /identity/users/{waslaPublicId}/history` | `identity:history:read` | لا مُناديَ خدميٌّ اليومَ |
| `GET /health` | مفتوحٌ بتصنيفٍ صريح | — |

**والفصلُ هنا ليس تزيّناً:** رمزُ بوتٍ يحملُ `identity:resolve:write` وحدَها، فلا
يقدرُ برمزِه على ربطِ هويّةٍ ولا على بدءِ استعادةِ حسابٍ — وهما أخطرُ ما في هذا
الحدِّ. وكذلك عميلا القراءةِ يحملانِ `identity:user:read` وحدَها. وثلاثُ حالاتٍ
في برهانِ §2.5 تُثبِتُ الرفضَ `403` عندَ تجاوزِ ذلك، لا الادّعاءَ.

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

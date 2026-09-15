# مصفوفةُ سياساتِ التفويضِ (M1-05)

> **مصدرُ الحقيقةِ**: `packages/authz-policy/src/` — وهذهِ الوثيقةُ قراءةٌ لهُ.
> والحارسُ `scripts/checks/validate-authz-policy.sh` (الفحصُ 16) يُسقِطُ الدفعةَ
> إذا تباعدَ أحدُهما عن الآخرِ أو عن الشفرةِ المفروضةِ.
>
> القرارُ: [`ADR-027`](../15-decisions/ADR-027-authorization-policy-matrix.md)
> الجيرانُ: [`SERVICE_AUTH_ENFORCEMENT.md`](SERVICE_AUTH_ENFORCEMENT.md) (M1-04 · المُصادَقةُ) ·
> [`RISK_REGISTER.md`](RISK_REGISTER.md) (`RISK-0026` · `RISK-0042`)

---

## 1. ما كانَ ناقصاً

كانَ في المستودعِ قبلَ هذهِ الدفعةِ إنفاذٌ للمُصادَقةِ (M1-04): كلُّ حدٍّ يتحقَّقُ
من رمزٍ مُوقَّعٍ، ويُقارِنُ `aud` بهويّتِه، ويُقارِنُ `scp` بما يطلبُهُ المسارُ.
وكانَ ذلكَ يجيبُ عن سؤالٍ واحدٍ: **أهذا الطلبُ من خدمةٍ تعرفُها المنظومةُ؟**

ولم يكنْ في المستودعِ جوابٌ عن السؤالِ الثاني: **أيَحقُّ لهذهِ الخدمةِ ما تحملُهُ؟**
فالحدُّ يقبلُ أيَّ رمزٍ صحيحِ التوقيعِ يحملُ الصلاحيّةَ المطلوبةَ، ولا يسألُ
عمّا إذا كانَ للمُوقِّعِ حقٌّ في تلكَ الصلاحيّةِ أصلاً. وهذا صحيحٌ معماريّاً —
البوّابةُ لا تحملُ مصفوفةَ «دورٌ → صلاحيّاتٌ»، والتعليقُ على ذلكَ مكتوبٌ في
`packages/service-auth/src/enforce.ts` و`index.ts` و`token.ts` ويُحيلُ إلى `M1-05`
بالاسمِ — لكنَّ المصفوفةَ التي كانَ يُحالُ إليها **لم تكنْ موجودةً**.

ونتيجةُ غيابِها مقيسةٌ لا مُتخيَّلةٌ: بوّاباتُ الخروجِ في `packages/*-e2e/`
تُصدِرُ رموزاً بـ`Object.values(X_SCOPES)` — أي بكلِّ صلاحيّاتِ الحدِّ — ولا شيءَ
في المستودعِ يُفرِّقُ ذلكَ عن خدمةِ إنتاجٍ تفعلُ الأمرَ نفسَه. فصارَ **أوسعُ منحٍ
ممكنٍ** هوَ النمطَ الطبيعيَّ حيثُ لا مصفوفةَ تقولُ «لا».

---

## 2. القياسُ (2026-09-15)

هذهِ الأرقامُ **مقيسةٌ من الشفرةِ** لا منقولةٌ من تقريرٍ. وهيَ تُصحِّحُ —
بالإضافةِ لا بالمحوِ — ما كانَ مكتوباً على اللوحةِ: «جردُ 107 عمليّةٍ». ولم يكنْ
الرقمُ 107 مقيساً ولا يُعرَفُ مصدرُه؛ والقياسُ الفعليُّ أدناهُ، ومحروسٌ آليّاً.

<!-- authz-matrix:start -->

| القياسُ | القيمةُ | مصدرُ القياسِ |
| --- | --- | --- |
| الحدودُ المفروضةُ | `8` | `services/*/src/http/service-identity.ts` |
| المساراتُ المُسجَّلةُ | `89` | `services/*/src/http/app.ts` |
| العملياتُ المفروضةُ | `ENFORCED_OPERATIONS = 80` | مساراتٌ تُعلِنُ `scoped(...)` |
| المساراتُ المفتوحةُ | `OPEN_ROUTES = 9` | مساراتٌ تُعلِنُ `OPEN` |
| المساراتُ بلا صلاحيّةٍ ولا `OPEN` | `0` | البابُ 2 من الفحصِ 16 |
| الصلاحيّاتُ المفروضةُ | `ENFORCED_SCOPES = 64` | اتّحادُ صلاحيّاتِ العملياتِ |
| صلاحيّاتٌ مُعرَّفةٌ بلا مسارٍ يفرضُها | `0` | البابُ 2 |
| أدوارُ الإنتاجِ المُعلَنةُ | `10` | `PRODUCTION_GRANTS` |
| مواضعُ الإصدارِ الإنتاجيّةُ | `20` | `createServiceRequestSigner` في ملفٍّ غيرِ اختباريٍّ |
| أدوارُ أسطولِ الاختبارِ | `8` | `TEST_FLEET_ROLES` |
| العملياتُ المربوطةُ بالرمزِ | `TOKEN_BOUND_OPERATION_COUNT = 2` | `OPERATION_BINDINGS` · البابُ 7 |
| العملياتُ المُصنَّفةُ (ملكيّةً أو مستأجراً) | `16` | `OPERATION_BINDINGS` |
| العملياتُ غيرُ المُصنَّفةِ | `UNCLASSIFIED_OPERATION_COUNT = 64` | `80 − 16` |

<!-- authz-matrix:end -->

**تصحيحٌ بالإضافةِ · `M1-05B` · 2026-09-15.** كانَ هنا مكتوباً:

> **اقرأِ الصفَّ الأخيرَ صفَّينِ قبلَ الأخيرِ ثانيةً**: `TOKEN_BOUND_OPERATION_COUNT = 0`.
> لا عمليّةَ واحدةً في المنظومةِ تربطُ المَورِدَ بهويّةٍ مُوقَّعةٍ في الرمزِ. وهذا
> `RISK-0042` أدناهُ، وهوَ اكتشافُ هذهِ الدفعةِ لا سهوَها.

وقد صارَ العددُ **اثنَينِ** بالموجةِ الأولى من `M1-05B`: `GET /orders/:orderId`
و`GET /orders/:orderId/history` صارَ كلٌّ منهما مُصنَّفاً `beneficiary: "required"`،
فرمزٌ بلا مُنتَفِعٍ يُرَدُّ 403 عندَ الوسيطِ قبلَ أن يَبلُغَ المُعالِجَ، والمالكُ
يُقرأُ من الرمزِ (`ownerPublicIdOf`) لا من ترويسةٍ يكتبُها المُنادي.

**وما لم يَتِمَّ يُقالُ بالقدرِ نفسِهِ من الصراحةِ**: الاثنانِ كلُّهما في بُعدِ
**الملكيّةِ**، و**بُعدُ المستأجرِ لا يزالُ بلا ربطٍ واحدٍ** — أربعةَ عشرَ صفّاً
`none`، منها أحدَ عشرَ في حدِّ السوقِ. فالعددُ 2 **ليسَ إغلاقاً لـ`RISK-0042`**
بل إنجازُ واحدٍ من ثلاثةِ بنودِه. والخطرُ يبقى مفتوحاً حتّى تُنجَزَ الموجتانِ
الثانيةُ (عضويّةُ المستأجرِ في السوقِ) والثالثةُ (`actorPublicId` من جسمِ الطلبِ).

**وتصحيحٌ ثانٍ يخصُّ الدعوى لا الرقمَ:** قيلَ في `M1-05` إنَّ الإصلاحَ يقتضي
«إضافةَ مطلبٍ إلى الرمزِ» أي تغييرَ عقدِ الرمزِ (`ADR-020` · `ADR-021`). وقد
أظهرَ القياسُ المُعادُ أنَّ المطلبَ **كانَ موجوداً أصلاً** اختياريّاً باسمِ
`obo` في `packages/service-auth/src/token.ts`، ولهُ قارئٌ جاهزٌ
`ownerPublicIdOf()` في `packages/auth-sdk/src/authorize.ts`، ومستهلِكٌ واحدٌ
في `services/delivery`. فالفجوةُ كانتْ **«مطلبٌ اختياريٌّ لا يُلزِمُهُ أحدٌ»**
لا «لا مطلبَ». وهذا يُصغِّرُ حجمَ الإصلاحِ ولا يُغيِّرُ اتّجاهَهُ، ويُترَكُ
النصُّ الأوّلُ مكتوباً لأنَّ التقديرَ الخاطئَ هوَ ما بُرِّرَ بهِ التأجيلُ.

---

## 3. البُعدُ الأوّلُ: الدورُ → الجمهورُ → الصلاحيّاتُ

المنحُ **سقفٌ لا أمرٌ**: طلبُ أقلَّ منهُ مسموحٌ ومحمودٌ، وطلبُ صلاحيّةٍ خارجَهُ
مرفوضٌ. والمجموعةُ الفارغةُ مسموحةٌ إذا وُجِدَ منحٌ على الجمهورِ — فمِجَسُّ صحّةٍ
يُوقِّعُ بلا صلاحيّةٍ (`DELIVERY_MARKETPLACE_PROBE_SCOPES`) سلوكٌ صحيحٌ لا نقصُ إعدادٍ.

| الدورُ | الجمهورُ | سقفُ الصلاحيّاتِ | ثوابتُ الإصدارِ (الدليلُ) |
| --- | --- | --- | --- |
| `customers` | `identity` | `identity:user:read` | `CUSTOMERS_IDENTITY_SCOPES` |
| `customers` | `orders` | `orders:intake:write` | `CUSTOMERS_ORDERS_SCOPES` |
| `customers` | `geography` | `geography:zone:read` | `CUSTOMERS_GEOGRAPHY_SCOPES` |
| `delivery` | `marketplace` | `marketplace:store:read`, `marketplace:product:read`, `marketplace:inventory:reserve`, `marketplace:inventory:release` | `DELIVERY_MARKETPLACE_SCOPES`, `DELIVERY_MARKETPLACE_PROBE_SCOPES`, `DELIVERY_MARKETPLACE_RESERVATION_SCOPES` |
| `dispatch` | `matching` | `matching:candidates:evaluate`, `matching:candidacy:write` | `DISPATCH_MATCHING_SCOPES` |
| `dispatch` | `orders` | `orders:assignment:write`, `orders:transition:write` | `DISPATCH_ORDERS_SCOPES` |
| `drivers` | `matching` | `matching:candidacy:read`, `matching:candidacy:write` | `DRIVERS_MATCHING_SCOPES` |
| `drivers` | `geography` | `geography:zone:read` | `DRIVERS_GEOGRAPHY_SCOPES` |
| `geography` | `identity` | `identity:user:read` | `GEOGRAPHY_IDENTITY_SCOPES` |
| `matching` | `geography` | `geography:zone:read` | `MATCHING_GEOGRAPHY_SCOPES` |
| `negotiations` | `orders` | `orders:order:read`, `orders:agreed-price:write` | `NEGOTIATIONS_ORDER_LOOKUP_SCOPES`, `NEGOTIATIONS_ORDERS_SCOPES` |
| `negotiations` | `dispatch` | `dispatch:offer:read` | `NEGOTIATIONS_DISPATCH_OFFER_SCOPES` |
| `customer-bot` | `identity` | `identity:resolve:write`, `identity:user:read` | `CHANNEL_IDENTITY_SCOPES`, `CUSTOMERS_IDENTITY_SCOPES` |
| `customer-bot` | `geography` | `geography:zone:read` | `CUSTOMERS_GEOGRAPHY_SCOPES` |
| `customer-bot` | `negotiations` | `negotiations:thread:read`, `negotiations:round:read`, `negotiations:round:decide` | `CUSTOMER_BOT_NEGOTIATIONS_SCOPES` |
| `driver-bot` | `identity` | `identity:resolve:write` | `CHANNEL_IDENTITY_SCOPES` |
| `driver-bot` | `negotiations` | `negotiations:thread:read`, `negotiations:round:read`, `negotiations:round:decide` | `DRIVER_BOT_NEGOTIATIONS_SCOPES` |
| `partner-bot` | `identity` | `identity:resolve:write` | `CHANNEL_IDENTITY_SCOPES` |

وما لا يُقرأُ في الجدولِ يُقرأُ في غيابِه: لا منحَ لخدمةٍ على `delivery` غيرَ ما
ذُكِرَ؛ ولا منحَ لأيِّ دورٍ على `orders:history:read` — فهيَ صلاحيّةٌ مفروضةٌ في
الشفرةِ لا حاملَ لها اليومَ، ودينٌ مقروءٌ لا عطلٌ صامتٌ.

**أدوارُ البوتاتِ الثلاثةُ مُركَّبةٌ لا مكتوبةٌ**: جذرُ التركيبِ واحدٌ
(`packages/bot-runtime/src/runtime.ts`) واسمُ الدورِ فيهِ قالبٌ `${config.bot}-bot`.
والحارسُ يُوسِّعُهُ على `BOT_KINDS` المُعلَنِ في العقدِ — فإن أُضيفَ بوتٌ رابعٌ بلا
منحٍ مُعلَنٍ **سقطتِ الدفعةُ**، وهوَ المقصودُ.

### أدوارُ أسطولِ الاختبارِ

ثمانيةُ أدوارٍ تُوقِّعُ في `packages/*-e2e/` و`**/__tests__/**` وحدَها:
`e2e-harness`, `order-exit-gate`, `dispatch-exit-gate`, `reputation-exit-gate`,
`channel-exit-gate`, `phase02-exit-gate`, `attacker`, `caller`.

ولا منحَ إنتاجيَّ لأيٍّ منها، وظهورُ أحدِها في ملفٍّ غيرِ اختباريٍّ **يُسقِطُ
الدفعةَ**. ولِمَ عُزِلتْ ولم تُضيَّقْ صلاحيّاتُها: لأنَّها تُوقِّعُ بمجموعاتٍ أوسعَ
من أيِّ منحٍ إنتاجيٍّ **بقصدٍ** — وبعضُها يُوقِّعُ بصلاحيّةٍ خاطئةٍ أو لجمهورٍ
خاطئٍ لأنَّ ذلكَ **هوَ** الاختبارُ السلبيُّ. فتضييقُها يُتلِفُ اختباراتٍ صحيحةً،
وعزلُها يُثبِّتُ الحدَّ بينَ ما هوَ إنتاجٌ وما هوَ قياسٌ.

---

## 4. البُعدانِ الثاني والثالثُ: الملكيّةُ والمستأجرُ

هنا تصنيفٌ لا إنفاذٌ. والفرقُ مُعلَنٌ لأنَّ إخفاءَهُ هوَ العطبُ الحقيقيُّ.

| العملياتُ | البُعدُ | قوّةُ الربطِ | الدليلُ |
| --- | --- | --- | --- |
| `GET /orders/:orderId` · `GET /orders/:orderId/history` | `owner` | `caller-asserted` | `services/orders/src/http/app.ts` (`assertOwner`) |
| `GET /orders/lookup` | `owner` | `none` | `services/orders/src/http/app.ts` (خدمةٌ لخدمةٍ بالتصميمِ) |
| 11 مساراً على `/stores/:storeSlug/…` | `tenant` | `none` | `services/marketplace/src/http/app.ts` (`pathParam`) |
| `POST /products/:productId/publish` · `…/archive` | `owner` | `none` | `services/marketplace/src/http/app.ts` (`actorPublicId`) |

**ستَّ عشرةَ من ثمانينَ مُصنَّفةً · أربعٌ وستّونَ غيرُ مُصنَّفةٍ.** ولم تُعلَنِ
الأربعُ والستّونَ «بلا ملكيّةٍ» لأنَّ ذلكَ دعوى لم تُقَسْ. والحسابُ محروسٌ:
`OPERATION_BINDINGS.length + UNCLASSIFIED_OPERATION_COUNT === ENFORCED_OPERATIONS.length`
— فلا عمليّةَ تسقطُ من الجردِ بصمتٍ عندَ إضافةِ مسارٍ جديدٍ.

### حدُّ السوقِ: المستأجرُ مُعنوَنٌ ولا مُتحقَّقٌ منه

`storeSlug` يُقرأُ من المسارِ ويُسلَّمُ إلى المُستودَعِ في أحدَ عشرَ مساراً، ولا
موضعَ واحدٌ يسألُ «أهذا المُنادي من هذا المتجرِ؟». فحاملُ `marketplace:staffWrite`
يكتبُ موظّفاً في **أيِّ** متجرٍ، وحاملُ `marketplace:productWrite` يُنشِئُ منتجاً
في **أيِّ** متجرٍ. والصلاحيّةُ على مستوى الحدِّ لا على مستوى المُستأجِرِ — فرقٌ
لم يكنْ مكتوباً في المستودعِ قبلَ هذهِ الدفعةِ.

و`POST /products/:productId/publish` و`…/archive` تقرآنِ `actorPublicId` من **جسمِ
الطلبِ**، تتحقَّقانِ من شكلِهِ، وتُسجِّلانِهِ في أثرِ التدقيقِ. وأثرُ تدقيقٍ
يُكتَبُ بقيمةٍ يختارُها المُنادي **أثرٌ يُثبِتُ الدعوى لا الفعلَ** — وهوَ أضعفُ
من حالِ الطلباتِ: هناكَ تُقارَنُ القيمةُ بمَورِدٍ، وهنا لا تُقارَنُ بشيءٍ.

### معنى `caller-asserted`

`assertOwner()` يُقارِنُ `order.customerPublicId` بما يُعيدُهُ `requireCustomerScope()`،
وذاكَ يقرأُ الترويسةَ `X-Customer-Public-Id` ويتحقَّقُ من **شكلِها** فقط. والرمزُ
(`packages/service-auth/src/token.ts`) يحملُ `sub` (اسمَ الخدمةِ) و`aud` و`scp` —
**ولا يحملُ هويّةَ المُستفيدِ**. فحاملُ `orders:order:read` يكتبُ أيَّ مُعرِّفِ
عميلٍ شاءَ فتمرُّ المقارنةُ.

فالمقارنةُ الناجحةُ هنا **ليست إثباتَ ملكيّةٍ**، بل إثباتُ أنَّ المُنادي كتبَ
القيمةَ التي يعرفُها. ولهذا تُصرِّحُ `evaluateOwnerBinding` بقوّةِ الربطِ في نصِّ
الرفضِ ولا تُسكِتُها: مَن يقرأُ سجلَّ الرفضِ يجبُ أن يعلمَ أنَّ القبولَ كانَ ليكونَ
بلا قيمةٍ أمنيّةٍ.

---

## 5. حدُّ الدعوى في هذهِ الدفعةِ

> **الأخضرُ هنا يعني «لا انحرافَ في الإعدادِ»، ولا يعني «يستحيلُ إصدارُ رمزٍ
> زائدِ الصلاحيّاتِ».**

| السؤالُ | الجوابُ في هذهِ الدفعةِ |
| --- | --- |
| هل كلُّ إعدادِ إصدارٍ إنتاجيٍّ داخلَ سقفِه؟ | **نعم** — محروسٌ ساكناً على 20 موضعاً |
| هل تُرفَضُ صلاحيّةٌ زائدةٌ في زمنِ التشغيلِ؟ | **لا** — `M1-05B` |
| هل الملكيّةُ مربوطةٌ بالرمزِ؟ | **لا** — `RISK-0042` · `M1-05B` |
| هل عضويّةُ المستأجرِ مفروضةٌ؟ | **لا** — 11 مساراً مُصنَّفاً `none` في حدِّ السوقِ |
| هل يُكشَفُ انحرافُ مصفوفةٍ عن شفرةٍ؟ | **نعم** — في الاتجاهَين |

ولِمَ لم يُفرَضْ في زمنِ التشغيلِ في هذهِ الدفعةِ: القياسُ أثبتَ أنَّ تسعَ حزمِ
`*-e2e` تُوقِّعُ بمجموعاتٍ أوسعَ من أيِّ منحٍ إنتاجيٍّ بقصدٍ، وبعضُها يُوقِّعُ
بدورِ إنتاجٍ (`"dispatch"` في `packages/dispatch-e2e/src/harness.ts`). فإنفاذُ
المصفوفةِ عندَ المُوقِّعِ يُسقِطُ تلكَ الحزمَ جميعاً، وإصلاحُها خارجُ نطاقِ
`CLM-0177` المحجوزِ. والنطاقُ الذي لا يُحجَزُ لا يُعدَّلُ (بروتوكولُ الخارطةِ §4).

---

## 6. الإنفاذُ

| الطبقةُ | الموضعُ | ما تُثبِتُهُ |
| --- | --- | --- |
| الفحصُ 16 | `scripts/checks/validate-authz-policy.sh` | لا انحرافَ بينَ المصفوفةِ والشفرةِ والوثيقةِ — في الاتجاهَين |
| اختباراتُ الوحدةِ | `packages/authz-policy/src/__tests__/policy.test.ts` | رفضُ الدورِ والملكيّةِ والمستأجرِ (27 حالةً) |
| حالاتُ الطفرةِ | `scripts/checks/test-governance.sh` | أنَّ الفحصَ 16 **يعضُّ** — كلُّ بابٍ مُثبَتٌ بطفرةٍ تُسقِطُه |

وأبوابُ الفحصِ 16 الستّةُ مشروحةٌ في رأسِ الملفِّ نفسِه. وما لا يفحصُهُ: لا يقرأُ
زمنَ تشغيلٍ، ولا يتحقَّقُ من توقيعٍ، ولا يقيسُ ملكيّةً فعليّةً — ثلاثتُها خارجَ
دعوى هذهِ الدفعةِ بالنصِّ أعلاه.

---

## 7. المخاطرُ

- **`RISK-0042`** (جديدٌ · هذهِ الدفعةُ): ربطُ الملكيّةِ مُدَّعىً من المُنادي لا
  مربوطٌ بالرمزِ. `TOKEN_BOUND_OPERATION_COUNT = 0`.
- **`RISK-0042` (الوجهُ الثاني)**: عضويّةُ المُستأجِرِ غيرُ مفروضةٍ في حدِّ
  السوقِ — 11 مساراً على `/stores/:storeSlug/…` بقوّةِ ربطٍ `none`.
- **`RISK-0026`** (مفتوحٌ · **لم يُغلَقْ** بهذهِ الدفعةِ): ربطُ الرمزِ لا يشملُ
  سلسلةَ الاستعلامِ (`ADR-021 §4`)، و`GET /orders/lookup` يُمرِّرُ المُعرِّفَ فيها.

---

## 8. كيفَ تُغيَّرُ هذهِ المصفوفةُ

1. غيِّرِ الشفرةَ (مساراً أو صلاحيّةً أو موضعَ إصدارٍ).
2. شغِّلْ `bash scripts/checks/validate-authz-policy.sh` — سيُسمّي لكَ كلَّ انحرافٍ.
3. حدِّثْ `packages/authz-policy/src/` **وأرقامَ §2 من هذهِ الوثيقةِ** — الحارسُ
   يُطابِقُ الأرقامَ حرفيّاً (`ENFORCED_OPERATIONS = N` … ) فلا تشيخُ بصمتٍ.
4. إن وسَّعتَ منحاً، اكتبْ `reason` يُبرِّرُ **الحاجةَ** لا الوجودَ، و`evidence`
   يُسمّي ثابتَ الصلاحيّاتِ الفعليَّ.
5. أضِفْ حالةَ طفرةٍ في `scripts/checks/test-governance.sh` تُسقِطُ ما أضفتَ.

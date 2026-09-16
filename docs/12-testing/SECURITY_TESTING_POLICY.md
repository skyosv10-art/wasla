# SECURITY_TESTING_POLICY — سياسةُ الاختبارِ الأمنيِّ (ملزمة)

> **الحالة:** ساريةٌ · **العنصر:** `M1-09` · **آخر تحديث:** 2026-09-16 · **المالك:** @uxxxu
>
> **المرجع:** [`THREAT_MODEL.md`](../07-security/THREAT_MODEL.md) · [`RISK_REGISTER.md`](../07-security/RISK_REGISTER.md) · [`SERVICE_AUTH_ENFORCEMENT.md`](../07-security/SERVICE_AUTH_ENFORCEMENT.md) · [`AUTHORIZATION_POLICY_MATRIX.md`](../07-security/AUTHORIZATION_POLICY_MATRIX.md) · [`DEFINITION_OF_DONE.md`](../00-rules/DEFINITION_OF_DONE.md) · [`TESTING_RULES.md`](../00-rules/TESTING_RULES.md)

---

## 0. القاعدة في سطر

**الاختبارُ الأمنيُّ يُثبتُ الرفضَ لا النجاح.** اختبارٌ أخضرُ يقولُ «الضابطَ يعملُ» لا «النظامَ آمنٌ». واختبارٌ أحمرُ يقولُ «الضابطَ مكسور». والحُكمَ على النظامِ يأتي من جردِ ما يُرفَض وما لا يُرفَع، لا من عدِّ ما ينجح.

---

## 1. الاختباراتُ السلبيّةُ المطلوبة

> **القاعدة:** كلُّ حدِّ ثقةٍ (§2.2 في [`THREAT_MODEL.md`](../07-security/THREAT_MODEL.md)) له اختباراتٌ سلبيّةٌ تُثبتُ الرفض. لا يُقبَلُ اختبارٌ إيجابيٌّ وحدَه.

| الفئة | ما يُرفَض | أين يُقاس | الحارسُ |
|---|---|---|---|
| **المصادقة (Authn)** | نداءٌ بلا رمز · رمزٌ منتهٍ · رمزٌ مُزوَّر · جمهورٌ خاطئ | `packages/service-auth/__tests__/` · `packages/service-auth/src/fastify.ts` | فحصٌ 12 (`validate-service-auth-coverage.sh`) |
| **التفويض (Authz)** | صلاحيّةٌ ناقصة · رمزٌ زائدُ الصلاحيّات | `packages/authz-policy/__tests__/` · `validate-authz-policy.sh` (فحصٌ 16 · 9 أبواب) | فحصٌ 16 |
| **الملكيّة (Owner)** | `obo` ناقص · `assertOwner` يقرأُ من ترويسةٍ | `services/orders/__tests__/` · `packages/marketplace-e2e/` | فحصٌ 16 · البابُ 7 |
| **المُستأجِر (Tenant)** | عضويّةٌ ناقصة · `tenantScoped` ناقص | `services/marketplace/__tests__/` · `packages/marketplace-e2e/` | فحصٌ 16 · البابُ 7 |
| **إعادةُ التشغيل (Replay)** | رمزٌ مُعادُ استعمالُه خارجَ نافذته | `packages/service-auth/__tests__/` · ADR-021 | فحصٌ 12 |
| **تحديدُ المعدَّل (Rate-limit)** | تجاوزُ السعة · 429 + Retry-After | `packages/service-auth/src/__tests__/edge-controls.test.ts` | فحصٌ 17 (بدائيّاتٌ لا نشر) |
| **التنقيح (Redaction)** | ترويسةٌ حسّاسةٌ في جسمِ خطأ · رمزُ `wsvc2` | `packages/service-auth/src/__tests__/edge-controls.test.ts` | فحصٌ 17 (بدائيّاتٌ لا نشر) |

---

## 2. متى تُضافُ الاختباراتُ أو تُعادُ

| المُحفِّز | الإجراء |
|---|---|
| **حدُّ ثقةٍ جديد** | اختباراتُ رفضٍ سلبيّةٌ قبلَ الدمج (لا يُقبَلُ حدٌّ بلا رفضٍ مُقاس) |
| **صلاحيّةٌ جديدة** | صفٌّ في `AUTHORIZATION_POLICY_MATRIX.md` + تصنيفُ ربطٍ (`token-bound` · `caller-asserted` · `none`) + اختبارُ رفض |
| **مسارُ HTTP جديد** | تسجيلٌ في `ENFORCED_OPERATIONS` + `securitySchemes` في العقدِ المنشور + اختبارُ 401/403 |
| **حادثٌ أمنيٌّ** | اختبارُ رفضٍ يُعيدُ إنتاجَ الحادثِ (regression) + تحديثُ `THREAT_MODEL.md` |
| **خطرٌ جديدٌ في `RISK_REGISTER.md`** | تقييمُ ما إذا كان يقتضي اختبارَ رفضٍ |
| **تغييرٌ في `PRODUCTION_GRANTS`** | إعادةُ قياسِ `assertSignerComposition` + البابُ 8 و9 |
| **دمجُ PR** | البوّابةُ (33 فحصاً) تُثبتُ الاختبارَ الأمنيَّ الأخضر |

---

## 3. ما تُثبتُه البوّابةُ وما لا تُثبته

### 3.1 ما تُثبتُه (Proven by CI)

| الفحص | ما يُثبت | الأبواب |
|---|---|---|
| `verify.sh` | البوّابةُ 17 فحصاً · الأساسُ المرجعيُّ · الاختباراتُ | 4 أبواب |
| `governance-guard` | 392 حالةَ حوكمةٍ · 0 فاشلة · طفراتُ رفض | 17 فحصاً |
| `validate-service-auth-coverage.sh` | 6 حدودٍ مُثبَتة · 80 عمليّةً مفروضة | 6 أبواب |
| `validate-authz-policy.sh` | المصفوفةُ مُطابَقةٌ · `TOKEN_BOUND = 10` · `TENANT_BOUND = 8` مُشتَقَّانِ | 9 أبواب |
| `validate-app-port-wiring.sh` | المنافذُ الاختياريّةُ مُركَّبةٌ | 4 أبواب |
| `*-db-integration` | التكاملُ على Postgres حقيقيٍّ | 13 وظيفة |
| `*-exit-gate-e2e` | بوّابةُ الخروجِ على سلكٍ حقيقيٍّ | 11 وظيفة |

### 3.2 ما لا تُثبته (Not Proven by CI)

| المجال | السبب | الخطرُ المُسجَّل |
|---|---|---|
| **نشرُ ضوابطِ الحافةِ في الإنتاج** | البدائيّاتُ متاحةٌ، النشرُ قرارُ مالك | [`THREAT_MODEL.md`](../07-security/THREAT_MODEL.md) §4.1 |
| **تغطيةُ الاختبارِ الكاملة** | لا أداةَ تغطية | [`RISK-0005`](../07-security/RISK_REGISTER.md) |
| **فحصُ الأسلوبِ الآلي** | لا `eslint` | [`RISK-0006`](../07-security/RISK_REGISTER.md) |
| **إقفالُ `RISK-0042`** | 63 عمليّةً غيرَ مُصنَّفة | [`RISK-0042`](../07-security/RISK_REGISTER.md) |
| **حارسُ استيرادِ `devDependencies` عام** | حُرِسَ عقدٌ واحدٌ لا الكل | [`RISK-0043`](../07-security/RISK_REGISTER.md) |
| **حمايةُ الفرعِ المُلزِمة** | `enforce_admins: true` لكن الدمجُ بـ`--admin` ممكنٌ بقرار | [`RISK-0036`](../07-security/RISK_REGISTER.md) |

---

## 4. قواعدُ الحوادث (Incident-Triggered Review)

> **المرجع:** [`INCIDENTS.md`](../07-security/INCIDENTS.md) · [`SECURITY_RULES.md`](../00-rules/SECURITY_RULES.md) §7

1. **كلُّ حادثٍ أمنيٍّ** يُسجَّل في [`INCIDENTS.md`](../07-security/INCIDENTS.md) بتاريخٍ وأثرٍ مقيسٍ واستجابةٍ ودليلِ تعافٍ.
2. **كلُّ حادثٍ** يُولِّدُ اختبارَ رفضٍ (regression) يُعيدُ إنتاجَ المسارَ المكسور ويُثبتُ الرفض.
3. **كلُّ حادثٍ** يُحدِّثُ [`THREAT_MODEL.md`](../07-security/THREAT_MODEL.md) بصفٍّ جديدٍ في الجدولِ المُناسب.
4. **كلُّ حادثٍ** يُفتحُ خطراً في [`RISK_REGISTER.md`](../07-security/RISK_REGISTER.md) إن لم يكن مُسجَّلاً.
5. **لا يُحذَفُ أثرُ الحادث** — [`INCIDENTS.md`](../07-security/INCIDENTS.md) سجلٌ تراكميٌّ لا قائمةُ مهامٍ مُنجَزة.

---

## 5. التصنيفُ المُتدرِّجُ للافتراضات

| الافتراض | التصنيف | السبب |
|---|---|---|
| «الضابطُ مُنفَّذٌ» | **مُقاسٌ** | البوّابةُ خضراء + اختباراتُ الرفض |
| «الضابطُ مُنشَرٌ» | **غيرُ مُدَّعى** | نشرُ الإنتاج قرارُ مالك (§4.1) |
| «النظامُ آمنٌ» | **غيرُ مُدَّعى** | الدَّينُ مُسجَّل لا مُغلق |
| «لا ثغراتٍ معروفة** | **مُتتبَّع** | `RISK-0010`: التدقيقُ رهنُ مُسجَّلِ npm يومَ التشغيل |

---

## 6. المرجعيّةُ والتحديث

- هذه السياسةُ تُحدَّثُ مع كلِّ عنصرِ عملٍ أمنيٍّ جديد (M1-10+).
- كلُّ تغييرٍ في [`THREAT_MODEL.md`](../07-security/THREAT_MODEL.md) يُحدِّثُ هذه السياسة.
- كلُّ خطرٍ جديدٍ يُقيَّمُ ضدَّ هذه السياسة.
- **لا يُقبَلُ دمجُ حدِّ ثقةٍ جديد** بلا اختبارِ رفضٍ سلبيٍّ مُقاس.

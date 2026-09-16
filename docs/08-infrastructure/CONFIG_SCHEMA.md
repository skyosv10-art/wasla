# CONFIG_SCHEMA — مخطَّطُ الإعدادِ ومصدرُ حقيقتِهِ الواحدُ (ملزم)

> **الحالة:** ساريةٌ · **العنصر:** `M2-04` · **الحجز:** `CLM-0194` · **آخر تحديث:** 2026-09-16 · **المالك:** @uxxxu (agent:perplexity-computer)
>
> **المرجع:** [`packages/config/env-registry.json`](../../packages/config/env-registry.json) (مصدرُ الحقيقةِ) · [`ADR-032`](../15-decisions/ADR-032-config-schema-single-source.md) · [`M2-04_GATE.md`](../12-testing/M2-04_GATE.md) · محروسٌ بالفحصِ **18** في [`verify-governance.sh`](../../scripts/checks/verify-governance.sh)

---

## 0. لماذا يوجد هذا الملف

**العيبُ الذي أنشأهُ مقيسٌ لا مُقدَّرٌ.** قِيسَ على المستودعِ الحيِّ يومَ
2026-09-16 قبلَ أيِّ تعديلٍ:

- **سبعةَ عشرَ موضعاً** في شفرةِ الإنتاجِ يقرأُ متغيّرَ بيئةٍ عدديّاً بـ
  `Number(process.env.X)` أو ما يُشابهُهُ، **بلا مُصادِقٍ واحدٍ**.
- **أربعةُ قُرّاءٍ صارمينَ مُكرَّرينَ** يفعلُ كلٌّ منهُم الشيءَ نفسَهُ بصياغةٍ
  مختلفةٍ في أربعةِ ملفّاتٍ:
  [`services/delivery/src/ops/idempotency-sweep-runner.ts`](../../services/delivery/src/ops/idempotency-sweep-runner.ts) ·
  [`services/delivery/src/domain/dependency-probe.ts`](../../services/delivery/src/domain/dependency-probe.ts) ·
  [`services/marketplace/src/http/server.ts`](../../services/marketplace/src/http/server.ts) ·
  [`packages/bot-runtime/src/config.ts`](../../packages/bot-runtime/src/config.ts).
- **لا ملفَّ `.env.example` في المستودعِ إطلاقاً**، ولا جردَ واحداً يُسمّي
  متغيّراتِ البيئةِ التي تعتمدُ عليها الخدماتُ الثلاثةَ عشرَ.
- و`packages/config` كانت **مجلّداً فيهِ `.gitkeep` وحدَهُ** — أي أنَّ اللوحةَ
  تُعلِنُ مِلكاً لا شفرةَ فيهِ.

**ودلالةُ `Number` ليست رأياً بل سلوكاً مقيساً حرفاً:**

```
Number("٣")     ⇒ NaN        // رقمٌ عربيٌّ-هنديٌّ: لا يُرفَضُ، يصيرُ NaN صامتاً
Number("")      ⇒ 0          // الفراغُ يصيرُ صفراً، لا غياباً
Number("0x10")  ⇒ 16         // سِتَّ عَشْريٌّ يُقبَلُ بلا إعلانٍ
Number("1e3")   ⇒ 1000       // أُسّيٌّ يُقبَلُ
Number(" 12 ")  ⇒ 12         // الفراغاتُ تُقتَطَعُ بصمتٍ
```

**والأثرُ التشغيليُّ مُسمّىً لا مُجمَلٌ:** ضبطُ `DISPATCH_WAVE_SIZE=٣` في بيئةٍ
عربيّةٍ يجعلُ `waveSize = NaN`، فتُبنى موجةُ إسنادٍ **بلا سائقٍ واحدٍ**،
و`GET /dispatch/health` يُجيبُ **200** لأنَّ الخدمةَ قائمةٌ فعلاً. فالخدمةُ
«سليمةٌ» وهيَ لا تُسنِدُ طلباً — **وهذا أسوأُ من سقوطٍ، لأنَّ السقوطَ يُقرأُ
حكماً والصمتَ يُقرأُ سلامةً**.

**ولماذا لا يكفي إصلاحُ المواضعِ السبعةَ عشرَ:** لأنَّها تعودُ بأوّلِ قراءةٍ
جديدةٍ. فالعلاجُ **مصدرُ حقيقةٍ واحدٌ + قُرّاءٌ صارمونَ + حارسٌ يُسقِطُ الدفعةَ**،
لا مراجعةٌ بشريّةٌ ولا قاعدةٌ مكتوبةٌ نثراً.

---

## 1. القاعدة في سطر

**كلُّ متغيّرِ بيئةٍ تقرأُهُ شفرةُ إنتاجٍ لهُ صفٌّ في
[`env-registry.json`](../../packages/config/env-registry.json)، ويُقرأُ عبرَ قارئٍ
من [`@wasla/config`](../../packages/config/src/index.ts) لا عبرَ `process.env`
مباشرةً، و`.env.example` و`registry.generated.ts` **مُشتقّانِ آليّاً** لا
مكتوبانِ بيدٍ.** ما خرجَ عن ذلكَ يُسقِطُ الفحصَ 18.

---

## 2. المصدرُ والمُشتقّاتُ

| الملفُّ | الطبيعةُ | مَن يكتبُهُ |
|---|---|---|
| [`packages/config/env-registry.json`](../../packages/config/env-registry.json) | **مصدرُ الحقيقةِ** — 59 متغيّراً · 157 قراءةً مُعلَنةً | يدٌ بشريّةٌ/عاملٌ، ثمَّ يُصادِقُهُ الفحصُ 18 |
| [`.env.example`](../../.env.example) | **مُشتَقٌّ** (301 سطراً) | [`scripts/config/render-config-artifacts.py`](../../scripts/config/render-config-artifacts.py) |
| [`packages/config/src/registry.generated.ts`](../../packages/config/src/registry.generated.ts) | **مُشتَقٌّ** (697 سطراً) | المُولِّدُ نفسُهُ |
| [`scripts/checks/lib/config_render.py`](../../scripts/checks/lib/config_render.py) | **المُولِّدُ الوحيدُ** — لا نسخةَ ثانيةً من منطقِ التصييرِ | — |

**والاشتقاقُ يُثبَتُ لا يُدَّعى:** البابُ 3 من الفحصِ 18 يُعيدُ التصييرَ في
الذاكرةِ ويُقارِنُهُ بالمُلتزَمِ حرفاً — فسطرٌ مكتوبٌ بيدٍ في `.env.example` أو
رقمٌ مُحرَّرٌ في `registry.generated.ts` يُسقِطُ الدفعةَ.

### 2.1 حقولُ الصفِّ

`name` · `type` (`string`·`int`·`port`·`url`·`postgres_url`·`csv`·`flag`·`secret_material`)
· `required` (`always`·`production`·`optional`) · `default` · `secret` (منطقيٌّ)
· `scopes` · `description_ar` · `owner_item` · `readers[]` (`file` + `mode`
[+ `template`]) · `note_ar` (اختياريٌّ).

وأنماطُ القراءةِ المعتمدةُ (`VALID_MODES`): `direct` · `reader` · `bag` ·
`helper` · `template` · `default_literal`.

---

## 3. القُرّاءُ الصارمونَ

في [`packages/config/src/index.ts`](../../packages/config/src/index.ts):
`readRawEnv` · `requireEnv` · `readStringEnv` · `readIntEnv` ·
`readLenientIntEnv` · `readPortEnv` · `readUrlEnv` · `readPostgresUrlEnv` ·
`readCsvEnv` · `readFlagEnv` — وكلُّها ترمي `ConfigError` بحقلَي `variable`
و`rawValue`.

**وثلاثُ خصالٍ مقصودةٍ يُقالُ سببُها:**

1. **`readIntEnv` يقبلُ أرقاماً عَشْريّةً حرفاً فقطُ** (تعبيرٌ نمطيٌّ على
   الخاناتِ) — فلا `0x10` ولا `1e3` ولا `٣` ولا فراغٌ يمرُّ. والرفضُ **رميةٌ
   مُسمّاةٌ** لا `NaN` صامتٌ.
2. **`readLenientIntEnv` موجودٌ بقصدٍ ومُسمّىً بصراحتِهِ**: بعضُ المواضعِ كانت
   تقبلُ فراغاً فتعودُ إلى الافتراضِ، وتضييقُها في الدفعةِ نفسِها **تغييرُ عقدِ
   تشغيلٍ** لا تنظيفُ قراءةٍ — فبقيَ التسامحُ **مُعلَناً باسمِ دالّتِهِ** لا
   مطويّاً في `readIntEnv`.
3. **`readPostgresUrlEnv` لا يطبعُ القيمةَ البتّةَ** في أيِّ رسالةِ خطأٍ —
   لأنَّها تحملُ كلمةَ السرِّ.

---

## 4. أبوابُ الفحصِ 18 (ثمانيةٌ)

| البابُ | ما يُثبِتُهُ | الطفرةُ التي يعضُّها |
|---|---|---|
| 1 | كلُّ قراءةٍ حيّةٍ في الشفرةِ لها صفٌّ في السجلِّ | حذفُ سجلِّ قراءةٍ قائمةٍ |
| 2 | كلُّ قارئٍ مُعلَنٍ موجودٌ فعلاً في ملفِّهِ (لا إعلانَ ميّتاً) | إعلانٌ لملفٍّ لا يذكرُ الاسمَ |
| 3 | `.env.example` و`registry.generated.ts` مُشتقّانِ حرفاً | سطرٌ مكتوبٌ بيدٍ · رقمٌ مُحرَّرٌ |
| 4 | `type == "secret_material" ⇒ secret == true` | خفضُ سرٍّ إلى غيرِ سرٍّ |
| 5 | لا سرَّ لهُ `default` | سرٌّ بقيمةٍ افتراضيّةٍ |
| 6 | لا `Number(process.env.…)` في شفرةِ الإنتاجِ | عودةُ القراءةِ الخامِّ |
| 7 | كلُّ سرٍّ في `.env.example` نائبٌ `__SET_ME__` لا قيمةٌ | مُولِّدٌ يكتبُ قيمةَ سرٍّ |
| 8 | الرَّبطُ غيرُ المباشرِ (مادّةُ مفاتيحِ الخدمةِ) مُعلَنٌ | سقوطُ المادّةِ من السجلِّ |

**والبابُ الرابعُ صِيغَ خطأً أوّلَ مرّةٍ ويُقالُ ذلكَ:** كُتبَ `secret ⇒
secret_material`، فأسقطَ كلَّ سرٍّ من نوعِ `postgres_url` — وهوَ نوعٌ صادقٌ
لمتغيّرٍ سرٍّ. صُحِّحَ إلى الاتّجاهِ الواحدِ الصادقِ: **المادّةُ السرّيّةُ
تُوجِبُ السرَّ، والسرُّ لا يُوجِبُ نوعاً**.

### 4.1 معيارانِ اثنانِ بقصدٍ (البابُ 7)

نائبُ السرِّ `__SET_ME__` **مكتوبٌ حرفاً مرّتَينِ**: في المُولِّدِ
(`config_render.py::SECRET_PLACEHOLDER`) وفي المُصادِقِ
(`config_schema_semantics.py::EXPECTED_SECRET_PLACEHOLDER`). **وهذا تكرارٌ
مقصودٌ لا سهوٌ.** ولِمَ: البابُ 3 يُثبِتُ أنَّ `.env.example` **مُشتَقٌّ من
مُولِّدِهِ**؛ فلو استوردَ البابُ 7 النائبَ من المُولِّدِ لصارَ يُصادِقُ
المُولِّدَ بالمُولِّدِ — وطفرةٌ تُغيِّرُ `SECRET_PLACEHOLDER` إلى قيمةٍ سرٍّ
حقيقيّةٍ **تمرُّ البابَينِ معاً**. وقد قِيسَ ذلكَ حرفاً في حزمةِ الطفراتِ يومَ
2026-09-16: الحالةُ «مُولِّدٌ يكتبُ قيمةَ سرٍّ بدلَ النائبِ» كانت **خضراءَ**
قبلَ فصلِ الأدبَينِ، وصارت تُسقِطُ البابَ 7 بعدَهُ. وهوَ عينُ ما فعلَهُ
[`validate-test-invocation.sh`](../../scripts/checks/validate-test-invocation.sh)
حينَ فصلَ معيارَ التسلسلِ عن مُشتَقِّ المُشغِّلِ.

### 4.2 حدودٌ مُعلَنةٌ لا مطويّةٌ

- **`packages/config/` كلُّها مُستثناةٌ من القياسِ** (`CONFIG_PACKAGE_PREFIX`):
  اختباراتُها تنادي القُرّاءَ بأسماءٍ وهميّةٍ (`"D"` · `"N"`) فتُلوِّثُ الجردَ.
  والثمنُ مُعلَنٌ: قراءةٌ خامٌّ تُدَسُّ **داخلَ حزمةِ الإعدادِ نفسِها** لا
  يراها البابُ 6.
- **الحارسُ يقرأُ نصّاً ونمطاً لا تدفُّقاً**: قراءةٌ تُبنى باسمٍ مُحتَسَبٍ زمنَ
  التشغيلِ لا يراها البابُ 1، **ولا يُدَّعى خلافُ ذلكَ**.
- **الرَّبطُ غيرُ المباشرِ مُصرَّحٌ في جدولٍ** (`INDIRECT_BINDINGS`): اليومَ
  صفٌّ واحدٌ ([`packages/service-auth/src/keys.ts`](../../packages/service-auth/src/keys.ts)
  ⇒ `WASLA_SERVICE_AUTH_KEYS` · `WASLA_SERVICE_AUTH_ACTIVE_KID`)، فكلُّ ربطٍ
  جديدٍ من هذا الصنفِ **يُكتَبُ صفّاً** أو يُسقِطُ البابَ 8.
- **البابُ 6 يمنعُ نمطاً لا يُثبِتُ صوابَ قارئٍ**: استعمالُ
  `readLenientIntEnv` حيثُ يجبُ `readIntEnv` لا يراهُ حارسٌ — يراهُ مُراجِعٌ.

---

## 5. غيابُ python3 إخفاقٌ لا تخطٍّ

[`scripts/checks/validate-config-schema.sh`](../../scripts/checks/validate-config-schema.sh)
**يُسقِطُ الدفعةَ إن لم يجدْ `python3`** ولا يُعلِنُ تخطّياً. والسببُ مقيسٌ في
هذا المستودعِ لا مُستعارٌ: البابُ الأوّلُ من حارسِ استدعاءِ الاختباراتِ كانَ
يمسحُ بـ`rg … 2>/dev/null || true`، و`rg` غيرُ مُثبَّتٍ على عاملِ GitHub، فكانَ
**يمرُّ أخضرَ على لا شيءٍ في المكانِ الوحيدِ الذي يهمُّ** ([`RISK-0040`](../07-security/RISK_REGISTER.md)).
**فالتخطّي ليس نجاحاً، وغيابُ الأداةِ عطبُ بوّابةٍ لا ظرفُ بيئةٍ.**

---

## 6. كيفَ تُضيفُ متغيّراً

1. أضِفْ صفَّهُ في `packages/config/env-registry.json` (مرتَّباً بالاسمِ).
2. اقرأْهُ في الشفرةِ بقارئٍ من `@wasla/config`، وأعلِنْ ملفَّهُ في `readers[]`.
3. `python3 scripts/config/render-config-artifacts.py` لإعادةِ تصييرِ المُشتقَّينِ.
4. `bash scripts/checks/validate-config-schema.sh` — ثمانيةُ أبوابٍ خضراءُ.
5. `bash scripts/checks/test-governance.sh` ثمَّ `bash scripts/baseline.sh --log <سجلُّ تحقُّقٍ>`.

**ولا تُحرِّرْ `.env.example` ولا `registry.generated.ts` بيدٍ** — البابُ 3
يمسكُ ذلكَ حرفاً.

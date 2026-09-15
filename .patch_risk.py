import pathlib

p = pathlib.Path("docs/07-security/RISK_REGISTER.md")
s = p.read_text(encoding="utf-8")

tail = "فيصيرَ `TOKEN_BOUND_OPERATION_COUNT` مساوياً لعددِ العملياتِ المملوكةِ المقيسِ."
assert s.count(tail) == 1, s.count(tail)

addition = (
    tail
    + " **تصحيحٌ بالإضافةِ 2026-09-15 (`M1-05B` · `CLM-0178`) — والنصُّ أعلاهُ يُترَكُ مكتوباً:**"
    " الدعوى «`token.ts` … **ولا مطلبَ فيهِ لهويّةِ الطرفِ المُنتَفِعِ**» **خاطئةٌ**."
    " القياسُ المُعادُ أثبتَ أنَّ [`packages/service-auth/src/token.ts`](../../packages/service-auth/src/token.ts)"
    " يحملُ مطلباً **اختياريّاً** اسمُهُ `obo` (`ServiceTokenPayload.obo?: string`)، يُصدَرُ بـ"
    "`MintServiceTokenOptions.onBehalfOfPublicId`، ويُفحَصُ في `decodePayload` (فراغُهُ أو نوعُهُ الخاطئُ ⇒ `invalid_claims`)،"
    " ويظهرُ في `ServicePrincipal.onBehalfOfPublicId`، ولهُ قارئٌ جاهزٌ `ownerPublicIdOf()` في"
    " [`packages/auth-sdk/src/authorize.ts`](../../packages/auth-sdk/src/authorize.ts)، ومستهلِكٌ واحدٌ يومَ القياسِ"
    " (نسبةُ تدقيقِ تعارضِ المخزونِ في `services/delivery`). **فالفجوةُ لم تكنْ «لا مطلبَ» بل «مطلبٌ اختياريٌّ لا"
    " يُلزِمُهُ أحدٌ، و`assertOwner` تجاهلَهُ وفضَّلَ ترويسةً يكتبُها المُنادي»** — وهذا يُصغِّرُ حجمَ الإصلاحِ"
    " (لا حاجةَ لتغييرِ عقدِ الرمزِ) ولا يُغيِّرُ شيئاً من وصفِ الأثرِ أعلاهُ. ويُترَكُ الخطأُ مكتوباً لأنَّهُ"
    " هوَ ما بُرِّرَ بهِ تأجيلُ الإصلاحِ في `M1-05`، فمحوُهُ يجعلُ التأجيلَ يبدو قراراً بلا سببٍ."
    " **الموجةُ الأولى مُنفَّذةٌ 2026-09-15 (البندُ 1 من ثلاثةٍ):** مسارا قراءةِ الطلبِ"
    " (`GET /orders/:orderId` · `GET /orders/:orderId/history`) صارَ كلٌّ منهما مُصنَّفاً `beneficiary: \"required\"`"
    " في [`services/orders/src/http/app.ts`](../../services/orders/src/http/app.ts)، فرمزٌ بلا `obo` يُرَدُّ **403**"
    " عندَ وسيطِ [`packages/service-auth/src/fastify.ts`](../../packages/service-auth/src/fastify.ts) قبلَ أن يَبلُغَ"
    " المُعالِجَ (`logReason: \"missing_beneficiary\"`، وسِلكُهُ مُطابِقٌ حرفاً لنقصِ الصلاحيّةِ فلا يصيرُ رمزُ الرفضِ"
    " مِسباراً للتصنيفِ)؛ والمالكُ يُقرأُ من الرمزِ لا من ترويسةٍ، والترويسةُ `X-Customer-Public-Id` بقيتْ مطلوبةً"
    " بالعقدِ وصارتْ **مُطالَبةً بالمطابقةِ** لا حَكَماً (مخالفتُها ⇒ `ORDER_NOT_FOUND` لا 403، فلا يُفصَحُ أيُّ"
    " الهويَّتَينِ المُدَّعاتَينِ تملكُ الطلبَ). و`TOKEN_BOUND_OPERATION_COUNT` صارَ **2**، والبابُ السابعُ الجديدُ في"
    " [`validate-authz-policy.sh`](../../scripts/checks/validate-authz-policy.sh) يُطابِقُ كلَّ صفٍّ `token-bound`"
    " بتصنيفِ مسارِهِ في شفرةِ الحدِّ **في الاتجاهَينِ** (دعوى بلا إنفاذٍ ⇒ إخفاقٌ · إنفاذٌ بلا إعلانٍ ⇒ إخفاقٌ)،"
    " ويرفضُ أن يكونَ العددُ رقماً مكتوباً باليدِ، ويرفضُ أن تستقيَ خدمةٌ فيها مسارٌ مربوطٌ هويّتَها من ترويسةٍ"
    " وحدَها — بخمسِ حالاتِ طفرةٍ إضافيّةٍ (25 حالةً لهذا الحارسِ · 347 في حزمةِ الحوكمةِ)، كلُّ واحدةٍ منها"
    " **تُثبِتُ بـ`assert` أنَّها طفرتْ فعلاً** قبلَ أن تُقاسَ. **ولا يُقفَلُ هذا الخطرُ بهذهِ الموجةِ**: بُعدُ"
    " المستأجرِ لا يزالُ بلا ربطٍ واحدٍ (أربعةَ عشرَ صفّاً `none`)، والبندانِ الثاني (عضويّةُ المستأجرِ في السوقِ ·"
    " أحدَ عشرَ مساراً) والثالثُ (`actorPublicId` من جسمِ الطلبِ) لم يُمَسَّا. يُقفَلُ الخطرُ حينَ تُنجَزَ الموجتانِ"
    " الباقيتانِ وتُقاسَ لكلِّ بندٍ شهادةٌ مستقلّةٌ."
)

s = s.replace(tail, addition)
p.write_text(s, encoding="utf-8")
print("RISK-0042 corrected by addition")

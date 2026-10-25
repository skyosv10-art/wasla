# CLM-0617 — إغلاقُ G-S9.10 (RQ-CMA-39) بدليلِ main

**الحجزُ:** CLM-0617 · **العنصرُ:** M0-53 · **الأساسُ:** main `22bbaa986e21d7486ba80aad00457460bb57d277` (بعدَ دمجِ #767 / CLM-0616). **وثائقُ فقط.** يُغلَقُ G-S9.10 **وحدَه**؛ **G-S9 الأمُّ تبقى مفتوحةً** وG-S9.15 مفتوحٌ. لا نسبةَ اكتمالٍ لـM0-53.

## §1 معيارُ الإغلاقِ ← الدليلُ

| المعيارُ (التفويضُ) | الدليلُ |
|---|---|
| طلبُ المعاملِ الصحيحِ في جميعِ الحالاتِ | `MyOrders.test.tsx` L31 · L71 · L94: البدءُ `?limit=5` · المرشّحُ `?status=submitted&limit=5` · إعادةُ الضبطِ `?limit=5` · `limit` = `["5"]` في كلِّ نداءٍ · المرشّحُ محفوظٌ — [CLM-0616 §3](../2026-10-18T140000Z-clm-0616-gs9-10-myorders-last-five/README.md) |
| إثباتُ حدِّ الخمسةِ من اختبارِ خدمةٍ فعليٍّ | `services/customers` `app.test.ts` L578: تطبيقُ Fastify الحقيقيُّ · 7 طلباتٍ عبرَ `POST` ← `?limit=5` = 5 أحدثُها بالترتيبِ؛ ومحوِّلُ Postgres L346 في `db-integration (customer)` ✓ |
| فحوصٌ ناجحةٌ على SHA الدمجِ | [#767](https://github.com/skyosv10-art/wasla/pull/767) دُمِجَ بالغلافِ (success=42 · failed=0 · بلا `--admin`) ← `22bbaa98` · WASLA CI على main [39141579846](https://github.com/skyosv10-art/wasla/actions/runs/39141579846) success 41/41 (منها `db-integration (customer, @wasla/customers-service)` success) · Roadmap freshness [39141579835](https://github.com/skyosv10-art/wasla/actions/runs/39141579835) success |
| توثيقُ ما بعدَ الدمجِ والنشرِ الفعليِّ | Render deploy [39141579777](https://github.com/skyosv10-art/wasla/actions/runs/39141579777) success — `verdict: PASS` · 24 خدمةً `live=22bbaa9` · [تعليقُ #767](https://github.com/skyosv10-art/wasla/pull/767#issuecomment-6251989487) |

## §2 حدودُ الدليلِ

- اختبارُ الشاشةِ بمحاكاةِ `apiClient` يُثبتُ ما ترسلُه الشاشةُ لا سلوكَ الخدمةِ؛ سلوكُ الخدمةِ من L578 وL346.
- التطبيقُ خلفَ حدٍّ مغلقٍ (`production_open=false`): النشرُ يُثبتُ أنَّ الـSHA حيٌّ على Render **لا** أنَّ الميزةَ متاحةٌ للمستخدمينَ.
- لم يتغيّرْ عقدُ الـAPI ولا قائمةُ سماحِ الحدِّ ولا `production_open`.

## §3 ما يبقى مفتوحًا

G-S9 الأمُّ: G-S9.1 · G-S9.2–G-S9.9 · G-S9.11–G-S9.14 كما في [CLM-0611](../2026-10-18T093000Z-clm-0611-gs9-customer-decomposition/README.md)، و**G-S9.15** (مرشّحُ `status` خارجَ العقدِ — قرارُ نطاقٍ).

## §4 الحوكمةُ

الفحوصُ الأربعةُ على main `22bbaa98`: exit 0، والتخطّي المعلَنُ الوحيدُ هو الفحصُ 8 (لقطةٌ مؤرَّخةٌ 2026-09-28T06:48:00Z). لا ملفَّ اختبارٍ جديدٌ.

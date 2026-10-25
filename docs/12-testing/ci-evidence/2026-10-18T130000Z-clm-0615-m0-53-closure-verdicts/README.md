# CLM-0615 — سجلُّ الإغلاقِ: أحكامُ M0-53 للشرائحِ المدموجةِ

**الحجزُ:** CLM-0615 · **العنصرُ:** M0-53 · **الأساسُ:** main `312091bb93a590b60c0cd3aac33ba0d30828a288` (بعدَ دمجِ #765 / CLM-0614). **وثائقُ فقط.**

**قاعدةُ الإغلاقِ (التفويضُ):** يُغلقُ البندُ حينَ يُدمجُ عبرَ `scripts/ops/merge-on-approved-head.sh` بلا `--admin`، وينجحُ WASLA CI على **SHA الدمجِ في main**، وتطابقُ التوكيداتُ الادّعاءَ (اختبارُ خدمةٍ حقيقيٌّ لادّعاءاتِ الـAPI والصلاحيّةِ). وبنودُ G-S7 وG-S11 وUAT-08 لا تُغلقُ إلّا بقرارٍ موثَّقٍ ودليلٍ يطابقُه. **هذا السجلُّ لا ينقلُ M0-53 إلى Completed ولا يحسبُ نسبةَ اكتمالٍ.**

## §1 الأحكامُ

| البندُ | صفوفُ السجلِّ | القرارُ الموثَّقُ | الدليلُ | PR · SHA الدمجِ | WASLA CI على main | النشرُ |
|---|---|---|---|---|---|---|
| **G-S12.7 / UAT-08** | RQ-ADM-28 | [ADR-072](../../../15-decisions/ADR-072-owner-decisions-gs7-uat08.md) D2: 405 + `Allow` | [CLM-0605](../2026-10-18T063000Z-clm-0605-uat08-audit-405/README.md) — اختبارُ خدمةٍ: الحالةُ · `Allow` · عدمُ تغيّرِ البياناتِ | [#756](https://github.com/skyosv10-art/wasla/pull/756) · `dfff119a` | [39104835597](https://github.com/skyosv10-art/wasla/actions/runs/39104835597) ✓ | PASS · 24 خدمةً |
| **G-T1** | — | لا يلزمُ (دقّةُ تسميةٍ) | [CLM-0606](../2026-10-18T070000Z-clm-0606-gt1-test-names/README.md) — الأسماءُ تطابقُ التوكيداتِ بلا إضعافٍ | [#757](https://github.com/skyosv10-art/wasla/pull/757) · `dc3ee136` | [39105670059](https://github.com/skyosv10-art/wasla/actions/runs/39105670059) ✓ | PASS · 24 |
| **G-S6** | — | لا يلزمُ (تقادمُ وثيقةٍ) | [CLM-0607](../2026-10-18T073000Z-clm-0607-gs6-negotiations-readme/README.md) — README مقابلَ المساراتِ الحيّةِ 13/13 | [#758](https://github.com/skyosv10-art/wasla/pull/758) · `dd5eb7ef` | [39106942539](https://github.com/skyosv10-art/wasla/actions/runs/39106942539) ✓ | وثائقُ — لا نشرَ |
| **G-S11** | (RQ-DMA-33 يتبعُ G-S13) | تفويضُ المالكِ المقتبَسُ في CLM-0608 السطرَ 3: «إذا تأكد أنه عقد التنفيذ المعتمد، حدّث مواصفة السائق…» — والشرطُ مَقيسٌ (§1 هناك: منشورٌ · في مصفوفةِ التفويضِ · في سجلِّ الفرضِ · مُختبَرٌ) | [CLM-0608](../2026-10-18T080000Z-clm-0608-gs11-driver-earnings-contract/README.md) — DMS §4.5/§5 حُدِّثا بإضافةٍ مؤرَّخةٍ | [#759](https://github.com/skyosv10-art/wasla/pull/759) · `98f3d0d5` | [39108150871](https://github.com/skyosv10-art/wasla/actions/runs/39108150871) ✓ | وثائقُ — لا نشرَ |
| **G-S7** | RQ-CMA-7 · RQ-CMA-54 | [ADR-072](../../../15-decisions/ADR-072-owner-decisions-gs7-uat08.md) D1: 7 عناصرَ + الأماكنُ من Profile | [CLM-0609](../2026-10-18T083000Z-clm-0609-gs7-home-seven-places-profile/README.md) — العددُ النهائيُّ · التنقّلُ · الإضافةُ · الحذفُ | [#760](https://github.com/skyosv10-art/wasla/pull/760) · `f68e6ec1` | [39109042819](https://github.com/skyosv10-art/wasla/actions/runs/39109042819) ✓ 41/41 | PASS · 24 `live=f68e6ec` |
| **G-S8** | RQ-CMA-13 · RQ-DMA-9 · RQ-DMA-12 | لا يلزمُ (تنفيذُ مواصفةٍ) | [CLM-0610](../2026-10-18T090000Z-clm-0610-gs8-session-lifecycle/README.md) — 12+3 اختبارًا مباشرًا لكلِّ تطبيقٍ · E2E | [#761](https://github.com/skyosv10-art/wasla/pull/761) · `54909efc` | [39111451154](https://github.com/skyosv10-art/wasla/actions/runs/39111451154) ✓ | PASS · 24 `live=54909ef` |
| **G-S10.1 · G-S10.2** | RQ-DMA-15 · RQ-DMA-16 · RQ-DMA-43 · RQ-DMA-44 | لا يلزمُ؛ اختلافُ `busy` (DMS L77) مقابلَ العقدِ مرفوعٌ بدليلٍ ([CLM-0613 §2](../2026-10-18T103000Z-clm-0613-gs10-driver-availability-eligibility/README.md)) | CLM-0613 — اختبارُ خدمةٍ حقيقيٌّ 7 حالاتٍ (403/404/400 · البياناتُ لم تتغيّرْ) | [#764](https://github.com/skyosv10-art/wasla/pull/764) · `e64b459f` | [39116411053](https://github.com/skyosv10-art/wasla/actions/runs/39116411053) ✓ 41/41 | PASS · 24 `live=e64b459` |
| **G-S13** | RQ-DMA-33 | لا يلزمُ (عيبُ سلوكٍ مقابلَ العقدِ المنشورِ) | [CLM-0614](../2026-10-18T110000Z-clm-0614-gs13-earnings-filter/README.md) — اختبارُ خدمةٍ حقيقيٌّ (400 · 404 أوّلًا · نوافذُ الفترةِ · الملغى) | [#765](https://github.com/skyosv10-art/wasla/pull/765) · `312091bb` | [39118635561](https://github.com/skyosv10-art/wasla/actions/runs/39118635561) ✓ 41/41 | [39118635572](https://github.com/skyosv10-art/wasla/actions/runs/39118635572): المحاولةُ 1 FAIL (`wasla-delivery` `update_failed`) · المحاولةُ 2 PASS · 24 `live=312091b` — §3 |

## §2 ما يبقى مفتوحًا (لا يُغلقُ هنا)

| البندُ | السببُ |
|---|---|
| **G-S9** (الأمُّ) وG-S9.1–G-S9.14 | تفكيكٌ لا تنفيذٌ (CLM-0611 · #762): شاشةٌ الآنَ · عقدٌ أوّلًا · مؤجَّلٌ صراحةً (WebSocket · الخريطةُ المتقدّمةُ) · قرارُ مالكٍ (G-S9.4 · قيمُ G-S9.5) |
| **G-S12** (الأمُّ) وG-S12.1–G-S12.6 | G-S12.1 قرارُ مالكٍ (ADR-069 المرحلةُ 4) يسبقُ جاهزيّةَ الباقي؛ اللوحةُ **ليستْ** جاهزةً للإنتاجِ لنجاحِ اختباراتِ الواجهةِ |
| **G-S10** (الأمُّ) · G-S10.3 · G-S10.4 | المهامُ النشطةُ بلا عقدٍ (شريحةُ عقدٍ مستقلّةٌ) · مدخلا الحدِّ رفضَهما الحارسُ 28 `[EA-SNAPSHOT-NEW]` — قرارٌ موثَّقٌ (ADR-069 §2.8) لا يُتجاوَزُ |
| G4 · G-S2 · G7 | قراراتُ مالكٍ |
| G6 | عائقُ بيئةٍ (لا Postgres محلّيٌّ) |
| #730 | HOLD (INC-0007) |

## §3 حدودُ الدليلِ

- اختباراتُ Playwright بمحاكاةِ `page.route` — ليستْ دليلَ تكاملٍ حيٍّ.
- المساراتُ الجديدةُ في الواجهاتِ خلفَ حدٍّ مغلقٍ (`production_open=false`) — النشرُ يُثبتُ أنَّ SHA حيٌّ على Render لا أنَّ الميزةَ مفتوحةٌ للمستخدمينَ.
- **نشرُ `312091bb`:** المحاولةُ الأولى أخفقتْ على `wasla-delivery` وحدَها (`update_failed`، بقيتْ على `e64b459`) والتغييرُ لا يمسُّها ولا تبعيّاتِها (orders + driver-mini-app فقط). النمطُ موثَّقٌ: مهلةُ النشرِ على خطّةِ `free` ([RENDER_PLAN_DECISION_PACK §6.1](../../../08-infrastructure/RENDER_PLAN_DECISION_PACK_2026-10-08.md) — RISK-0066 قرارُ مالكٍ) بسابقتينِ (`505e7e6d` · `6280760a`). أُعيدَ تشغيلُ المهمّةِ المثبَّتةِ بالـSHA نفسِه مرّةً واحدةً ← PASS · 24/24. المحاولةُ الأولى باقيةٌ في السجلِّ لا ممحوّةٌ؛ السببُ الجذريُّ (الخطّةُ) خارجَ صلاحيّةِ المنفِّذِ.
- الحوكمةُ: الفحوصُ الأربعةُ على الأساسِ في §4.

## §4 الحوكمةُ

الفحوصُ الأربعةُ (`validate-state-sync.sh` · `validate-work-claims.sh` · `require-doc-update.sh` · `verify-governance.sh`) على main `312091bb`: exit 0، والتخطّي المعلَنُ الوحيدُ هو الفحصُ 8 (لقطةٌ مؤرَّخةٌ 2026-09-28T06:48:00Z لا سؤالٌ حيٌّ). لا ملفَّ اختبارٍ جديدٌ ← لا إعادةَ توليدٍ للأساسِ.

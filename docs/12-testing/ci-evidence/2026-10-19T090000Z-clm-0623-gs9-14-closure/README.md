# CLM-0623 — إغلاقُ G-S9.14 بدليلِ main

**الحجزُ:** CLM-0623 · **العنصرُ:** M0-53 · **الأساسُ:** main `56e5d733` (دمجُ [#771](https://github.com/skyosv10-art/wasla/pull/771) — CLM-0621). وثائقُ فقط.

## §1 الحكمُ المقيسُ على main `56e5d733`

| الفحصُ | الدعوةُ | الحكمُ |
|---|---|---|
| WASLA CI | [39184072763](https://github.com/skyosv10-art/wasla/actions/runs/39184072763) | **success** |
| Roadmap freshness | [39184072751](https://github.com/skyosv10-art/wasla/actions/runs/39184072751) | **success** |
| Render deploy | — | لم يُطلَقْ: التغييرُ وثائقُ فقط (لا `apps/**` ولا `services/**`) — سلوكُ المستودعِ لا استثناءٌ |

على الرأسِ المدفوعِ لـ#771 (`7dd0e2e6`): 42 نجاحًا · 0 إخفاقٍ · 0 معلَّقٍ (`merge-on-approved-head.sh`).

## §2 ما أُغلقَ وما لم يُغلقْ

- **G-S9.14** مُغلقٌ: CMS §8 صارَ يسمّي `GET /stores` و`GET /stores/{storeSlug}/products` كما في العقدِ والخدمةِ والتوجيهِ والتطبيقِ ([CLM-0621](../2026-10-19T060000Z-clm-0621-gs9-14-spec-stores-path/README.md)).
- **RQ-CMA-27 بوصفِه سلوكًا للمستخدمِ لم يُغلقْ:** المسارانِ `production_open=false` في الحدِّ (`/stores` حتى G-ENF(marketplace) — قرارُ مالكٍ · `/products` حتى E-20).
- **G-S9 الأمُّ مفتوحةٌ.**

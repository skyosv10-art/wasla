# بوّابةُ M2-07 — العمّالُ والصادرُ والنبضاتُ ودفترُ الرسائلِ الميتةِ

> **العنصر:** `M2-07` · **الحجز:** `CLM-0239` · **القراراتُ:** [ADR-037](../15-decisions/ADR-037-outbox-monotonic-sequence-number.md) · [ADR-026](../15-decisions/ADR-026-store-orders-and-delivery-boundary.md) · [ADR-025](../15-decisions/ADR-025-marketplace-search-read-model.md)
>
> **السجلُّ الحاكمُ:** [`M2-07_OUTBOX_TICK_DLQ_INVENTORY.md`](../08-infrastructure/M2-07_OUTBOX_TICK_DLQ_INVENTORY.md) — ومصدرُ حقيقتِهِ الشجرةُ نفسُها (`services/*/contracts/schema.sql` · `services/*/src/**/relay.ts` · `services/*/src/**/drain*.ts`)
>
> **دليلُ الإثباتِ:** [`M2-07_CRASH_RETRY_DEDUPE_PROOF.md`](M2-07_CRASH_RETRY_DEDUPE_PROOF.md)
>
> **نموذجُ الحالاتِ:** [`STATUS_MODEL.md`](../00-rules/STATUS_MODEL.md)
>
> **Last Updated:** 2026-09-20 · **الحالةُ المُعلَنة:** `NOT PASSED` — البوّابةُ تُوثِّقُ ما قِيسَ وما يبقى، ولا تُعلنُ `M2-07` مُكتمَلًا. **ونقلُ `M2-07` إلى `Ready for Gate` أو `Completed` سلطةُ مالكِ البرنامجِ وحدَهُ** ([ROADMAP_OPERATING_PROTOCOL](../16-progress/ROADMAP_OPERATING_PROTOCOL.md) §9).

---

## 0. لماذا يوجد هذا الملف

لأنَّ مُعيارَ الإغلاقِ المُعلَنَ لـ`M2-07` («crash/retry/dedupe proof») **مُستوفى** بدليلِ `CLM-0233`،
و«تسويةُ تسلسلِ الصادرِ» **مُستوفاة** بدليلِ `CLM-0237`، ومع ذلك ظلَّ العنصرُ `In Progress` لا `Ready for Gate`
ولا `Completed` — لثلاثةِ حواجزَ موثَّقةٍ في تدقيقِ [`CLM-0238`](../16-progress/TASK_LOG.md):

1. اعتمادٌ غيرُ مُكتملٍ — `M2-02` محجوبٌ بانتظارِ اعتمادٍ خارجيٍّ.
2. فجوةٌ `High` مفتوحةٌ — `G1`: 9 من 13 جدولَ صادرٍ بلا أيِّ آليةِ توصيلٍ.
3. لا توجدُ بوّابةٌ موثَّقةٌ لهذا العنصرِ.

هذا الملفُ يَسُدُّ الحاجزَ الثالثَ، ويُوثِّقُ الحاجزَينِ الباقيَينِ بقياسٍ مُعادٍ من `main`،
فلا يُقرأُ أحدٌ أخضرَ الوصفِ ويظنُّ العنصرَ مُكتمَلًا. **والبوّابةُ ليست إثباتًا إنتاجيًّا** —
بحكمِ نموذجِ الحالاتِ، الكودُ والاختبارُ والوثيقةُ ليست إثباتًا حتى يسمحَ نموذجُ الحالةِ بذلك.

---

## 1. الحالةُ بثلاثِ طبقاتٍ قبلَ أيِّ جدولٍ

```
LOCAL      ✅ VERIFIED       — راجِعْ §2 (قياسٌ من main عند b3a6bc3: الجردُ · الإثباتُ · التسوية)
CI         ✅ VERIFIED       — main عند b3a6bc3 أخضرُ: WASLA CI 35432001351 success · 35/35
PRODUCTION ⚪ NOT VERIFIED   — لا نشرَ ولا تشغيلَ في الإنتاجِ (نطاقُ M2-02 وM2-09)
```

**والطبقةُ الثالثةُ لا تُقرَأُ خُضرةً ولا يُدَّعى ذلك.**

---

## 2. بنودُ البوّابةِ

| # | البندُ | الحالةُ | الدليلُ المقيسُ |
|---|---|---|---|
| 1 | جردُ outbox/tick/DLQ مكتملٌ ومُقاسٌ من الشجرةِ | ✅ | [`M2-07_OUTBOX_TICK_DLQ_INVENTORY.md`](../08-infrastructure/M2-07_OUTBOX_TICK_DLQ_INVENTORY.md) · `CLM-0231` · 13 جدولَ صادرٍ · 3 مستهلِكاتِ relay · 3 نبضاتٍ · 8 جداولِ تماثُلٍ · دورةُ حياةِ DLQ في `delivery` وحدَها |
| 2 | crash/retry/dedupe proof — معيارُ الإغلاقِ المُعلَنُ | ✅ | [`M2-07_CRASH_RETRY_DEDUPE_PROOF.md`](M2-07_CRASH_RETRY_DEDUPE_PROOF.md) · `CLM-0233` · 3 اختباراتِ تكاملٍ في `relay-concurrent-dedupe.integration.test.ts`: تماثُلُ نسختَينِ مع `SKIP LOCKED` · تعافٍ من انهيارٍ منتصفَ الدفعةِ · فرضُ التماثُلِ بقيدِ `UNIQUE` |
| 3 | تسويةُ تسلسلِ الصادرِ — فجوةُ G2 | ✅ | `CLM-0237` · PR #279 · squash `a08645f` · `delivery_outbox` على `outbox_id` · والـ5 الأخرى (customer/driver/geo/identity/search) على `id` بدلَ `occurred_at` · 5 ترحيلاتٍ مولَّدةٍ + 5 اختباراتِ schema-drift |
| 4 | اختبارُ الترقيةِ على قاعدةٍ فيها صفوفٌ | ✅ | `M2-07_CRASH_RETRY_DEDUPE_PROOF.md` يربطُ 5 متطلباتٍ بـ51 اختبارَ relay + 73 اختبارَ نبضةٍ |
| 5 | صحةُ الجردِ مُعادَةُ القياسِ من main | ✅ | `CLM-0238` · أربعةُ أخطاءٍ قياسيّةٍ صُحِّحَت بالإضافةِ لا بالمحوِ: G1 (8→9، أُسقِطَ negotiations/search/delivery) · G3 (5→10، أُسقِطَ dispatch) · G4 (5→6، أُسقِطَ identity) · G6 (تناقضٌ ذاتيٌّ → 3 من 8) |
| 6 | وجودُ بوّابةٍ موثَّقةٍ لهذا العنصرِ | ✅ | هذا الملفُ (`CLM-0239`) — كانَ مفقودًا (موجودٌ لـM2-01 وM2-04 وحدَهما) · صارَ موجودًا |
| 7 | اعتمادُ M2-02 مُكتملٌ | ⛔ | **محجوبٌ** — `M2-02` `In Progress` بحاجزِ `RENDER_API_KEY`/`RENDER_OWNER_ID` خارجيٍّ · بروتوكولُ التشغيلِ §4 يمنعُ إكمالَ تابعٍ اعتمادُهُ غيرُ `Completed` |
| 8 | فجوةُ G1 — آليةُ توصيلٍ لكلِّ جدولِ صادرٍ | ⛔ | **مفتوحةٌ High** — 9 من 13: customers · delivery · drivers · geography · identity · matching · negotiations · orders · search. الأربعةُ التي لديها آليةٌ: reputation (drain) · subscriptions (drain) · dispatch (relay في delivery) · marketplace (relay ×2) |
| 9 | دورةُ حياةِ DLQ كاملةٌ لكلِّ مستهلِكِ relay | ⚠️ | `delivery` لديها الدورةُ كاملةً (§4.23–4.27) لكن بلا إثباتِ تكاملٍ نهايةً إلى نهايةٍ · `search` بلا دورةِ حياةٍ إطلاقًا (G5) |
| 10 | حكمُ CI أخضرُ على الدفعةِ | ✅ | main `b3a6bc3`: [WASLA CI 35432001351](https://github.com/skyosv10-art/wasla/actions/runs/35432001351) success · 35/35 |

---

## 3. الحواجزُ الثلاثةُ الموثَّقةُ في CLM-0238 — وحالتُها الآن

> تدقيقُ `CLM-0238` (الذي أُجرِيَ على `main` عند `596d415` لا على تقاريرَ) أعلنَ ثلاثةَ حواجزَ
> تمنعُ نقلَ `M2-07` إلى `Completed` أو `Ready for Gate`. هذا القسمُ يُحدِّثُ حالتَها.

### 3.1 الحاجزُ الأولُ — اعتمادُ M2-02 غيرُ مُكتملٍ

**يبقى مفتوحًا.** `M2-02` `In Progress` بحاجزٍ خارجيٍّ مُوثَّقٍ:
`RENDER_API_KEY`/`RENDER_OWNER_ID` غيرُ مُتاحَينِ من البيئةِ، فيقفُ `terraform plan`/`apply`
الحقيقيُّ. وبروتوكولُ التشغيلِ §4 يمنعُ إكمالَ تابعٍ اعتمادُهُ غيرُ `Completed`. هذا الحاجزُ
خارجُ نطاقِ هذه البوّابةِ — لا يُحلُّ بكودٍ بل باعتمادٍ خارجيٍّ يملكُهُ مالكُ البرنامجِ.

### 3.2 الحاجزُ الثاني — فجوةُ G1 مفتوحةٌ High

**يبقى مفتوحًا.** 9 من 13 جدولَ صادرٍ بلا أيِّ آليةِ توصيلٍ: أحداثٌ تُكتبُ ولا تُسلَّمُ.
التفصيلُ والقياسُ في [`M2-07_OUTBOX_TICK_DLQ_INVENTORY.md`](../08-infrastructure/M2-07_OUTBOX_TICK_DLQ_INVENTORY.md) §10.

**هذا هو البندُ التنفيذيُّ التالي الأكثرُ أولويّةً بعد هذه البوّابةِ**، لكنه يحتاجُ:
- **ADR/تصميمٍ مُعمَّقٍ** لأنه يمسُّ 9 خدماتٍ ولا يجوزُ تكرارُ آلياتِ relay/drain دون قرارٍ
  يمنعُ تضارُبَ المصادرِ.
- **حجزًا مستقلًّا** بنطاقٍ يشملُ `services/` المتأثرةَ و`docs/15-decisions/`.
- **لا يُبدأُ في هذا الفرعِ.**

### 3.3 الحاجزُ الثالثُ — لا توجدُ بوّابةٌ موثَّقةٌ

**سُدَّ بهذه البوّابةِ.** كانَ موجودًا لـ`M2-01` و`M2-04` وحدَهما؛ صارَ `M2-07_GATE.md`
موجودًا بهذا الفرعِ (`CLM-0239`).

---

## 4. ما لا يُدَّعى — حدودُ صريحةٌ

- **البوّابةُ ليست إثباتًا إنتاجيًّا.** `PRODUCTION ⚪ NOT VERIFIED`.
- **`M2-07` لا يُنقَلُ إلى `Completed`.** بروتوكولُ التشغيلِ §9 يمنعُ الوكيلَ الآليَّ من ذلك،
  والحاجزانِ الأولُ والثاني مفتوحانِ.
- **اختبارُ `search` relay crash/retry غيرُ موجودٍ.** الإثباتُ في `delivery` وحدَه (G5).
- **`G1` لا يُحلُّ بـ«إضافةُ drain لكلِّ خدمةٍ» دون تصميمٍ.** تكرارُ الآلياتِ بلا قرارٍ
  معماريٍّ يخلقُ مصادرَ حقيقةٍ مكررةً — وهو عينُ ما يرفضهُ ADR-017.
- **الأخضرُ المحليُّ ليس بديلًا عن حكمِ CI.** حكمُ CI على `main` عند `b3a6bc3` أخضرُ
  (35432001351) — لكنَّ هذا لا يعني أنَّ أيَّ دفعةٍ قادمةٍ ستكونُ خضراءَ حتى تُقاسَ.

---

## 5. الخطوةُ التاليةُ الذرّيةُ

1. **مالكُ البرنامجِ** يقرأُ هذه البوّابةَ ويقررُ: هل يُنقَلُ `M2-07` إلى `Ready for Gate`
   رغمَ الحاجزَينِ المفتوحَينِ (وهو قرارٌ مكتوبٌ لا تلقائيٌّ)، أم يبقى `In Progress`؟
2. **إن بقيَ `In Progress`**: البندُ التنفيذيُّ التالي هو **معالجةُ `G1`** — بافتتاحِ ADRٍ
   وتصميمٍ وحجزٍ مستقلٍّ. لا يُبدأُ به في هذا الفرعِ.
3. **إن نُقِلَ `Ready for Gate`**: حكمُ CI الأخضرُ على هذه الدفعةِ شرطٌ، لا الإثباتُ المحليُّ.

---

## 6. المراجعُ

- [`M2-07_OUTBOX_TICK_DLQ_INVENTORY.md`](../08-infrastructure/M2-07_OUTBOX_TICK_DLQ_INVENTORY.md) — الجردُ الكاملُ والفجواتُ السبعُ
- [`M2-07_CRASH_RETRY_DEDUPE_PROOF.md`](M2-07_CRASH_RETRY_DEDUPE_PROOF.md) — إثباتُ crash/retry/dedupe
- [`LAUNCH_EXECUTION_BOARD.md`](../16-progress/LAUNCH_EXECUTION_BOARD.md) صفُّ `M2-07`
- [`TASK_LOG.md`](../16-progress/TASK_LOG.md) إدخالاتُ `CLM-0231`/`0233`/`0237`/`0238`/`0239`
- [ADR-037](../15-decisions/ADR-037-outbox-monotonic-sequence-number.md) · [ADR-026](../15-decisions/ADR-026-store-orders-and-delivery-boundary.md) · [ADR-025](../15-decisions/ADR-025-marketplace-search-read-model.md) · [ADR-017](../15-decisions/ADR-017-unified-roadmap-governance-and-work-claim-system.md)

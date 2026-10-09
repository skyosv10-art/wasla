# CLM-0516 — أحكام ما بعد الدمج: CLM-0514 (#672) وCLM-0515 (#673)

- **Work Item(s):** M6-18B · M2-01
- **Author/Owner:** @skyosv10-art (agent:perplexity-computer)
- **Date:** 2026-10-09
- **Risk(s):** RISK-0060 → closed (لا تغيير) · RISK-0050 → open (لا تغيير)

## 1. CLM-0514 / PR #672 — RISK-0060 مغلق (d8f3815e)

- **الدمج:** 2026-10-09T09:48:09Z، squash `d8f3815e`.
- **حكم CI على main:** WASLA CI [37913607058](https://github.com/skyosv10-art/wasla/actions/runs/37913607058) **فشل** في `image-supply-chain` (كل الوظائف الأخرى نجحت) — سبب جذري خارجي زمني: CVEs نُشرت 2026-10-08 (CVE-2026-78667/CVE-2026-97031) في ثنائي esbuild؛ PR كان أخضر وقت مراجعته لأن قاعدة trivy تُحدَّث وقت المسح. **عولج جذريًا في CLM-0515.**
- **Roadmap freshness:** نجح [37913606968](https://github.com/skyosv10-art/wasla/actions/runs/37913606968).
- **Render deploy:** لم يُطلق عمدًا (paths-ignore للتغييرات التوثيقية فقط) — الإنتاج بلا تغيير (لا كود).
- **خلاصة RISK-0060:** حكم المسبار 37879172647 (PLAINTEXT_REFUSED_DELIBERATE) موثق في دليل CLM-0514 المدمج؛ الخطر مغلق وفق شرطه المكتوب.

## 2. CLM-0515 / PR #673 — استثناء محروس للـ CVEs الجديدة (34a71520)

- **الدمج:** 2026-10-09T10:50:26Z، squash `34a71520`.
- **حكم CI على main:** WASLA CI [37920057004](https://github.com/skyosv10-art/wasla/actions/runs/37920057004) **نجح** (و`image-supply-chain` عادت خضراء — الاستثناء المحروس يعمل) · Roadmap freshness [37920057075](https://github.com/skyosv10-art/wasla/actions/runs/37920057075) **نجح**.
- **ملاحظة مسار CI:** أول دفعة للـ PR فشلت في governance-guard/verify (فحص STATE-SYNC: صف M2-01 في اللوحة لم يُحدَّث) — أصلح بجذرها (إضافة تحديث CLM-0515 إلى صف M2-01)؛ الحكمان الأحمران للشوط الأول يبقيان مقروءين ولا يُمحيان.

## 3. حالة الإنتاج

بلا تغيير إنتاجي في الحجزين (docs/governance فقط) — الإنتاج ما زال يعمل كود `59bea99b` (آخر نشر Render ناجح: [37869185543](https://github.com/skyosv10-art/wasla/actions/runs/37869185543)، PASS 24/24).

## 4. ما لا يُدَّعى

- استثناء الفئة (esbuild CVEs) لا يعني إصلاحًا — الثغرات مقيستان ومنشورتان وغير معالَجتين؛ المهلة تعض 2026-12-15.
- RISK-0050 يظل مفتوحًا حتى العلاج الجذري (M2-02 · RISK-0047) أو إصدار esbuild بـ Go ≥ 1.26.9.

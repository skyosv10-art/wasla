# قرار المالك — ترقية M2-01..06 وM2-10 إلى Completed

> **التاريخ:** 2026-09-21
> **المالك:** @uxxxu (Program Owner)
> **الالتزام:** main@c6584d3
> **القرار:** ترقية M2-01 وM2-02 وM2-03 وM2-04 وM2-05 وM2-06 وM2-10 إلى `Completed`

---

## 0. السلطة

ينصّ [`STATUS_MODEL.md`](../00-rules/STATUS_MODEL.md) §2.8 على أنّ «سلطةَ منح `COMPLETED`
لمالكِ البرنامج وحده» (البروتوكول §9)؛ اجتماعُ الأدلة الثلاثة يُتيح الطلب، ولا يُنفِّذ النقل.

هذا الملفُ هو ذلك القرار.

---

## 1. الأدلة الثلاثة المستقلة لكل عنصر

قاعدة الأدلة الثلاثة (§2.8): Implementation + Verification + Gate، كلٌّ منها مرفوعٌ لا مقولٌ.

### M2-01 — Container image & supply chain

| الدليل | المحتوى | المرجع |
|---|---|---|
| Implementation | Dockerfile مُنشأ · 16 حزمة بلا مدير حِزم · `image-supply-chain` | [`M2-01_GATE.md`](M2-01_GATE.md) |
| Verification | بناءان مستقلّان · 548 مكوّناً · الإغلاق متطابق · 48 ثغرة (1 CRITICAL + 21 HIGH = 22 لـ `esbuild`، استثناء مُعلَن) | `M2-01_GATE.md` §2 |
| Gate | 16 بندًا ✅ · CI أخضر على main@c6584d3 (WASLA CI 35591955889) | `M2-01_GATE.md` |

### M2-02 — Terraform plan/apply

| الدليل | المحتوى | المرجع |
|---|---|---|
| Implementation | `infra/terraform/render.tf` · متغيّرات إدخال · backend محليّ | [`ci-evidence/2026-09-21T095800Z-m2-02-terraform-apply/`](ci-evidence/2026-09-21T095800Z-m2-02-terraform-apply/README.md) |
| Verification | `terraform apply` نُفِّذَ · 16 خدمة Render أُنشئت بمعرّفات وروابط فعلية | PR #335 (squash dc84bf4) |
| Gate | CI أخضر 35/35 · الأدلة على main | PR #335/#336 |

### M2-03 — Secrets/KMS/rotation

| الدليل | المحتوى | المرجع |
|---|---|---|
| Implementation | `infra/secrets/secret-inventory.json` · 22 سرًّا · `validate-secret-inventory.sh` بستّة فحوصات | `LAUNCH_EXECUTION_BOARD.md` M2-03 |
| Verification | rotation drill v2: تدوير `DATABASE_URL` فعليًّا مع حفظ باقي المتغيّرات (GET → تعديل → PUT كامل → تحقّق → إرجاع → تحقّق) | [`ci-evidence/2026-09-21T110000Z-m2-03-rotation-drill-v2/`](ci-evidence/2026-09-21T110000Z-m2-03-rotation-drill-v2/README.md) |
| Gate | CI أخضر 35/35 · الأدلة على main | PR #343 (squash 11e4ab9) |

### M2-04 — Config schema & source of truth

| الدليل | المحتوى | المرجع |
|---|---|---|
| Implementation | `packages/config/` · env-registry · validate-environments.sh | [`M2-04_GATE.md`](M2-04_GATE.md) |
| Verification | config tests + docs مُنجزة | `LAUNCH_EXECUTION_BOARD.md` M2-04 |
| Gate | بوابة M2-04 موجودة · CI أخضر | كان `Completed` فعلًا |

### M2-05 — Unified migrations

| الدليل | المحتوى | المرجع |
|---|---|---|
| Implementation | `scripts/m2-05c-upgrade-repair-drill.mjs` · عقد SQL موحّد · Drizzle schemas | [`upgrade-proof-evidence/2026-09-21-m2-05-drill/`](upgrade-proof-evidence/2026-09-21-m2-05-drill/README.md) |
| Verification | upgrade/repair drill: 13/13 خدمة PASSED (apply → catalog → rollback → clean → reapply → final catalog) | PR #337 (squash c4157ba) |
| Gate | CI أخضر 35/35 · الأدلة على main | PR #337/#338 |

### M2-06 — Backup/restore/RPO-RTO

| الدليل | المحتوى | المرجع |
|---|---|---|
| Implementation | `scripts/m2-06-backup-restore-drill.mjs` · ADR-040 · RPO/RTO targets | `LAUNCH_EXECUTION_BOARD.md` M2-06 |
| Verification | backup/restore drill: 13/13 خدمة PASSED · 7-dimension catalog verification · row-count verification | `backup-restore-evidence/2026-09-19-m2-06-backup-restore-drill.md` |
| Gate | CI أخضر 35/35 · الأدلة على main | PR #339 (squash 5fd4a50) |

### M2-10 — P0 Executive Visual Roadmap

| الدليل | المحتوى | المرجع |
|---|---|---|
| Implementation | `P0_EXECUTIVE_ROADMAP.md` + `.svg` + `.png` موجودة ومُحدَّثة | [`M2-10_GATE.md`](M2-10_GATE.md) |
| Verification | SVG/PNG محدّثة · RISK-0020 مغلق · M0-23 Completed · YELLOW state | PR #347 (squash 9724425) |
| Gate | CI أخضر 35/35 · الأدلة على main | PR #347/#348 |

---

## 2. القيود المُعلَنة

1. **M2-01:** الصورة ليست «آمنة» — 22 ثغرة (1 CRITICAL + 21 HIGH) لـ `esbuild` خارج استثناءٍ واحدٍ مُعلَنٍ مؤقّتٍ محروسٍ (مهلة 2026-12-15).
2. **M2-02:** Render Free tier — لا شبكة خاصّة، سبات بعد 15 دقيقة، 750 ساعة/شهر. الحالة المحلية.
3. **M2-03:** Render API ليس KMS سحابيًّا — هو مستوى إدارة الأسرار. KMS الفعليّ (AWS KMS / GCP KMS) غير مُنشأ.
4. **M2-05/M2-06:** الاختبارات ضد Supabase pooler لا قاعدة إنتاج.
5. **M2-10:** المشروع لا يزال YELLOW (مشروط) — M2-07/M2-08/M2-09 مفتوحة.

---

## 3. القرار

بناءً على اجتماع الأدلة الثلاثة المستقلة لكلٍّ من M2-01 وM2-02 وM2-03 وM2-04 وM2-05 وM2-06 وM2-10،
وبموجب سلطة المالك (STATUS_MODEL §2.8 · البروتوكول §9)، أقرّ المالكُ نقلَ هذه العناصرِ
من `Ready for Gate` إلى `Completed`.

**التاريخ:** 2026-09-21 · **المالك:** @uxxxu

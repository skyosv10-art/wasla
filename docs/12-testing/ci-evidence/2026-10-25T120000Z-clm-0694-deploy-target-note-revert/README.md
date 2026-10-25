# CLM-0694 — استرجاعُ حقلِ `note` لبندِ T1 في `deploy-target.json` إلى نصّهِ الأصليِّ

**التاريخ:** 2026-10-25 · **البند:** M0-53 (G-S9.7 · T1) · **الفرع:** `fix/clm-0694-deploy-target-note-revert` · **الأساس:** `main` عندَ `9ef059d8abade9a836f10455ec730d71cb820a62`.

## ما تغيّر

| الوحدة | التغيير |
| --- | --- |
| `infra/render/deploy-target.json` | حقلُ `note` لبندِ T1 استُرجعَ إلى نصّهِ الأصليِّ (ما قبلَ #837) **حرفيًّا** — فرقُ الملفِّ سطرٌ واحدٌ (`raw/deploy-target-note.diff`). تعديلُهُ في CLM-0691 كان تجاوزَ نطاقٍ (توجيهُ المالكِ 2026-10-25: «لا تغيّر deploy-target.json») |
| `docs/08-infrastructure/RENDER_TEST_ENVIRONMENT_PLAN.md` | تصحيحٌ مؤرَّخٌ: تقادمُ الحقلِ الأصليِّ يُوثَّقُ **هنا** لا في الحقلِ — الحقلُ الأصليُّ يقولُ «غيرُ موصولٍ وقائمةٌ مفقودةٌ» والقياسُ (الحارسُ 29 · CLM-0691/0693) يُثبتُ العكسَ؛ لوحةُ الحالةِ هي الخطةُ لا `note` |

## النتائجُ المحليّة (ليست CI — السجلّاتُ في `raw/`)

| الفحص | النتيجة | السجلّ |
| --- | --- | --- |
| `validate-render-deploy-target.sh` | ✓ 42/42 (بعدَ الاسترجاعِ) | `raw/validate-render-deploy-target.log` |
| فرقُ `deploy-target.json` | سطرٌ واحدٌ — الحقلُ وحدَهُ | `raw/deploy-target-note.diff` |

## ما لم يتغيّر

`mode=frozen` · `approved=false` + `approval=null` · `isolation_evidence=null` · `production_database_refs` · كلُّ حقولِ القرارِ — استرجاعُ نصٍّ فحسب، بلا أيِّ أثرٍ حيٍّ (Render مجمَّدٌ · `production_open=false` · NO-GO).

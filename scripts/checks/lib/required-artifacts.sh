#!/usr/bin/env bash
# required-artifacts.sh — مصدرٌ واحدٌ لقوائمِ «ما يجب أن يوجدَ في المستودع». (M0-04)
#
# ── لماذا يوجد هذا الملف ───────────────────────────────────────────────
# كانت القائمةُ مكتوبةً **مرَّتَين بقائمتَين مختلفتَين**، ولا واحدةَ منهما مرجعٌ:
#
#   • كتلةٌ مضمَّنةٌ داخلَ وظيفةِ `repo-structure` في `.gitlab-ci.yml` تُلزم
#     19 ملفاً و7 أدلّةٍ — ولا يمكن تشغيلُها محلّياً إطلاقاً (شِفرةٌ في YAML).
#   • `REQUIRED_DOCS` في `verify-governance.sh` تُلزم 11 وثيقةً.
#
# والفرقُ المقيسُ بينهما 12 عنصراً: CI لا يُلزم `docs/00-rules/TESTING_RULES.md`
# ولا `docs/16-progress/TASK_LOG.md`، والبوّابةُ لا تُلزم `README.md` ولا `CODEOWNERS`
# ولا `SECURITY.md` ولا `.gitignore` ولا `GIT_RULES.md` ولا `SECURITY_RULES.md` ولا
# `ENGINEERING_DOCUMENTATION_LAW.md` ولا `MASTER_PROGRESS.md` ولا `ADR-001`.
# فمَن شغّل البوّابةَ محلّياً ونجحت لم يكن يعلم أنّ CI يُلزمه بعشرةٍ لم تُفحَص،
# ومَن حذفَ `TASK_LOG.md` مرَّ من CI. وكلُّ قائمةٍ **صحيحةٌ وحدَها**، والفرقُ لا
# يُكتشف بالقراءةِ بل بالمقارنةِ — وهو عينُ درسِ M0-12/M0-13/M0-15.
#
# والعلاجُ هنا **مصدرٌ واحدٌ لا حارسُ تطابقٍ لنسختَين**، إعمالاً لسابقةِ
# `lib/meaningful-paths.sh` (M0-15): الحارسُ يكشف الانحرافَ بعدَ وقوعِه،
# والمصدرُ الواحدُ يمنع وقوعَه.
#
# ── الاستخدام ─────────────────────────────────────────────────────────
#   source "$(dirname "$0")/lib/required-artifacts.sh"     # من scripts/checks/
#   "${REQUIRED_ROOT_FILES[@]}" "${REQUIRED_DIRS[@]}" "${REQUIRED_DOCS[@]}"
#   "${REQUIRED_ALL_FILES[@]}"   → الملفّاتُ كلُّها (جذرٌ + وثائق)
#
# لا `set -e` ولا `exit` هنا: يُستدعى بـsource داخلَ سكربتاتٍ لها إعدادُها.
# المرجع: docs/00-rules/VERIFY_COMMAND.md §2

# ملفّاتُ الجذرِ الإلزاميّة.
REQUIRED_ROOT_FILES=(
  "README.md"
  "CONTRIBUTING.md"
  "SECURITY.md"
  "CODEOWNERS"
  ".gitignore"
)

# أدلّةُ المستودعِ الأساسيّة.
REQUIRED_DIRS=(
  "apps"
  "bots"
  "services"
  "packages"
  "infra"
  "scripts"
  "docs"
)

# الوثائقُ الحاكمةُ الإلزاميّة — قوانينُ وسجلاتٌ وقرارٌ مِعْماريٌّ أوّل.
# كلُّ ما تُلزمه البوّابةُ محلّياً تُلزمه CI، والعكسُ — لأنّ القائمةَ واحدة.
REQUIRED_DOCS=(
  "docs/00-rules/ENGINEERING_DOCUMENTATION_LAW.md"
  "docs/00-rules/DEFINITION_OF_DONE.md"
  "docs/00-rules/GIT_RULES.md"
  "docs/00-rules/SECURITY_RULES.md"
  "docs/00-rules/WORK_CLAIM_RULE.md"
  "docs/00-rules/PUSH_DOCUMENTATION_RULE.md"
  "docs/00-rules/TESTING_RULES.md"
  "docs/00-rules/VERIFY_COMMAND.md"
  "docs/15-decisions/ADR-001-identity-decoupled-from-telegram.md"
  "docs/16-progress/README.md"
  "docs/16-progress/MASTER_PROGRESS.md"
  "docs/16-progress/LAUNCH_TO_100_ROADMAP.md"
  "docs/16-progress/LAUNCH_EXECUTION_BOARD.md"
  "docs/16-progress/ROADMAP_OPERATING_PROTOCOL.md"
  "docs/16-progress/WORK_CLAIMS.md"
  "docs/16-progress/WORK_INDEX.md"
  "docs/16-progress/TASK_LOG.md"
)

# الاتّحادُ — يُشتقُّ ولا يُكتب ثانيةً.
REQUIRED_ALL_FILES=("${REQUIRED_ROOT_FILES[@]}" "${REQUIRED_DOCS[@]}")

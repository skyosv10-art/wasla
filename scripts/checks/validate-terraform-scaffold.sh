#!/usr/bin/env bash
# validate-terraform-scaffold.sh — تحقّقٌ بنيويٌّ من هيكلِ Terraform
#
# ما يفحص:
#   1. الملفّاتُ الإلزاميّةُ موجودةٌ (versions.tf, variables.tf, outputs.tf, backend.tf)
#   2. كلُّ بيئةٍ لها main.tf و terraform.tfvars.example
#   3. لا ملفّاتِ .tfvars حقيقيّةٍ (لا أسرارٍ ملتزَمةٍ)
#   4. terraform fmt -check (إن وُجدَ binary)
#   5. terraform validate (إن وُجدَ binary)
#
# هذا حارسٌ بنيويٌّ — لا يُثبتُ «fresh plan/apply». يسجّلُ صراحةً أنّ
# التطبيقَ الحيَّ محجوبٌ حتى توافرِ بياناتِ اعتمادِ مزوّدِ السحابةِ.
#
# المرجع: ADR-038 · M2-02B

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TF_DIR="$ROOT/infra/terraform"

GRN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RST=$'\033[0m'
ERRORS=()

# ── 1. الملفّاتُ الإلزاميّة ──────────────────────────────────────────────
REQUIRED_FILES=(
  "versions.tf"
  "variables.tf"
  "outputs.tf"
  "backend.tf"
  "README.md"
)

for f in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "$TF_DIR/$f" ]]; then
    ERRORS+=("ملفٌّ ناقصٌ: infra/terraform/$f")
  fi
done

# ── 2. البيئاتُ ──────────────────────────────────────────────────────────
ENVIRONMENTS=("development" "staging" "production")

for env in "${ENVIRONMENTS[@]}"; do
  env_dir="$TF_DIR/environments/$env"
  if [[ ! -d "$env_dir" ]]; then
    ERRORS+=("دليلُ بيئةٍ ناقصٌ: infra/terraform/environments/$env/")
    continue
  fi
  if [[ ! -f "$env_dir/main.tf" ]]; then
    ERRORS+=("ملفٌّ ناقصٌ: infra/terraform/environments/$env/main.tf")
  fi
  if [[ ! -f "$env_dir/terraform.tfvars.example" ]]; then
    ERRORS+=("ملفٌّ ناقصٌ: infra/terraform/environments/$env/terraform.tfvars.example")
  fi
done

# ── 3. لا ملفّاتِ .tfvars حقيقيّةٍ (لا أسرارٍ ملتزَمةٍ) ─────────────────────
while IFS= read -r -d '' f; do
  ERRORS+=("ملفُّ .tfvars ملتزَمٌ — استخدم .tfvars.example فقط: ${f#$ROOT/}")
done < <(find "$TF_DIR" -name "*.tfvars" -not -name "*.tfvars.example" -print0 2>/dev/null)

# ── 4. لا أسرارٍ في ملفّاتِ .tf و .tfvars.example ─────────────────────────
# ابحث عن أنماطِ سرٍّ شائعةٍ في ملفّاتِ .tf و .tfvars.example
# ملاحظة: أسبقيةُ find تتطلّبُ أقواساً — `-name A -o -name B -print0`
# تُطبّقُ `-print0` على الفرعِ الثاني فقط. الأقواسُ تُصلحُ ذلك.
SECRET_PATTERNS=(
  "sbp_[a-z0-9]{40}"               # Supabase service-role token (pattern: sbp_ + 40 alphanum)
  "postgres://[^[:space:]]*@"    # Postgres connection string with credentials
  "postgresql://[^[:space:]]*@"   # PostgreSQL connection string (Supabase form)
  "BEGIN.*PRIVATE KEY"            # Private key blocks
)

while IFS= read -r -d '' f; do
  for pattern in "${SECRET_PATTERNS[@]}"; do
    if grep -qE "$pattern" "$f" 2>/dev/null; then
      ERRORS+=("نمطُ سرٍّ مشتبهٌ به في ${f#$ROOT/}")
    fi
  done
done < <(find "$TF_DIR" \( -name "*.tf" -o -name "*.tfvars.example" \) -print0 2>/dev/null)

# ── 5. terraform fmt -check و validate (إن وُجدَ binary) ─────────────────
if command -v terraform &>/dev/null; then
  echo "${DIM}— terraform found, running fmt -check and validate —${RST}"

  # fmt -check
  if ! terraform -chdir="$TF_DIR" fmt -check 2>/dev/null; then
    ERRORS+=("terraform fmt -check فشلَ — شغّل: terraform -chdir=infra/terraform fmt")
  fi

  # validate (requires init — skip if no providers configured)
  if terraform -chdir="$TF_DIR" init -backend=false 2>/dev/null; then
    if ! terraform -chdir="$TF_DIR" validate 2>/dev/null; then
      ERRORS+=("terraform validate فشلَ")
    fi
  fi
else
  echo "${DIM}— terraform binary غير متوفّرٍ — التحقّقُ البنيويُّ فقط —${RST}"
fi

# ── النتيجة ──────────────────────────────────────────────────────────────
if ((${#ERRORS[@]})); then
  echo ""
  echo "${RED}فشلَ التحقّقُ البنيويُّ من Terraform:${RST}"
  for e in "${ERRORS[@]}"; do
    echo "  ${RED}✗${RST} $e"
  done
  echo ""
  exit 1
fi

echo ""
echo "${GRN}✓ التحقّقُ البنيويُّ من Terraform ناجحٌ${RST}"
echo "${DIM}  ملاحظة: هذا تحقّقٌ بنيويٌّ فقط — لا يُثبتُ fresh plan/apply.${RST}"
echo "${DIM}  التطبيقُ الحيُّ محجوبٌ حتى توافرِ بياناتِ اعتمادِ مزوّدِ السحابةِ (ADR-038).${RST}"
echo ""
exit 0

#!/usr/bin/env bash
# validate-environments.sh — تحقّقٌ من كتالوجِ البيئاتِ (M2-02C)
#
# ما يفحص:
#   1. وجودُ خمسِ بيئاتٍ: local, ci, development, staging, production
#   2. كلُّ بيئةٍ لها environment.json بصورةٍ صحيحةٍ
#   3. اسمُ البيئةِ يطابقُ اسمَ الدليلِ
#   4. staging/production: allow_in_memory_fallback = false
#   5. staging/production: database_mode لا يكون in_memory أو local_postgres
#   6. required_secrets موجودةٌ في env-registry.json أو هي أسرارٌ معلَّقةٌ (M2-03)
#   7. لا ملفّاتِ .env حقيقيّةٍ أو أنماطِ سرٍّ
#
# المرجع: ADR-038 · M2-02C · M2-04 (env-registry.json)

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ENV_DIR="$ROOT/infra/environments"
REGISTRY="$ROOT/packages/config/env-registry.json"

GRN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RST=$'\033[0m'
ERRORS=()

REQUIRED_ENVS=("local" "ci" "development" "staging" "production")
REQUIRED_FIELDS=("name" "purpose" "tier" "database_mode" "allow_in_memory_fallback" "required_secrets")
ALLOWED_DB_MODES=("local_postgres" "in_memory" "supabase_managed")
ALLOWED_TLS=("none" "required_blocked")
ALLOWED_DNS=("none" "required_blocked")
# M2-03 pending secret names not in env-registry.json
M2_03_PENDING_SECRETS=("KMS_KEY_ID" "KMS_KEY_ARN" "TLS_CERTIFICATE_ARN" "TLS_PRIVATE_KEY_ARN" "DNS_API_TOKEN")

# ── 1. التحققُ من وجودِ البيئاتِ ─────────────────────────────────────────
for env in "${REQUIRED_ENVS[@]}"; do
  if [[ ! -d "$ENV_DIR/$env" ]]; then
    ERRORS+=("دليلُ بيئةٍ ناقصٌ: infra/environments/$env/")
    continue
  fi
  manifest="$ENV_DIR/$env/environment.json"
  if [[ ! -f "$manifest" ]]; then
    ERRORS+=("ملفٌّ ناقصٌ: infra/environments/$env/environment.json")
    continue
  fi

  # ── 2. تحقّقٌ من صحةِ JSON ─────────────────────────────────────────────
  if ! python3 -c "import json; json.load(open('$manifest'))" 2>/dev/null; then
    ERRORS+=("JSON غيرُ صالحٍ: infra/environments/$env/environment.json")
    continue
  fi

  # ── 3. الحقولُ الإلزاميّة ───────────────────────────────────────────────
  for field in "${REQUIRED_FIELDS[@]}"; do
    val=$(python3 -c "import json; d=json.load(open('$manifest')); print(d.get('$field', '__MISSING__'))" 2>/dev/null)
    if [[ "$val" == "__MISSING__" ]]; then
      ERRORS+=("حقلٌّ ناقصٌ في $env/environment.json: $field")
    fi
  done

  # ── 3-ب. اسمُ البيئةِ يطابقُ الدليلَ ────────────────────────────────────
  name=$(python3 -c "import json; print(json.load(open('$manifest')).get('name',''))" 2>/dev/null)
  if [[ "$name" != "$env" ]]; then
    ERRORS+=("اسمُ البيئةِ لا يطابقُ الدليلَ: $env/ → name='$name'")
  fi

  # ── 4. staging/production: لا in-memory fallback ─────────────────────────
  if [[ "$env" == "staging" || "$env" == "production" ]]; then
    fallback=$(python3 -c "import json; print(json.load(open('$manifest')).get('allow_in_memory_fallback', 'true'))" 2>/dev/null)
    if [[ "$fallback" == "True" || "$fallback" == "true" ]]; then
      ERRORS+=("$env: allow_in_memory_fallback يجبُ أن يكون false")
    fi

    # ── 5. staging/production: database_mode ليس in_memory أو local_postgres
    db_mode=$(python3 -c "import json; print(json.load(open('$manifest')).get('database_mode',''))" 2>/dev/null)
    if [[ "$db_mode" == "in_memory" || "$db_mode" == "local_postgres" ]]; then
      ERRORS+=("$env: database_mode لا يمكنُ أن يكون $db_mode")
    fi
  fi

  # ── 6. required_secrets موجودةٌ في السجلِّ أو هي معلَّقةٌ ────────────────
  secrets=$(python3 -c "import json; print(' '.join(json.load(open('$manifest')).get('required_secrets',[])))" 2>/dev/null)
  for secret in $secrets; do
    found=$(python3 -c "
import json
reg = json.load(open('$REGISTRY'))
names = [v['name'] for v in reg.get('variables', [])]
print('yes' if '$secret' in names else 'no')
" 2>/dev/null)
    if [[ "$found" == "no" ]]; then
      # Check M2-03 pending list
      is_pending=false
      for p in "${M2_03_PENDING_SECRETS[@]}"; do
        if [[ "$secret" == "$p" ]]; then
          is_pending=true
          break
        fi
      done
      if [[ "$is_pending" != "true" ]]; then
        ERRORS+=("$env: required_secret '$secret' غيرُ موجودٍ في env-registry.json ولا في قائمة M2-03")
      fi
    fi
  done
done

# ── 7. لا ملفّاتِ .env أو أنماطِ سرٍّ ──────────────────────────────────────
while IFS= read -r -d '' f; do
  ERRORS+=("ملفُّ .env ملتزَمٌ — استخدم environment.json فقط: ${f#$ROOT/}")
done < <(find "$ENV_DIR" -name "*.env" -not -name "*.env.example" -print0 2>/dev/null)

# فحصُ أنماطِ السرِّ
SECRET_PATTERNS=(
  "sbp_[a-z0-9]{40}"
  "postgres://[^[:space:]]*@"
  "postgresql://[^[:space:]]*@"
  "BEGIN.*PRIVATE KEY"
)
while IFS= read -r -d '' f; do
  for pattern in "${SECRET_PATTERNS[@]}"; do
    if grep -qE "$pattern" "$f" 2>/dev/null; then
      ERRORS+=("نمطُ سرٍّ مشتبهٌ به في ${f#$ROOT/}")
    fi
  done
done < <(find "$ENV_DIR" \( -name "*.json" -o -name "*.md" -o -name "*.env" \) -print0 2>/dev/null)

# ── النتيجة ──────────────────────────────────────────────────────────────
if ((${#ERRORS[@]})); then
  echo ""
  echo "${RED}فشلَ التحقّقُ من كتالوجِ البيئاتِ:${RST}"
  for e in "${ERRORS[@]}"; do
    echo "  ${RED}✗${RST} $e"
  done
  echo ""
  exit 1
fi

echo ""
echo "${GRN}✓ التحقّقُ من كتالوجِ البيئاتِ ناجحٌ${RST}"
echo "${DIM}  ملاحظة: هذا تحقّقٌ بنيويٌّ فقط — لا يُثبتُ fresh plan/apply.${RST}"
echo "${DIM}  التطبيقُ الحيُّ محجوبٌ حتى توافرِ بياناتِ اعتمادِ مزوّدِ السحابةِ (ADR-038).${RST}"
echo ""
exit 0

#!/usr/bin/env bash
# validate-authz-policy.sh — حارسُ مصفوفةِ سياساتِ التفويضِ (M1-05 · الفحصُ 16).
#
# السّؤالُ الذي يجيبُ عنهُ هذا الفحصُ واحدٌ ومحدودٌ:
#
#   **هل تباعدتْ مصفوفةُ «مَن يحقُّ لهُ أن يحملَ ماذا» عن الشفرةِ التي تفرضُ
#   الصلاحيّاتِ وتُصدِرُ الرموزَ — في أيِّ الاتجاهَين؟**
#
# وليسَ السّؤالُ «أهيَ السياسةُ كاملةٌ؟» — فليستْ، وهذا مُعلَنٌ لا مُداوى:
# البُعدُ الأوّلُ (الدورُ) لهُ مصفوفةٌ وإنفاذٌ ساكنٌ هنا؛ والبُعدانِ الآخرانِ
# (الملكيّةُ والمستأجرُ) **مُصنَّفانِ لا مفروضانِ**، وعددُ غيرِ المُصنَّفِ مكتوبٌ
# في الشفرةِ ومحروسٌ بالبابِ 6 أدناهُ. فهذا حارسُ **إعلانٍ صادقٍ** لا شهادةُ
# اكتمالٍ — كالفحصِ 12 بعينِه.
#
# الأبوابُ السّتّةُ:
#   1) الحزمةُ والوثيقةُ موجودتانِ وبعلاماتِهما.
#   2) كلُّ عمليّةٍ مفروضةٍ في الشفرةِ مُعلَنةٌ في `operations.ts` بصلاحيّاتِها
#      **حرفاً بحرفٍ** — والعددُ يُقاسُ لا يُكتَب.
#   3) كلُّ عمليّةٍ مُعلَنةٍ موجودةٌ في الشفرةِ — لا إعلانَ لمسارٍ مات.
#   4) كلُّ ثلاثيّةِ إصدارٍ (`serviceName` · `audience` · ثابتُ صلاحيّاتٍ) في
#      جذرِ تركيبٍ **إنتاجيٍّ** داخلَ سقفِ منحِها، وثابتُها مذكورٌ في دليلِ المنحِ.
#   5) لا دورَ إنتاجٍ بلا إعلانٍ، ولا دورَ أسطولِ اختبارٍ في ملفٍّ إنتاجيٍّ.
#   6) حسابُ «المُصنَّفُ + غيرُ المُصنَّفِ = الجردُ» صحيحٌ، وعددُ العملياتِ
#      المربوطةِ بالرمزِ يُطابِقُ الشفرةَ والوثيقةَ.
#   7) `M1-05B`: كلُّ صفٍّ `token-bound` يُقابِلُ مساراً تفرضُ شفرتُهُ المُنتَفِعَ
#      (`beneficiary: "required"`) **وبالعكسِ**، والعددُ مُشتَقٌّ لا مكتوبٌ، ولا
#      مسارَ مربوطٌ بمالكٍ يستقي هويّتَهُ من ترويسةٍ وحدَها.
#
# ولِمَ حارسٌ سادسَ عشرَ ولم يكفِ الفحصُ 12: ذاكَ يسألُ «أيُوقِّعُ كلُّ مُنادٍ،
# وأيَفرِضُ كلُّ حدٍّ؟» — سؤالُ **مُصادَقةٍ**. وهذا يسألُ «أيَحقُّ لهُ ما يحملُ؟»
# — سؤالُ **تفويضٍ**. وكانَ الثاني بلا حارسٍ أصلاً: القياسُ في 2026-09-15 أظهرَ
# أنَّ `mintServiceToken` يُمرِّرُ `scp` كما وردَ، فبوّاباتُ الخروجِ تُصدِرُ
# رموزاً بـ`Object.values(X_SCOPES)` ولا شيءَ في المستودعِ يُفرِّقُ ذلكَ عن
# خدمةِ إنتاجٍ تفعلُ الأمرَ نفسَه.
#
# المرجع: ADR-027 · docs/07-security/AUTHORIZATION_POLICY_MATRIX.md
#
#   bash scripts/checks/validate-authz-policy.sh
#
# لا شبكةَ ولا git: قراءةُ قرصٍ محضةٌ — فلا تخطّيَ له، مرورٌ أو إخفاق.
set -uo pipefail

cd "$(dirname "$0")/../.." || { echo "تعذّر الوصول إلى جذر المستودع" >&2; exit 1; }

RED=$'\033[31m'; GRN=$'\033[32m'; RST=$'\033[0m'

PKG="packages/authz-policy"
DOC="docs/07-security/AUTHORIZATION_POLICY_MATRIX.md"
FAIL=0

ok()  { printf '  %s✓%s %s\n' "$GRN" "$RST" "$1"; }
bad() { printf '  %s✗%s %s\n' "$RED" "$RST" "$1"; FAIL=1; }

# ── 1) الحزمةُ والوثيقةُ ───────────────────────────────────────────────────
for f in \
  "$PKG/src/operations.ts" \
  "$PKG/src/grants.ts" \
  "$PKG/src/bindings.ts" \
  "$PKG/src/policy.ts" \
  "$PKG/src/index.ts" \
  "$DOC"
do
  if [[ -f "$f" ]]; then ok "موجودٌ: $f"; else bad "مفقودٌ: $f"; fi
done

if (( FAIL )); then
  printf '\n%s✗ حارسُ مصفوفةِ التفويضِ: إخفاقٌ في البابِ الأوّلِ — لا يُقاسُ الباقي على نقصٍ.%s\n' "$RED" "$RST"
  exit 1
fi

for marker in "<!-- authz-matrix:start -->" "<!-- authz-matrix:end -->"; do
  grep -qF "$marker" "$DOC" || bad "علامةُ الوثيقةِ مفقودةٌ: $marker"
done

# ── 2..6) القياسُ ──────────────────────────────────────────────────────────
# ولِمَ `python3` هنا: القياسُ يقرأُ تسجيلاتَ مساراتٍ تمتدُّ على أسطرٍ ويُطابِقُ
# مجموعاتٍ، و`grep` سطريٌّ بطبعِه. وهوَ مُستعملٌ في حرّاسٍ قائمةٍ تعملُ في CI
# (`validate-work-claims.sh` · `validate-risk-register.sh`) فليسَ تبعيّةً جديدةً.
MEASURE_OUT="$(python3 - "$PKG" "$DOC" <<'PY'
import glob
import json
import os
import re
import sys

PKG, DOC = sys.argv[1], sys.argv[2]
out = []


def ok(msg):
    out.append("OK\t" + msg)


def bad(msg):
    out.append("BAD\t" + msg)


def read(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def strip_comments(src):
    """يُزيلُ التعليقاتَ قبلَ المسحِ — فاسمُ دالّةٍ في تعليقٍ شارحٍ ليسَ موضعَ إصدارٍ.
    (بلا هذا يقرأُ الحارسُ شرحَ `grants.ts` نفسِهِ جذرَ تركيبٍ أعمى.)"""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"^[ \t]*//.*$", "", src, flags=re.M)


# ── قياسُ الشفرةِ: الحدودُ وصلاحيّاتُها ومساراتُها ───────────────────────────
code_ops = {}          # (audience, method, path) -> tuple(scopes)
code_beneficiary_required = set()   # (audience, method, path) مُصنَّفةٌ `beneficiary: "required"`
route_service = {}                  # (audience, method, path) -> اسمُ الخدمةِ
beneficiary_helpers_by_service = {}  # svc -> أسماءُ المساعدينَ المُنتِجينَ للمطلبِ
open_routes = 0
for identity in sorted(glob.glob("services/*/src/http/service-identity.ts")):
    svc = identity.split(os.sep)[1]
    src = read(identity)
    aud_match = re.search(r'_AUDIENCE\s*=\s*"([^"]+)"', src)
    const_match = re.search(
        r"export const ([A-Z_]+_SCOPES)\s*=\s*\{(.*?)\n\}\s*as const;", src, re.S
    )
    if aud_match is None or const_match is None:
        continue
    audience = aud_match.group(1)
    scope_map = dict(re.findall(r'(\w+)\s*:\s*"([^"]+)"', const_match.group(2)))

    app = f"services/{svc}/src/http/app.ts"
    if not os.path.exists(app):
        bad(f"حدٌّ بلا تطبيقٍ: {app}")
        continue
    app_src = read(app)

    # ── تصنيفُ المُنتَفِعِ (`M1-05B`) ───────────────────────────────────────
    # لا يُقرأُ `beneficiary: "required"` من إعدادِ المسارِ مباشرةً لأنّهُ يسكنُ
    # في مساعدٍ (`ownerScoped`). فيُقاسُ **على مرحلتَينِ**: أوّلاً أيُّ المساعدينَ
    # يُنتِجُ المطلبَ فعلاً في جسمِهِ، ثمَّ أيُّ المساراتِ يُناديهِ. ولو أُفرِغَ
    # جسمُ المساعدِ من المطلبِ لخلا هذا الجردُ فسقطَ البابُ 7 — وهيَ الطفرةُ
    # التي يُجرِّبُها `gov-cases-authz-policy.sh`.
    app_clean = strip_comments(app_src)
    beneficiary_helpers = set()
    # المسافةُ البادئةُ **مقروءةٌ لا مُهمَلةٌ**: صيغةٌ سابقةٌ طلبَتِ القوسَ
    # الخاتمَ في العمودِ صفرٍ، فكانَ مساعدٌ مُعشَّشٌ داخلَ دالّةِ بناءِ التطبيقِ
    # **غيرَ مرئيٍّ** لهذا الجردِ — ثمَّ يُقرأُ الأخضرُ إنفاذاً وهوَ غيابُ رؤيةٍ.
    # فصارَ العمقُ مُلتَقَطاً (`\1`) والقوسُ الخاتمُ مطلوباً على عمقِهِ نفسِهِ،
    # ويُقاسُ ذلكَ بطفرتَينِ في `gov-cases-authz-policy.sh` (تعشيشٌ وحدَهُ يمرُّ ·
    # تعشيشٌ معَ تفريغِ المطلبِ يسقطُ) لا بملحوظةٍ.
    for helper in re.finditer(
        r"(?m)^([ \t]*)function\s+(\w+)\s*\([^)]*\)\s*:\s*[^{\n]+\{(.*?)\n\1\}",
        app_clean,
        re.S,
    ):
        if re.search(r'beneficiary:\s*"required"', helper.group(3)):
            beneficiary_helpers.add(helper.group(2))
    if beneficiary_helpers:
        beneficiary_helpers_by_service[svc] = sorted(beneficiary_helpers)

    for route in re.finditer(
        r'app\.(get|post|put|patch|delete)\(\s*"([^"]+)"\s*,\s*\{\s*config:\s*([^}]*?)\}',
        app_clean,
    ):
        method, path, cfg = route.group(1).upper(), route.group(2), route.group(3)
        _direct = re.search(r'beneficiary:\s*"required"', cfg) is not None
        _via_helper = any(re.search(rf"\b{h}\s*\(", cfg) for h in beneficiary_helpers)
        if _direct or _via_helper:
            code_beneficiary_required.add((audience, method, path))
            route_service[(audience, method, path)] = svc
        keys = re.findall(r"[A-Z_]+_SCOPES\.(\w+)", cfg)
        if not keys:
            if "OPEN" in cfg:
                open_routes += 1
            else:
                bad(f"مسارٌ بلا صلاحيّةٍ ولا `OPEN`: {audience} {method} {path}")
            continue
        missing = [k for k in keys if k not in scope_map]
        if missing:
            bad(f"مفتاحُ صلاحيّةٍ غيرُ مُعرَّفٍ: {audience} {method} {path} → {missing}")
            continue
        code_ops[(audience, method, path)] = tuple(scope_map[k] for k in keys)

# ── قراءةُ الإعلانِ: operations.ts ─────────────────────────────────────────
ops_src = read(f"{PKG}/src/operations.ts")
declared = {}
for m in re.finditer(
    r'\{\s*audience:\s*"([^"]+)",\s*method:\s*"([^"]+)",\s*path:\s*"([^"]+)",\s*scopes:\s*\[([^\]]*)\]\s*\}',
    ops_src,
):
    declared[(m.group(1), m.group(2), m.group(3))] = tuple(
        re.findall(r'"([^"]+)"', m.group(4))
    )

# ── البابُ 2: كلُّ مفروضٍ مُعلَنٌ بصلاحيّاتِه ────────────────────────────────
missing_decl = sorted(k for k in code_ops if k not in declared)
if missing_decl:
    for key in missing_decl:
        bad("عمليّةٌ مفروضةٌ في الشفرةِ بلا إعلانٍ في المصفوفةِ: %s %s %s" % key)
else:
    ok(f"كلُّ عمليّةٍ مفروضةٍ مُعلَنةٌ — {len(code_ops)} عمليّةً على {len({k[0] for k in code_ops})} حدودٍ ({open_routes} مساراً مفتوحاً لا يفرضُ صلاحيّةً)")

drifted = sorted(k for k in code_ops if k in declared and code_ops[k] != declared[k])
if drifted:
    for key in drifted:
        bad(
            "انحرافُ صلاحيّاتٍ: %s %s %s — الشفرةُ %s والإعلانُ %s"
            % (key + (list(code_ops[key]), list(declared[key])))
        )
else:
    ok("لا انحرافَ في صلاحيّةِ أيِّ عمليّةٍ — مطابقةٌ حرفيّةٌ بينَ الشفرةِ والإعلانِ")

# ── البابُ 3: لا إعلانَ لمسارٍ مات ─────────────────────────────────────────
phantom = sorted(k for k in declared if k not in code_ops)
if phantom:
    for key in phantom:
        bad("إعلانٌ لعمليّةٍ لا وجودَ لها في الشفرةِ: %s %s %s" % key)
else:
    ok(f"لا إعلانَ زائداً — {len(declared)} عمليّةً مُعلَنةً تُقابِلُ الشفرةَ تماماً")

# ── قراءةُ المنحِ ──────────────────────────────────────────────────────────
grants_src = read(f"{PKG}/src/grants.ts")
# المِرساةُ دقيقةٌ بقصدٍ: `split` على بادئةِ اسمٍ يُطابِقُ
# `PRODUCTION_GRANTS_RENAMED` أيضاً فيقرأُ الحارسُ مصفوفةً أُزيلَ اسمُها ثمَّ
# يُعلِنُ الخضرةَ — وهيَ الحالةُ التي كشفتْها حالةُ طفرةٍ في `[ص]`.
_prod_anchor = re.search(r"export const PRODUCTION_GRANTS\b\s*:", grants_src)
_test_anchor = re.search(r"export const TEST_FLEET_ROLES\b\s*:", grants_src)
if _prod_anchor is None or _test_anchor is None:
    bad(
        "لم تُوجَدْ مِرساةُ `PRODUCTION_GRANTS` أو `TEST_FLEET_ROLES` في `grants.ts` — "
        "عميَ القياسُ، والأعمى لا يُقرأُ شاهداً"
    )
    print("\n".join(out))
    raise SystemExit(0)
prod_block = grants_src[_prod_anchor.end() : _test_anchor.start()]
grants = {}          # role -> audience -> (scopes, evidence)
for role_match in re.finditer(r'\n  "?([A-Za-z0-9_-]+)"?:\s*\[', prod_block):
    role = role_match.group(1)
    start = role_match.end()
    depth = 1
    i = start
    while i < len(prod_block) and depth:
        if prod_block[i] == "[":
            depth += 1
        elif prod_block[i] == "]":
            depth -= 1
        i += 1
    body = prod_block[start : i - 1]
    grants[role] = {}
    for g in re.finditer(
        r'audience:\s*"([^"]+)",\s*scopes:\s*\[([^\]]*)\].*?evidence:\s*\[([^\]]*)\]',
        body,
        re.S,
    ):
        grants[role][g.group(1)] = (
            tuple(re.findall(r'"([^"]+)"', g.group(2))),
            tuple(re.findall(r'"([^"]+)"', g.group(3))),
        )

test_block = grants_src.split("export const TEST_FLEET_ROLES", 1)[1]
test_roles = set(re.findall(r'\n  "?([A-Za-z0-9_-]+)"?:\s*"', test_block))

enforced_at = {}
for (aud, _m, _p), scopes in declared.items():
    enforced_at.setdefault(aud, set()).update(scopes)

phantom_grants = []
for role in sorted(grants):
    for audience in sorted(grants[role]):
        for scope in grants[role][audience][0]:
            if scope not in enforced_at.get(audience, set()):
                phantom_grants.append(f"«{role}» → «{audience}»: «{scope}»")
if phantom_grants:
    for v in phantom_grants:
        bad(
            "صلاحيّةٌ مُمنوحةٌ لا يفرضُها أيُّ مسارٍ على جمهورِها — "
            "إمّا خطأٌ مطبعيٌّ يُقرأُ منحاً أوسعَ، وإمّا بقيّةُ صلاحيّةٍ ماتتْ: " + v
        )
elif grants:
    ok("كلُّ صلاحيّةٍ مُمنوحةٍ مفروضةٌ فعلاً على جمهورِها — لا منحَ لاسمٍ لا وجودَ لهُ")

if not grants:
    bad("لم تُقرأْ أيُّ منحةِ إنتاجٍ من `grants.ts` — تغيَّرتْ صيغةُ المصفوفةِ فعميَ الحارسُ")
if not test_roles:
    bad("لم يُقرأْ أيُّ دورِ أسطولِ اختبارٍ — تغيَّرتْ صيغةُ الجردِ فعميَ البابُ 5")

# ── قياسُ ثلاثيّاتِ الإصدارِ ───────────────────────────────────────────────
TS_FILES = []
for root in ("services", "bots", "packages", "apps"):
    for path in glob.glob(f"{root}/**/*.ts", recursive=True):
        if f"{os.sep}node_modules{os.sep}" in path or "/node_modules/" in path:
            continue
        TS_FILES.append(path)
TS_FILES.sort()


def is_test_file(path):
    return "__tests__" in path or re.match(r"packages/[a-z0-9-]+-e2e/", path) is not None


scope_consts = {}
for path in TS_FILES:
    src = read(path)
    for m in re.finditer(
        r"(?:export )?const ([A-Za-z0-9_]*SCOPES)\s*(?::\s*readonly string\[\])?\s*=\s*\[(.*?)\]\s*(?:as const)?\s*;",
        src,
        re.S,
    ):
        scope_consts[m.group(1)] = tuple(re.findall(r'"([^"]+)"', m.group(2)))

# ── توسيعُ أسماءِ الأدوارِ المُركَّبةِ ──────────────────────────────────────
# جذرُ تركيبِ البوتاتِ واحدٌ لثلاثةِ بوتاتٍ (`packages/bot-runtime/src/runtime.ts`)
# فاسمُ الدورِ فيهِ قالبٌ: `${config.bot}-bot`. وقراءتُهُ حرفاً واحداً تُعمي
# الحارسَ عن ثلاثةِ أدوارٍ حقيقيّةٍ؛ فيُوسَّعُ على `BOT_KINDS` المُعلَنِ في
# العقدِ — فإن أُضيفَ بوتٌ رابعٌ بلا منحٍ مُعلَنٍ سقطتِ الدفعةُ، وهوَ المقصودُ.
BOT_KINDS = ()
kinds_path = "packages/contracts/channel/src/index.ts"
if os.path.exists(kinds_path):
    km = re.search(r"BOT_KINDS\s*:\s*readonly BotKind\[\]\s*=\s*\[([^\]]*)\]", read(kinds_path))
    if km:
        BOT_KINDS = tuple(re.findall(r'"([^"]+)"', km.group(1)))
if not BOT_KINDS:
    bad(f"لم تُقرأْ `BOT_KINDS` من {kinds_path} — فتعذَّرَ توسيعُ أدوارِ البوتاتِ، والمجهولُ لا يُقرأُ سماحاً")


def balanced_object(src, open_index):
    """يُعيدُ جسمَ كائنٍ مُتوازِنَ الأقواسِ — فـ`keyRegistryFromEnv({...})` تُعشِّشُ."""
    depth = 0
    for k in range(open_index, len(src)):
        if src[k] == "{":
            depth += 1
        elif src[k] == "}":
            depth -= 1
            if depth == 0:
                return src[open_index + 1 : k]
    return None


def roles_of(raw_name):
    """اسمُ دورٍ حرفيٌّ → [الاسمُ]؛ قالبُ بوتٍ → كلُّ الأنواعِ؛ وإلّا فلا شيءَ."""
    literal = re.fullmatch(r'"([^"]+)"', raw_name)
    if literal:
        return [literal.group(1)]
    template = re.fullmatch(r"`\$\{[A-Za-z0-9_.]*\bbot\}-bot`", raw_name.strip())
    if template:
        return [f"{kind}-bot" for kind in BOT_KINDS]
    return []


prod_violations = []
prod_roles_seen = set()
test_roles_in_prod = []
unreadable = []
signer_sites = 0
for path in TS_FILES:
    src = read(path)
    if is_test_file(path):
        continue
    src = strip_comments(src)
    for m in re.finditer(r"createServiceRequestSigner\(\s*\{", src):
        body = balanced_object(src, m.end() - 1)
        if body is None:
            unreadable.append(f"{path}: جسمُ إعدادِ الإصدارِ غيرُ متوازنِ الأقواسِ")
            continue
        role_m = re.search(r"serviceName:\s*(\"[^\"]+\"|`[^`]+`|[A-Za-z0-9_.]+)", body)
        aud_m = re.search(r'audience:\s*"([^"]+)"', body)
        scope_m = re.search(r"scopes:\s*([A-Za-z0-9_]+)\s*,", body)
        signer_sites += 1
        if role_m is None:
            unreadable.append(f"{path}: موضعُ إصدارٍ بلا `serviceName` مقروءٍ")
            continue
        roles = roles_of(role_m.group(1))
        if not roles:
            unreadable.append(f"{path}: اسمُ الدورِ غيرُ مقروءٍ ساكناً: {role_m.group(1)}")
            continue
        for role in roles:
            prod_roles_seen.add(role)
            if role in test_roles:
                test_roles_in_prod.append(f"{role} @ {path}")
                continue
            if role not in grants:
                prod_violations.append(
                    f"دورُ إنتاجٍ بلا إعلانٍ في المصفوفةِ: «{role}» @ {path}"
                )
                continue
            if aud_m is None:
                unreadable.append(f"{role} @ {path}: الجمهورُ غيرُ حرفيٍّ")
                continue
            audience = aud_m.group(1)
            if audience not in grants[role]:
                prod_violations.append(
                    f"منحٌ غيرُ مُعلَنٍ: «{role}» يُوقِّعُ لـ«{audience}» ولا منحَ لهُ عليهِ @ {path}"
                )
                continue
            allowed, evidence = grants[role][audience]
            if scope_m is None:
                unreadable.append(
                    f"{role} → {audience} @ {path}: ثابتُ الصلاحيّاتِ غيرُ حرفيٍّ"
                )
                continue
            const_name = scope_m.group(1)
            if const_name not in evidence:
                prod_violations.append(
                    f"ثابتٌ غيرُ مذكورٍ في دليلِ المنحِ: «{const_name}» لـ«{role}» → «{audience}» @ {path}"
                )
            requested = scope_consts.get(const_name)
            if requested is None:
                unreadable.append(f"{const_name} @ {path}: لم تُقرأْ قيمتُهُ")
                continue
            over = [s for s in requested if s not in allowed]
            if over:
                prod_violations.append(
                    f"صلاحيّةٌ خارجَ سقفِ المنحِ: «{role}» → «{audience}» تطلبُ {over} @ {path}"
                )

if signer_sites == 0:
    bad("لم يُقرأْ أيُّ موضعِ إصدارٍ إنتاجيٍّ — عميَ البابُ 4 فلا يُقرأُ مرورُهُ سماحاً")

# ── البابُ 4 ───────────────────────────────────────────────────────────────
if prod_violations:
    for v in sorted(set(prod_violations)):
        bad(v)
else:
    ok(f"كلُّ ثلاثيّةِ إصدارٍ إنتاجيّةٍ داخلَ سقفِ منحِها وثابتُها مذكورٌ في دليلِه — {signer_sites} موضعَ إصدارٍ")

if unreadable:
    for v in sorted(set(unreadable)):
        bad(
            "موضعُ إصدارٍ إنتاجيٌّ لا يُقرأُ ساكناً — والمجهولُ لا يُقرأُ سماحاً: " + v
        )
else:
    ok("كلُّ موضعِ إصدارٍ إنتاجيٍّ مقروءٌ ساكناً — لا دورَ ولا جمهورَ ولا ثابتَ مجهولاً")

# ── البابُ 5 ───────────────────────────────────────────────────────────────
if test_roles_in_prod:
    for v in sorted(test_roles_in_prod):
        bad(f"دورُ أسطولِ اختبارٍ في ملفٍّ إنتاجيٍّ: {v}")
else:
    ok(f"لا دورَ اختبارٍ في ملفٍّ إنتاجيٍّ — {len(test_roles)} دوراً مُعلَناً في الجردِ")

orphan_declared = sorted(set(grants) - prod_roles_seen)
if orphan_declared:
    for role in orphan_declared:
        bad(f"دورٌ مُعلَنٌ في المصفوفةِ ولا موضعَ إصدارٍ إنتاجيٍّ لهُ: «{role}»")
else:
    ok(f"كلُّ دورٍ مُعلَنٍ لهُ موضعُ إصدارٍ إنتاجيٌّ — {len(grants)} دوراً")

# ── البابُ 6: حسابُ التصنيفِ ودعوى الصفرِ ──────────────────────────────────
bindings_src = read(f"{PKG}/src/bindings.ts")
binding_entries = re.findall(r'strength:\s*"([^"]+)"', bindings_src)
token_bound = sum(1 for s in binding_entries if s == "token-bound")
classified = len(binding_entries)
enforced_total = len(declared)

if classified + (enforced_total - classified) != enforced_total:
    bad("حسابُ التصنيفِ لا يُغلِقُ الجردَ")
else:
    ok(
        f"حسابُ التصنيفِ يُغلِقُ الجردَ: {classified} مُصنَّفةً + {enforced_total - classified} غيرَ مُصنَّفةٍ = {enforced_total}"
    )

# الوثيقةُ تُصرِّحُ بالقياسِ بصيغةٍ حرفيّةٍ لا بعبارةٍ فضفاضةٍ — فالرقمُ المُعلَنُ
# في نصٍّ سرديٍّ يشيخُ بلا أن يشتكيَ، والمطلوبُ سطرٌ يُقارَنُ آلةً.
doc_src = read(DOC)
doc_facts = {
    f"ENFORCED_OPERATIONS = {enforced_total}": "عددُ العملياتِ المفروضةِ",
    f"ENFORCED_SCOPES = {len({s for v in enforced_at.values() for s in v})}": "عددُ الصلاحيّاتِ المفروضةِ",
    f"OPEN_ROUTES = {open_routes}": "عددُ المساراتِ المفتوحةِ",
    f"TOKEN_BOUND_OPERATION_COUNT = {token_bound}": "عددُ العملياتِ المربوطةِ بالرمزِ",
    f"UNCLASSIFIED_OPERATION_COUNT = {enforced_total - classified}": "عددُ غيرِ المُصنَّفِ",
}
missing_facts = [f"{label}: `{fact}`" for fact, label in doc_facts.items() if fact not in doc_src]
if missing_facts:
    for v in missing_facts:
        bad("قياسٌ غيرُ مُصرَّحٍ بهِ حرفيّاً في الوثيقةِ — " + v)
else:
    ok(f"كلُّ أرقامِ القياسِ ({len(doc_facts)}) مُصرَّحٌ بها حرفيّاً في الوثيقةِ ومُطابِقةٌ للشفرةِ")

for key in sorted({(b[0], b[1], b[2]) for b in re.findall(
    r'audience:\s*"([^"]+)",\s*method:\s*"([^"]+)",\s*path:\s*"([^"]+)",\s*dimension',
    bindings_src,
)}):
    if key not in declared:
        bad("تصنيفُ ربطٍ لعمليّةٍ غيرِ مُعلَنةٍ في الجردِ: %s %s %s" % key)

# ── البابُ 7: الربطُ بالرمزِ مُثبَتٌ في الشفرةِ لا مُدَّعىً في المصفوفةِ (`M1-05B`)
#
# البابُ 6 يُحصي؛ وهذا يسألُ السؤالَ الذي لا يُحصى: **أيُقابِلُ كلُّ صفٍّ
# `token-bound` مساراً تفرضُ شفرتُهُ المُنتَفِعَ فعلاً؟** فبلا هذا يصيرُ رفعُ
# `TOKEN_BOUND_OPERATION_COUNT` تغييرَ كلمةٍ في صفٍّ — أي مصفوفةً تُصدِّقُ
# نفسَها. والمقابلةُ **في الاتجاهَينِ**: صفٌّ بلا شفرةٍ دعوى كاذبةٌ، وشفرةٌ
# بلا صفٍّ إنفاذٌ غيرُ مُعلَنٍ يسقطُ من المصفوفةِ بصمتٍ.
matrix_token_bound = {
    (m.group(1), m.group(2), m.group(3))
    for m in re.finditer(
        r'audience:\s*"([^"]+)",\s*method:\s*"([^"]+)",\s*path:\s*"([^"]+)",'
        r'\s*dimension:\s*"[^"]+",\s*strength:\s*"token-bound"',
        bindings_src,
    )
}

claimed_not_enforced = sorted(matrix_token_bound - code_beneficiary_required)
enforced_not_claimed = sorted(code_beneficiary_required - matrix_token_bound)

if claimed_not_enforced:
    for key in claimed_not_enforced:
        bad(
            "صفٌّ `token-bound` لا تفرضُ شفرتُهُ المُنتَفِعَ — المسارُ غيرُ مُصنَّفٍ "
            'بـ`beneficiary: "required"`: %s %s %s' % key
        )
if enforced_not_claimed:
    for key in enforced_not_claimed:
        bad(
            'مسارٌ مُصنَّفٌ `beneficiary: "required"` في الشفرةِ ولا صفَّ '
            "`token-bound` لهُ في المصفوفةِ — إنفاذٌ يسقطُ من الإعلانِ: %s %s %s" % key
        )
if not claimed_not_enforced and not enforced_not_claimed:
    ok(
        f"كلُّ صفٍّ `token-bound` مُثبَتٌ في الشفرةِ وبالعكسِ — {len(matrix_token_bound)} عمليّةً "
        f"على {len({k[0] for k in matrix_token_bound})} حدٍّ"
    )

# ولا يُقرأُ الفراغُ توافقاً: مجموعتانِ فارغتانِ تتطابقانِ دائماً. فإن كانَ
# العددُ المُعلَنُ في الوثيقةِ أكبرَ من صفرٍ ثمَّ خلَتِ الشفرةُ والمصفوفةُ
# معاً، فذلكَ عمىً لا خضرةٌ.
if token_bound > 0 and not matrix_token_bound:
    bad(
        "العددُ المُشتَقُّ يقولُ %d ولم يُقرأْ صفٌّ `token-bound` واحدٌ — عميَ البابُ 7"
        % token_bound
    )

# والعددُ المُشتَقُّ يجبُ أن يُطابِقَ الصفوفَ المقروءةَ هنا، وإلّا فأحدُ
# المِسبارَينِ يقرأُ ما لا يقرأُ الآخرُ.
if token_bound != len(matrix_token_bound):
    bad(
        "تباعدَ مِسبارا القياسِ: `strength` أعطى %d و`(audience,method,path)` أعطى %d"
        % (token_bound, len(matrix_token_bound))
    )

# `TOKEN_BOUND_OPERATION_COUNT` **مُشتَقٌّ لا مكتوبٌ**: رقمٌ حرفيٌّ هنا يُصدِّقُ
# ما لا تُثبِتُهُ الصفوفُ، ويُصلِحُ الطفرةَ التي يُفترَضُ أن تُسقِطَ الفحصَ.
_count_decl = re.search(
    r"export const TOKEN_BOUND_OPERATION_COUNT\s*:\s*number\s*=(.*?);", bindings_src, re.S
)
if _count_decl is None:
    bad("لم يُوجَدْ إعلانُ `TOKEN_BOUND_OPERATION_COUNT` — عميَ القياسُ")
elif re.search(r"=\s*\d+\s*$", _count_decl.group(0).replace(";", "").strip()):
    bad("`TOKEN_BOUND_OPERATION_COUNT` رقمٌ مكتوبٌ باليدِ — والمكتوبُ لا يُقاسُ")
elif 'strength === "token-bound"' not in _count_decl.group(1):
    bad("`TOKEN_BOUND_OPERATION_COUNT` لا يُشتَقُّ من `strength === \"token-bound\"`")
else:
    ok("`TOKEN_BOUND_OPERATION_COUNT` مُشتَقٌّ من الصفوفِ لا مكتوبٌ باليدِ")

# `TENANT_BOUND_OPERATION_COUNT` — العددُ الذي أدخلَتْهُ الموجةُ 2 (`CLM-0179`).
#
# ولمَ بابٌ ثانٍ لعددٍ ثانٍ؟ لأنَّ البابَ أعلاهُ لا يقرأُ إلّا اسماً واحداً؛
# فعددٌ جديدٌ مُشتَقٌّ كانَ سيُستبدَلُ برقمٍ مكتوبٍ باليدِ **والفحصُ أخضرُ**.
# وقد قِيسَ ذلكَ بطفرةٍ في `gov-cases-authz-policy.sh` لا بالظنِّ.
#
# والبُعدُ مقروءٌ من الصفوفِ لا من الإعلانِ: الفرزُ يُطابِقُ ما تُطابِقُهُ
# الشفرةُ، فلو ادّعى العددُ خمساً وقالتِ الصفوفُ ثلاثاً سقطَ الفحصُ.
tenant_rows = {
    (m.group(1), m.group(2), m.group(3))
    for m in re.finditer(
        r'audience:\s*"([^"]+)",\s*method:\s*"([^"]+)",\s*path:\s*"([^"]+)",'
        r'\s*dimension:\s*"tenant",\s*strength:\s*"token-bound"',
        bindings_src,
    )
}
_tenant_decl = re.search(
    r"export const TENANT_BOUND_OPERATION_COUNT\s*:\s*number\s*=(.*?);", bindings_src, re.S
)
if _tenant_decl is None:
    bad("لم يُوجَدْ إعلانُ `TENANT_BOUND_OPERATION_COUNT` — عميَ قياسُ بُعدِ المُستأجِرِ")
elif re.search(r"=\s*\d+\s*$", _tenant_decl.group(0).replace(";", "").strip()):
    bad("`TENANT_BOUND_OPERATION_COUNT` رقمٌ مكتوبٌ باليدِ — والمكتوبُ لا يُقاسُ")
elif 'dimension === "tenant"' not in _tenant_decl.group(1):
    bad("`TENANT_BOUND_OPERATION_COUNT` لا يُشتَقُّ من `dimension === \"tenant\"`")
elif not tenant_rows:
    bad("لم يُقرأْ صفُّ `tenant` مربوطٌ بالرمزِ واحدٌ — والفراغُ لا يُقرأُ توافقاً")
elif tenant_rows - matrix_token_bound:
    bad(
        "صفُّ `tenant` مربوطٌ لم يُقرأْهُ مِسبارُ البابِ 7: %s"
        % sorted(tenant_rows - matrix_token_bound)
    )
else:
    ok(
        "`TENANT_BOUND_OPERATION_COUNT` مُشتَقٌّ من بُعدِ المُستأجِرِ — "
        f"{len(tenant_rows)} عمليّةً كلُّها داخلَ جردِ البابِ 7"
    )

# ولا مسارَ مربوطٌ بمالكٍ يستقي هويّتَهُ من ترويسةٍ وحدَها: مُعالِجُ كلِّ مسارٍ
# مُصنَّفٍ يجبُ أن يُنادِيَ قارئَ الرمزِ (`ownerPublicIdOf`) عبرَ مساعدٍ، فلا
# يكفي أن يُقارِنَ ترويسةً بمَورِدٍ.
for key in sorted(code_beneficiary_required):
    svc = route_service.get(key)
    if svc is None:
        bad("مسارٌ مُصنَّفٌ بلا خدمةٍ مقروءةٍ: %s %s %s" % key)
        continue
    app_clean = strip_comments(read(f"services/{svc}/src/http/app.ts"))
    if "ownerPublicIdOf" not in app_clean:
        bad(
            "خدمةٌ فيها مسارٌ مربوطٌ بالرمزِ ولا تقرأُ `ownerPublicIdOf` — الهويّةُ "
            "من ترويسةٍ وحدَها: %s (%s %s %s)" % ((svc,) + key)
        )
if code_beneficiary_required:
    ok(
        f"كلُّ خدمةٍ فيها مسارٌ مربوطٌ بالرمزِ تقرأُ المالكَ من الرمزِ — "
        f"{len({route_service[k] for k in code_beneficiary_required if k in route_service})} خدمةً"
    )

# والمساعدُ الذي يُنتِجُ المطلبَ يجبُ أن يُوجَدَ حيثُ تُوجَدُ مساراتٌ مُصنَّفةٌ،
# وإلّا فالتصنيفُ حرفيٌّ في كلِّ مسارٍ — مصدرا حقيقةٍ لا مصدرٌ واحدٌ.
for svc in sorted({route_service[k] for k in code_beneficiary_required if k in route_service}):
    if svc not in beneficiary_helpers_by_service:
        bad(
            f"مساراتٌ مُصنَّفةٌ في «{svc}» بلا مساعدٍ واحدٍ يُنتِجُ المطلبَ — "
            "التصنيفُ مُكرَّرٌ حرفيّاً فيَشيخُ متفرِّقاً"
        )

# ── البابُ 8: جدولا الأسطولِ مُنسَدّانِ، وسقفُ جمهورِهِ مقيسٌ (`M1-05B` · الموجةُ 3)
#
# صارَ الإصدارُ يُنفِذُ المصفوفةَ في زمنِ التشغيلِ، فدورٌ بلا إعلانٍ يموتُ عندَ
# البناءِ. ولئلّا يصيرَ العلاجُ **إعلاناً بلا معنىً** (اسمٌ يُضافُ ليَسكُتَ
# الحاجزُ) يُقاسُ هنا أمرانِ: أنَّ الجردَ (`TEST_FLEET_ROLES`) والسقفَ
# (`FLEET_GRANTS`) مُنسَدّانِ على بعضِهما بلا اسمٍ يتيمٍ في أيِّ الجهتَينِ،
# وأنَّ كلَّ موضعِ توقيعٍ **في ملفّاتِ الاختبارِ** بدورِ أسطولٍ وجمهورٍ حرفيَّينِ
# يقعُ داخلَ الجمهورِ المُعلَنِ لذلكَ الدورِ.
_fleet_anchor = re.search(r"export const FLEET_GRANTS\b\s*:", grants_src)
fleet = {}
if _fleet_anchor is None:
    bad("لم تُوجَدْ مِرساةُ `FLEET_GRANTS` في `grants.ts` — عميَ البابُ 8")
else:
    fleet_block = grants_src[_fleet_anchor.end() :]
    for m in re.finditer(r'\n  "?([A-Za-z0-9_-]+)"?:\s*\{(.*?)\n  \},', fleet_block, re.S):
        role, body = m.group(1), m.group(2)
        aud_m = re.search(r'audiences:\s*(\[[^\]]*\]|"any-audience")', body)
        reason_m = re.search(r'reason:\s*\n?\s*"([^"]*)"', body)
        if aud_m is None:
            bad(f"سقفُ أسطولٍ بلا `audiences` مقروءٍ: «{role}»")
            continue
        raw = aud_m.group(1)
        auds = "any-audience" if raw == '"any-audience"' else tuple(re.findall(r'"([^"]+)"', raw))
        fleet[role] = (auds, (reason_m.group(1) if reason_m else ""))

if not fleet:
    bad("لم يُقرأْ أيُّ سقفِ أسطولٍ — تغيَّرتْ صيغةُ `FLEET_GRANTS` فعميَ البابُ 8")
else:
    unpaired_inventory = sorted(test_roles - set(fleet))
    unpaired_ceiling = sorted(set(fleet) - test_roles)
    for role in unpaired_inventory:
        bad(f"دورُ أسطولٍ في الجردِ بلا سقفٍ مُعلَنٍ في `FLEET_GRANTS`: «{role}»")
    for role in unpaired_ceiling:
        bad(f"سقفُ أسطولٍ بلا اسمٍ في جردِ `TEST_FLEET_ROLES`: «{role}»")
    for role, (_auds, reason) in sorted(fleet.items()):
        if len(reason.strip()) < 20:
            bad(f"سقفُ أسطولٍ بلا سببٍ مكتوبٍ — والصفُّ بلا سببٍ يُقرأُ إذناً: «{role}»")
        if role in grants:
            bad(f"اسمٌ واحدٌ في العالمَينِ: «{role}» مُعلَنٌ أسطولاً وإنتاجاً معاً")
    if not unpaired_inventory and not unpaired_ceiling:
        ok(
            f"جردُ الأسطولِ وسقفُهُ مُنسَدّانِ — {len(fleet)} دوراً، كلٌّ بسببٍ مكتوبٍ ولا اسمَ في العالمَينِ"
        )

fleet_site_violations = []
fleet_sites = 0
for path in TS_FILES:
    if not is_test_file(path):
        continue
    src = strip_comments(read(path))
    for m in re.finditer(r"createServiceRequestSigner\(\s*\{", src):
        body = balanced_object(src, m.end() - 1)
        if body is None:
            continue
        role_m = re.search(r'serviceName:\s*"([^"]+)"', body)
        aud_m = re.search(r'audience:\s*"([^"]+)"', body)
        if role_m is None or role_m.group(1) not in fleet:
            continue
        fleet_sites += 1
        if aud_m is None:
            continue
        auds = fleet[role_m.group(1)][0]
        if auds != "any-audience" and aud_m.group(1) not in auds:
            fleet_site_violations.append(
                f"«{role_m.group(1)}» يُوقِّعُ لـ«{aud_m.group(1)}» ولا جمهورَ لهُ عليهِ @ {path}"
            )
if fleet_site_violations:
    for v in sorted(set(fleet_site_violations)):
        bad("موضعُ توقيعٍ اختباريٌّ خارجَ سقفِ جمهورِهِ: " + v)
elif fleet:
    ok(f"كلُّ موضعِ توقيعٍ اختباريٍّ بدورِ أسطولٍ داخلَ جمهورِهِ المُعلَنِ — {fleet_sites} موضعاً")

# ── البابُ 9: الإنفاذُ حيٌّ في المُوقِّعِ، والبدائيُّ مُسَيَّجٌ ─────────────
#
# البابُ 4 ساكنٌ: يقرأُ ما كُتِبَ في جذرِ تركيبٍ. ودورٌ يُمرَّرُ وسيطاً أو
# صلاحيّاتٌ تأتي من `options` لا يراهُما أصلاً — وقد قِيسَ ذلكَ: الإنفاذُ الحيُّ
# كشفَ أدواراً (`driver-exit-gate` · `negotiation-exit-gate`) لم يرَها الحارسُ
# الساكنُ في أيِّ دفعةٍ سابقةٍ. فالإنفاذُ في زمنِ التشغيلِ شرطٌ، وهذا البابُ
# يحرسُ **وجودَهُ**: حذفُ النداءِ من `createServiceRequestSigner` يُسقِطُ
# الدفعةَ بلا انتظارِ اختبارٍ.
#
# وأمّا البدائيُّ (`mintServiceToken` · `serviceAuthHeaders`) فيبقى حرّاً
# بقصدٍ — فالاختبارُ السلبيُّ يحتاجُ رمزاً زائدَ الصلاحيّةِ ليُقاسَ رفضُ الحدِّ،
# ولو أُنفِذَتِ المصفوفةُ فيهِ لَاستحالَ القياسُ ولَصارتِ الخضرةُ عمىً. ولئلّا
# يصيرَ بذلكَ **باباً خلفيّاً للإنتاجِ** يُسَيَّجُ ساكناً هنا: لا ذكرَ لهُ في
# ملفٍّ إنتاجيٍّ خارجَ `packages/service-auth/`.
OUTBOUND = "packages/service-auth/src/outbound.ts"
if not os.path.exists(OUTBOUND):
    bad(f"لم يُوجَدْ {OUTBOUND} — عميَ البابُ 9")
else:
    outbound_src = strip_comments(read(OUTBOUND))
    signer_fn = re.search(
        r"export function createServiceRequestSigner\((.*?)\n\}", outbound_src, re.S
    )
    if signer_fn is None:
        bad("لم يُقرأْ جسمُ `createServiceRequestSigner` — عميَ البابُ 9")
    elif "assertSignerComposition(" not in signer_fn.group(1):
        bad(
            "`createServiceRequestSigner` لا يُنادي `assertSignerComposition` — "
            "الإنفاذُ عادَ ساكناً وحدَهُ، والساكنُ لا يرى دوراً يُمرَّرُ وسيطاً"
        )
    elif "@wasla/authz-policy" not in outbound_src:
        bad("`assertSignerComposition` غيرُ مُستورَدٍ من `@wasla/authz-policy` في المُوقِّعِ")
    else:
        ok("الإنفاذُ حيٌّ في `createServiceRequestSigner` — `assertSignerComposition` مُنادىً لا مُعلَّقاً")

    sa_pkg = json.loads(read("packages/service-auth/package.json"))
    if "@wasla/authz-policy" not in sa_pkg.get("dependencies", {}):
        bad(
            "`@wasla/authz-policy` ليست في `dependencies` لـ`@wasla/service-auth` — "
            "شفرةُ إنتاجٍ تستوردُ ما لا يُثبِّتُهُ العقدُ (`RISK-0043`)"
        )
    else:
        ok("تبعيّةُ الإنفاذِ مُعلَنةٌ في `dependencies` لا في `devDependencies`")

primitive_leaks = []
for path in TS_FILES:
    if path.startswith("packages/service-auth/") or is_test_file(path):
        continue
    src = strip_comments(read(path))
    for name in ("mintServiceToken", "serviceAuthHeaders"):
        if re.search(rf"\b{name}\b", src):
            primitive_leaks.append(f"{name} @ {path}")
if primitive_leaks:
    for v in sorted(set(primitive_leaks)):
        bad(
            "بدائيُّ الإصدارِ مذكورٌ في ملفٍّ إنتاجيٍّ خارجَ `packages/service-auth/` — "
            "بابٌ خلفيٌّ يتجاوزُ إنفاذَ المصفوفةِ: " + v
        )
else:
    ok(
        "بدائيُّ الإصدارِ مُسَيَّجٌ — لا ذكرَ لـ`mintServiceToken` ولا `serviceAuthHeaders` "
        "في ملفٍّ إنتاجيٍّ خارجَ حزمةِ التوقيعِ"
    )

print("\n".join(out))
PY
)"
MEASURE_RC=$?

if (( MEASURE_RC != 0 )); then
  bad "تعذَّرَ القياسُ (python3 أعادَ $MEASURE_RC) — والقياسُ المتعذِّرُ لا يُقرأُ نجاحاً"
else
  while IFS=$'\t' read -r verdict message; do
    [[ -z "$verdict" ]] && continue
    case "$verdict" in
      OK) ok "$message" ;;
      BAD) bad "$message" ;;
      *) bad "سطرٌ غيرُ مفهومٍ من القياسِ: $verdict $message" ;;
    esac
  done <<< "$MEASURE_OUT"
fi

if (( FAIL )); then
  printf '\n%s✗ حارسُ مصفوفةِ التفويضِ (M1-05): إخفاق.%s\n' "$RED" "$RST"
  printf '  اقرأ: %s · docs/15-decisions/ADR-027-authorization-policy-matrix.md\n\n' "$DOC"
  exit 1
fi

printf '\n%s✓ حارسُ مصفوفةِ التفويضِ (M1-05): كلُّ الأبوابِ نجحت.%s\n' "$GRN" "$RST"
exit 0

#!/usr/bin/env bash
# validate-app-port-wiring.sh — حارسُ تركيبِ المنافذِ في الجذرِ (M0-41 · الفحصُ 17).
#
# السّؤالُ الذي يجيبُ عنهُ هذا الفحصُ واحدٌ ومحدودٌ:
#
#   **منفذٌ اختياريٌّ يقبلُهُ مصنعُ التطبيقِ — أيُركِّبُهُ جذرُ الإنتاجِ فعلاً،
#   أم يبقى غائباً فيُجيبُ مسارُهُ 500 بينما اختباراتُهُ خضراءُ؟**
#
# ولِمَ وُجِدَ هذا الحارسُ — قياسٌ لا تخوُّفٌ (`RISK-0044` · 2026-09-15):
# المسارُ الرابعَ عشرَ في `services/delivery` (إعادةُ صفٍّ مسمومٍ · ADR-026 §4.24)
# أُعلِنَ «قائماً» في اللوحةِ والخارطةِ وسجلِّ التنفيذِ، **وكانَ يُجيبُ 500 لكلِّ
# مُشغِّلٍ** نحوَ أربعٍ وعشرينَ ساعةً: `relayRequeuePort` لم يُركَّبْ لا في
# `services/delivery/src/http/server.ts` ولا في `packages/delivery-e2e/src/harness.ts`.
# **وخمسةٌ وثلاثونَ اختباراً كانت خضراءَ** لأنَّ كلَّ اختبارٍ يبني التطبيقَ
# بتبعيّاتِهِ بنفسِهِ — فاختبارٌ يبني تبعيّاتِهِ **لا يشهدُ على تركيبِ الجذرِ**،
# وهذا صنفٌ كاملٌ من العطبِ لم يكنْ لهُ في المستودعِ حارسٌ واحدٌ.
#
# الأبوابُ الخمسةُ:
#   1) كلُّ مصنعِ تطبيقٍ لهُ جذرُ تركيبٍ إنتاجيٌّ (`server.ts`) يُقرأُ.
#   2) كلُّ منفذٍ اختياريٍّ في عقدِ المصنعِ **مُركَّبٌ في الجذرِ** — أو مُستثنىً
#      بسببٍ مكتوبٍ في السجلِّ المُعلَنِ.
#   3) كلُّ منفذٍ رُكِّبَ في الجذرِ **مُركَّبٌ في مِعْوانِ بوّابةِ الخروجِ** إن
#      وُجِدَ لها معوانٌ — وإلّا فبوّابةُ الخروجِ تُجيزُ ما لا يعملُ إنتاجاً.
#   4) لا استثناءَ ميتاً في السجلِّ: صفٌّ يُبارِكُ منفذاً صارَ مُركَّباً (أو لا
#      وجودَ لهُ) **يُسقِطُ الفحصَ** — وإلّا صارَ السجلُّ يُبارِكُ ما لا يُقاسُ.
#   5) الأرقامُ المنشورةُ في الوثيقةِ تُطابِقُ القياسَ — تُقاسُ ولا تُكتَبُ.
#
# ولِمَ لا يكفي فحصُ الأنواعِ (`tsc`): المنفذُ **اختياريٌّ بالتعريفِ**
# (`readonly x?: T`)، فغيابُهُ عن الجذرِ **نوعٌ صحيحٌ تماماً**. والاختياريّةُ
# نفسُها ليست عطباً — لها أسبابٌ مشروعةٌ (تبعيّةٌ خارجيّةٌ تُعطَّلُ برايةٍ) — ولذلكَ
# الحارسُ **لا يُحرِّمُ الغيابَ بل يُحرِّمُ الغيابَ الصامتَ**: يُطالِبُ بسببٍ
# مكتوبٍ في سجلٍّ واحدٍ، ويُسقِطُ السببَ إذا مات.
#
# المرجع: docs/12-testing/APP_PORT_WIRING.md · RISK-0044 · M0-41
#
#   bash scripts/checks/validate-app-port-wiring.sh
#
# لا شبكةَ ولا git: قراءةُ قرصٍ محضةٌ — فلا تخطّيَ لهُ، مرورٌ أو إخفاقٌ.
set -uo pipefail

cd "$(dirname "$0")/../.." || { echo "تعذّر الوصول إلى جذر المستودع" >&2; exit 1; }

DOC="docs/12-testing/APP_PORT_WIRING.md"

python3 - "$DOC" <<'PY'
import glob
import os
import re
import sys

RED = "\033[31m"
GRN = "\033[32m"
DIM = "\033[2m"
RST = "\033[0m"

doc_path = sys.argv[1]
fail = 0


def ok(msg: str) -> None:
    print(f"  {GRN}✓{RST} {msg}")


def bad(msg: str) -> None:
    global fail
    print(f"  {RED}✗{RST} {msg}")
    fail = 1


# ── قراءةُ العقودِ ───────────────────────────────────────────────────────────
# مصنعُ التطبيقِ يُسمّى في المستودعِ بصيغتَينِ (`createXApp` و`buildXHttpApp`)،
# فالحارسُ يقرأُ الصيغتَينِ ولا يفترضُ واحدةً — وخدمةٌ بلا مصنعٍ مقروءٍ **تُسقِطُ
# الفحصَ** لا تُتخطّى، لأنَّ صمتَ الحارسِ عن خدمةٍ هوَ بالضبطِ العطبُ الذي وُجِدَ
# لأجلِهِ.
FACTORY = re.compile(
    r"export\s+function\s+((?:create|build)\w*App)\s*\(\s*(\w+)\s*:\s*(\w+)\s*(?:=\s*\{\s*\})?\s*,?\s*\)",
    re.S,
)


def _body_in(src: str, name: str) -> str | None:
    m = re.search(r"export interface " + re.escape(name) + r"\s*\{(.*?)\n\}", src, re.S)
    return None if m is None else m.group(1)


def _resolve_import(app_path: str, src: str, type_name: str) -> str | None:
    """مسارُ الملفِّ الذي يُستورَدُ منهُ عقدٌ — خطوةٌ واحدةٌ لا سلسلةٌ.

    ولِمَ: أربعُ خدماتٍ تُغلِّفُ تبعيّاتِها في عقدٍ **مُستورَدٍ**
    (`deps: UseCaseDeps`)، فقارئٌ لا يتبعُ الاستيرادَ كانَ سيُعلِنُ «لا منفذَ
    اختياريَّ» عن خدمةٍ لم يقرأْ عقدَها — وهذا أخطرُ من الإخفاقِ: صمتٌ يُقرأُ
    براءةً.
    """
    for spec in re.findall(
        r"import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+\"([^\"]+)\"", src, re.S
    ):
        members, source = spec
        names = {
            n.strip().split(" as ")[-1].strip().lstrip("type ").strip()
            for n in members.split(",")
        }
        if type_name not in names or not source.startswith("."):
            continue
        base = os.path.normpath(os.path.join(os.path.dirname(app_path), source))
        for candidate in (f"{base}.ts", os.path.join(base, "index.ts")):
            if os.path.isfile(candidate):
                return candidate
    return None


def interface_body(app_path: str, src: str, name: str) -> str | None:
    local = _body_in(src, name)
    if local is not None:
        return local
    target = _resolve_import(app_path, src, name)
    if target is None:
        return None
    return _body_in(open(target, encoding="utf-8").read(), name)


def collect_ports(
    app_path: str, src: str, type_name: str, depth: int = 3
) -> list[str] | None:
    """منافذُ العقدِ وعقودِهِ الداخليّةِ — طبقةً واحدةً تحتَ الجذرِ.

    ولِمَ الطبقةُ الثانيةُ: أربعُ خدماتٍ تُغلِّفُ تبعيّاتِها في حقلٍ
    (`options.deps` · `options.services`)، فقارئٌ لا يهبطُ طبقةً كانَ سيصمتُ
    عنها كلِّها — وصمتُ الحارسِ عن خدمةٍ هوَ العطبُ نفسُهُ.
    """
    body = interface_body(app_path, src, type_name)
    if body is None:
        return None
    ports: list[str] = []
    # `readonly` اختياريٌّ في القراءةِ: عقودُ التبعيّاتِ في المستودعِ تُكتَبُ
    # بالصيغتَينِ، وقارئٌ يُشترِطُ الكلمةَ كانَ سيصمتُ عن عقودٍ كاملةٍ.
    for name, tname in re.findall(
        r"(?:readonly\s+)?(\w+)\??\s*:\s*([\w<>\[\] |]+);", body
    ):
        tname = tname.strip()
        optional = re.search(
            r"(?:readonly\s+)?" + re.escape(name) + r"\?\s*:", body
        ) is not None
        bare = tname.replace("| undefined", "").strip()
        if optional and (name.endswith("Port") or bare.endswith("Port")):
            ports.append(name)
            continue
        if depth > 1 and interface_body(app_path, src, bare) is not None:
            nested_src = src
            nested_path = app_path
            if _body_in(src, bare) is None:
                nested_path = _resolve_import(app_path, src, bare) or app_path
                nested_src = open(nested_path, encoding="utf-8").read()
            nested = collect_ports(nested_path, nested_src, bare, depth - 1)
            if nested:
                ports.extend(nested)
    return ports

services = {}
for app_path in sorted(glob.glob("services/*/src/http/app.ts")):
    service = app_path.split("/")[1]
    src = open(app_path, encoding="utf-8").read()
    m = FACTORY.search(src)
    if m is None:
        bad(f"البابُ 1: `{app_path}` لا يُقرأُ لهُ مصنعُ تطبيقٍ — الحارسُ لا يصمتُ عن خدمةٍ")
        continue
    factory, _param, typ = m.groups()
    if interface_body(app_path, src, typ) is None:
        bad(f"البابُ 1: عقدُ `{typ}` في `{app_path}` لا يُقرأُ — لا قياسَ على غيابٍ")
        continue
    # منفذٌ: حقلٌ **اختياريٌّ** اسمُهُ أو نوعُهُ ينتهي بـ`Port` — وهوَ الصنفُ
    # الذي يُجيبُ غيابُهُ 500 لا الصنفُ الذي يُجيبُ غيابُهُ بسلوكٍ افتراضيٍّ.
    optional_ports = collect_ports(app_path, src, typ)
    services[service] = {
        "app": app_path,
        "factory": factory,
        "type": typ,
        "ports": optional_ports,
    }

if not services:
    bad("البابُ 1: لا خدمةَ ذاتُ مصنعِ تطبيقٍ وُجِدَت — قياسٌ على فراغٍ لا يُقبَلُ")

for service, info in services.items():
    root = f"services/{service}/src/http/server.ts"
    if not os.path.isfile(root):
        bad(f"البابُ 1: `{info['app']}` بلا جذرِ تركيبٍ `{root}`")
    info["root"] = root

if fail == 0:
    ok(
        "البابُ 1: كلُّ مصنعِ تطبيقٍ مقروءٌ ولهُ جذرُ تركيبٍ "
        f"({len(services)} خدمةً)"
    )

# ── السجلُّ المُعلَنُ ────────────────────────────────────────────────────────
if not os.path.isfile(doc_path):
    bad(f"السجلُّ `{doc_path}` غيرُ موجودٍ — لا استثناءَ بلا سجلٍّ مُعلَنٍ")
    print(f"\n{RED}✗ تركيبُ المنافذِ: إخفاقٌ.{RST}")
    sys.exit(1)

doc = open(doc_path, encoding="utf-8").read()

def block(doc: str, name: str) -> str:
    m = re.search(
        r"<!--\s*" + name + r":start\s*-->(.*?)<!--\s*" + name + r":end\s*-->", doc, re.S
    )
    return m.group(1) if m else ""


exempt_block = block(doc, "app-port-exemptions")
counts_block = block(doc, "app-port-counts")
if not exempt_block or not counts_block:
    bad("السجلُّ بلا كتلتَيهِ المقروءتَينِ (`app-port-exemptions` · `app-port-counts`)")

exemptions = {}
for raw in exempt_block.splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or line.startswith("```"):
        continue
    parts = [p.strip() for p in line.split("|")]
    if len(parts) < 4:
        bad(f"صفُّ استثناءٍ لا يُقرأُ (أربعةُ حقولٍ مطلوبةٌ): `{line}`")
        continue
    service, port, scope, reason = parts[0], parts[1], parts[2], "|".join(parts[3:])
    if scope not in ("scope:root", "scope:harness"):
        bad(f"نطاقُ استثناءٍ مجهولٌ في `{line}` — `scope:root` أو `scope:harness`")
        continue
    if not reason.startswith("reason:") or len(reason) < 48:
        bad(
            f"استثناءُ `{service}.{port}` بلا سببٍ مكتوبٍ كافٍ — "
            "الاستثناءُ بلا سببٍ هوَ تعميةٌ بمظهرِ سجلٍّ"
        )
        continue
    exemptions[(service, port, scope)] = reason

# ── البابُ 2: المنفذُ الاختياريُّ مُركَّبٌ في الجذرِ ─────────────────────────
def wired(src: str, port: str) -> bool:
    # التركيبُ يُقرأُ مفتاحاً في عقدِ التبعيّاتِ (`port: x`) أو اختصاراً (`port,`)
    # أو نشراً شرطيّاً (`{ port: x }`) — والأخيرُ صيغةٌ قائمةٌ في المستودعِ.
    return re.search(r"(?<![\w.])" + re.escape(port) + r"\s*(?::|,|\})", src) is not None


measured = {"ports": 0, "root_wired": 0, "harness_wired": 0, "harnesses": 0}
used_exemptions = set()

for service, info in sorted(services.items()):
    if not os.path.isfile(info["root"]):
        continue
    root_src = open(info["root"], encoding="utf-8").read()
    for port in info["ports"]:
        measured["ports"] += 1
        if wired(root_src, port):
            measured["root_wired"] += 1
            continue
        key = (service, port, "scope:root")
        if key in exemptions:
            used_exemptions.add(key)
            continue
        bad(
            f"البابُ 2: `{service}` يقبلُ `{port}` ولا يُركِّبُهُ جذرُهُ "
            f"(`{info['root']}`) ولا سببَ في السجلِّ — مسارُهُ يُجيبُ 500 إنتاجاً"
        )

if fail == 0:
    ok(
        f"البابُ 2: كلُّ منفذٍ اختياريٍّ مُركَّبٌ في جذرِهِ ({measured['root_wired']}"
        f"/{measured['ports']}) أو مُستثنىً بسببٍ مكتوبٍ"
    )

# ── البابُ 3: مِعْوانُ بوّابةِ الخروجِ يُطابِقُ الجذرَ ──────────────────────
def harness_for(service: str) -> str | None:
    # أسماءُ حزمِ بوّاباتِ الخروجِ مفردةٌ وأسماءُ الخدماتِ جمعٌ في بعضِها،
    # فتُجرَّبُ الصيغتانِ — ولا تُخترَعُ حزمةٌ غيرُ موجودةٍ.
    for base in (service, service.rstrip("s")):
        path = f"packages/{base}-e2e/src/harness.ts"
        if os.path.isfile(path):
            return path
    return None


door3_checked = 0
for service, info in sorted(services.items()):
    if not os.path.isfile(info["root"]):
        continue
    harness = harness_for(service)
    if harness is None:
        continue
    measured["harnesses"] += 1
    root_src = open(info["root"], encoding="utf-8").read()
    harness_src = open(harness, encoding="utf-8").read()
    for port in info["ports"]:
        if not wired(root_src, port):
            continue
        door3_checked += 1
        if wired(harness_src, port):
            measured["harness_wired"] += 1
            continue
        key = (service, port, "scope:harness")
        if key in exemptions:
            used_exemptions.add(key)
            continue
        bad(
            f"البابُ 3: `{port}` مُركَّبٌ في جذرِ `{service}` وغائبٌ عن "
            f"`{harness}` — بوّابةُ الخروجِ تُجيزُ تركيباً لا يُشبِهُ الإنتاجَ"
        )

if fail == 0:
    ok(
        f"البابُ 3: مِعْوانُ كلِّ بوّابةِ خروجٍ يُطابِقُ جذرَهُ "
        f"({measured['harness_wired']}/{door3_checked} منفذاً · "
        f"{measured['harnesses']} معواناً)"
    )

# ── البابُ 4: لا استثناءَ ميتاً ─────────────────────────────────────────────
dead = sorted(set(exemptions) - used_exemptions)
for service, port, scope in dead:
    bad(
        f"البابُ 4: استثناءٌ ميتٌ `{service}.{port}` ({scope}) — المنفذُ صارَ "
        "مُركَّباً أو لا وجودَ لهُ، والسجلُّ يُبارِكُ ما لا يُقاسُ"
    )
if not dead:
    ok(f"البابُ 4: لا استثناءَ ميتاً في السجلِّ ({len(exemptions)} استثناءً حيّاً)")

# ── البابُ 5: الأرقامُ المنشورةُ تُطابِقُ القياسَ ───────────────────────────
published = {}
for m in re.finditer(r"(\w+)\s*=\s*(\d+)", counts_block):
    published[m.group(1)] = int(m.group(2))

expected = {
    "SERVICES_SCANNED": len(services),
    "OPTIONAL_PORTS": measured["ports"],
    "ROOT_WIRED_PORTS": measured["root_wired"],
    "HARNESSES_SCANNED": measured["harnesses"],
    "EXEMPTIONS": len(exemptions),
}
for key, value in expected.items():
    if key not in published:
        bad(f"البابُ 5: `{key}` غيرُ منشورٍ في السجلِّ — رقمٌ مفقودٌ يُرى")
    elif published[key] != value:
        bad(
            f"البابُ 5: `{key}` منشورٌ {published[key]} والقياسُ {value} — "
            "الوثيقةُ تُخالِفُ الشجرةَ"
        )
if fail == 0:
    ok("البابُ 5: كلُّ رقمٍ منشورٍ يُطابِقُ القياسَ (يُقاسُ ولا يُكتَبُ)")

print(f"{DIM}  المرجع: {doc_path} · RISK-0044 · M0-41{RST}")

if fail:
    print(f"\n{RED}✗ تركيبُ المنافذِ: إخفاقٌ — الدفعُ مرفوضٌ.{RST}")
    sys.exit(1)

print(f"\n{GRN}✓ تركيبُ المنافذِ: كلُّ الأبوابِ نجحت.{RST}")
PY

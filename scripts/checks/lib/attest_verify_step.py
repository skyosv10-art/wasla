#!/usr/bin/env python3
"""CLM-0576 — يقيسُ خطوةَ التحقّقِ الموجبةَ في وظيفةِ image-supply-chain من ci.yml.

**صيغةٌ ضيّقةٌ معلَنة، وقرارٌ fail-closed.** لا يحاولُ المحلّلُ تفسيرَ تراكيبِ Bash؛ بل
يقبلُ خطوةً واحدةً بشكلٍ واحدٍ معلَن، ويرفضُ كلَّ ما سواه:

  - name: "<أيُّ اسم>"
    shell: bash                                   # حرفيًّا
    env:                                          # مفتاحانِ فقط
      GH_TOKEN: ${{ github.token }}               # إلزاميّ
      ATTEST_EVIDENCE_DIR: <مسار>                 # اختياريّ
    run: |
      set -euo pipefail                           # أوّلُ أمرٍ، إلزاميّ
      mkdir -p artifacts/attestation-verify       # اختياريّ
      bash scripts/ci/verify-sbom-attestations.sh "${{ github.repository }}" .github/workflows/ci.yml \\
        artifacts/sbom/pass1.cdx.json artifacts/sbom/pass2.cdx.json \\
        [2>&1 | tee artifacts/attestation-verify/<ملف>.txt]

كلُّ مفتاحٍ مرّةً واحدة: تكرارُ run أو env أو shell أو غيرِها (أو متغيّرٍ داخلَ env) رفض —
لأنّ YAML يأخذُ الأخيرَ فيُنفَّذُ غيرُ ما قِيس.
لا `if:` ولا `continue-on-error` ولا `working-directory` ولا مفاتيحَ أخرى في الخطوة. أيُّ
ذكرٍ تنفيذيٍّ (خارجَ التعليقات) لـ scripts/ci/verify-sbom-attestations.sh في أيِّ خطوةٍ من
الوظيفةِ لا يطابقُ سطرَ الاستدعاءِ المعلَنَ حرفيًّا — `true && bash …`، `bash … && true; true`،
`bash … || true`، `if bash …`، `echo …`، وسيطٌ ناقص — **صيغةٌ غيرُ مدعومة ⇒ رفض**، لأنّ
المشغّلاتِ الشرطيّةَ قد تحوّلُ فشلَ التحقّقِ نجاحًا نهائيًّا. `| tee` مقبولٌ لأنّ
`set -o pipefail` إلزاميٌّ قبلَه.

الاستعمال: attest_verify_step.py <ci.yml>
المخرَج: سطرُ `OK step=<n>` عندَ القبول، أو سطرٌ أو أكثرُ `REASON <code> <نص>` عندَ الرفض.
لا يُعَدُّ غيرُ ذلك قبولًا (الحارسُ fail-closed): خطأٌ في المحلّلِ أو مخرَجٌ بلا OK ⇒ رفض.
"""
import re
import sys

SCRIPT = "scripts/ci/verify-sbom-attestations.sh"
# ذكرُ المسارِ كاملًا بحدٍّ يسارٍ (فلا يطابقُ scripts/ci/test-verify-sbom-attestations*.sh)
MENTION_RE = re.compile(r"(?<![A-Za-z0-9_./-])" + re.escape(SCRIPT) + r"(?![A-Za-z0-9_.-])")
CALL_RE = re.compile(
    r"^bash " + re.escape(SCRIPT)
    + r' "\$\{\{ github\.repository \}\}" \.github/workflows/ci\.yml'
    + r" artifacts/sbom/pass1\.cdx\.json artifacts/sbom/pass2\.cdx\.json"
    + r"(?: 2>&1 \| tee artifacts/attestation-verify/[A-Za-z0-9._-]+\.txt)?$"
)
ALLOWED_PRE = ("set -euo pipefail", "mkdir -p artifacts/attestation-verify")
TOKEN_RE = re.compile(r"^\$\{\{\s*github\.token\s*\}\}$")
ALLOWED_ENV = {"GH_TOKEN", "ATTEST_EVIDENCE_DIR"}
ALLOWED_STEP_KEYS = {"name", "shell", "env", "run"}


def indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def strip_shell_comment(line: str) -> str:
    """يحذفُ تعليقَ shell: `#` في أوّلِ كلمةٍ خارجَ علاماتِ الاقتباس."""
    out, q = [], None
    for i, ch in enumerate(line):
        if q:
            if ch == q:
                q = None
        elif ch in ("'", '"'):
            q = ch
        elif ch == "#" and (i == 0 or line[i - 1] in " \t"):
            break
        out.append(ch)
    return "".join(out).rstrip()


def logical_lines(run_lines):
    """أسطرٌ منطقيّة: بلا تعليقات، مع ضمِّ `\\`، ومسافاتٌ موحَّدة."""
    buf = ""
    for raw in run_lines:
        s = raw.strip()
        if not s or s.startswith("#"):
            if buf:
                yield " ".join(buf.split())
                buf = ""
            continue
        s = strip_shell_comment(s)
        if s.endswith("\\"):
            buf += s[:-1] + " "
            continue
        yield " ".join((buf + s).split())
        buf = ""
    if buf:
        yield " ".join(buf.split())


def job_block(text: str, job: str):
    out, on = [], False
    for ln in text.splitlines():
        if re.match(r"^  " + re.escape(job) + r":\s*$", ln):
            on = True
            continue
        if on and (re.match(r"^  [A-Za-z0-9_-]+:\s*$", ln) or re.match(r"^\S", ln)):
            break
        if on:
            out.append(ln)
    return out


def split_steps(job_lines):
    head, steps, cur, in_steps = [], [], None, False
    for ln in job_lines:
        if re.match(r"^    steps:\s*$", ln):
            in_steps = True
            continue
        if not in_steps:
            head.append(ln)
            continue
        if re.match(r"^      - ", ln):
            if cur is not None:
                steps.append(cur)
            cur = [ln]
        elif cur is not None:
            cur.append(ln)
    if cur is not None:
        steps.append(cur)
    return head, steps


def parse_step(step):
    """يعيدُ (مفاتيح, run, env, مكرَّرات) — المفاتيحُ على عمقِ 8، بلا تعليقاتِ YAML.

    كلُّ مفتاحٍ يُتعقَّبُ **قبلَ** إدخالِه في القاموس: مفتاحُ خطوةٍ مكرَّرٌ (run · env ·
    shell · name · if …) أو متغيّرُ بيئةٍ مكرَّرٌ داخلَ env يُسجَّلُ في «مكرَّرات» ولا
    يُستبدَلُ به السابقُ بصمت — لأنّ YAML يأخذُ الأخيرَ فتُنفَّذُ كتلةٌ غيرُ التي قِيست.
    """
    norm = ["        " + step[0][8:]] + step[1:]
    keys, run, env, dups = {}, [], {}, []
    mode = None
    for ln in norm:
        if mode == "run":
            if ln.strip() == "" or indent(ln) > 8:
                run.append(ln)
                continue
            mode = None
        if mode == "env":
            if ln.strip() == "" or ln.lstrip().startswith("#"):
                continue
            if indent(ln) > 8:
                m = re.match(r"^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$", ln)
                if m:
                    if m.group(1) in env:
                        dups.append("env." + m.group(1))
                    env[m.group(1)] = strip_shell_comment(m.group(2)) if " #" in m.group(2) else m.group(2)
                else:
                    env["<unparsed>"] = ln.strip()
                continue
            mode = None
        if ln.strip() == "" or ln.lstrip().startswith("#"):
            continue
        m = re.match(r"^        ([A-Za-z0-9_-]+):\s*(.*?)\s*$", ln)
        if not m:
            keys.setdefault("<unparsed>", ln.strip())
            continue
        k, v = m.group(1), m.group(2)
        if k in keys:
            dups.append(k)
        keys[k] = v
        if k == "run":
            if re.match(r"^[|>][-+]?\s*(#.*)?$", v):
                mode = "run"
            elif v:
                run.append(v)
        elif k == "env" and (v == "" or v.startswith("#")):
            mode = "env"
    return keys, run, env, dups


def main() -> int:
    text = open(sys.argv[1], encoding="utf-8").read()
    head, steps = split_steps(job_block(text, "image-supply-chain"))
    reasons = []

    def reason(code, msg):
        reasons.append(f"REASON {code} {msg}")

    # الوظيفةُ نفسُها: `if:` على مستوى الوظيفةِ قد يتخطّاها فتُعَدُّ «ناجحة».
    for ln in head:
        if re.match(r"^    if:", ln):
            reason("job-if", "image-supply-chain مشروطةٌ بـ if: على مستوى الوظيفة — قد تُتخطّى فيُعَدُّ تخطّيها نجاحًا.")

    positive, bad_calls, dup_steps = [], [], []
    for idx, st in enumerate(steps):
        keys, run, env, dups = parse_step(st)
        lines = list(logical_lines(run))
        mentions = [l for l in lines if MENTION_RE.search(l)]
        if not mentions:
            continue
        if dups:
            # fail-closed: مفاتيحُ مكرَّرةٌ تجعلُ ما يُنفَّذُ غيرَ ما يُقاس — لا تُقاسُ الخطوةُ بعدَها.
            dup_steps.append((idx, sorted(set(dups))))
            continue
        exact = [l for l in mentions if CALL_RE.match(l)]
        if len(exact) == 1 and len(mentions) == 1:
            positive.append((idx, keys, lines, env, exact[0]))
        else:
            bad_calls.append((idx, [l for l in mentions if not CALL_RE.match(l)] or mentions))

    for idx, ks in dup_steps:
        reason("dup-key",
               f"مفتاحُ YAML مكرَّرٌ في خطوةِ التحقّق {idx}: {', '.join(ks)} — YAML يأخذُ الأخيرَ ويُسقطُ السابقَ، "
               "فيُنفَّذُ غيرُ ما يُقاس. يُكتَبُ كلُّ مفتاحٍ مرّةً واحدة.")

    for idx, ls in bad_calls:
        for l in ls:
            reason("unsupported-call",
                   f"استدعاءُ {SCRIPT} بصيغةٍ غيرِ مدعومةٍ في الخطوة {idx}: «{l}» — "
                   "مشغّلٌ شرطيٌّ أو تركيبٌ (&& · || · ; · if · echo · وسيطٌ مختلف) قد يحوّلُ فشلَ التحقّقِ "
                   "نجاحًا نهائيًّا. المقبولُ سطرُ الاستدعاءِ المعلَنُ وحدَه.")

    if not positive and not bad_calls and not dup_steps:
        reason("no-call",
               f"لا استدعاءَ تنفيذيَّ لـ {SCRIPT} داخلَ run: في خطوةٍ من image-supply-chain — "
               "ظهورُ اسمِه في تعليقِ YAML أو shell أو نصٍّ ليس تحقّقًا (CLM-0576).")
    if len(positive) > 1:
        reason("multi-step", f"أكثرُ من خطوةٍ تستدعي {SCRIPT} ({len(positive)}) — الصيغةُ المعلَنةُ خطوةٌ واحدة.")

    if len(positive) == 1 and not bad_calls and not dup_steps:
        idx, keys, lines, env, call = positive[0]
        extra_keys = sorted(set(keys) - ALLOWED_STEP_KEYS)
        if extra_keys:
            reason("step-keys",
                   f"خطوةُ التحقّقِ الموجبةُ تحملُ مفاتيحَ غيرَ مدعومة: {', '.join(extra_keys)} — "
                   "(if · continue-on-error · working-directory …) قد تتخطّاها أو تُقنِّعُ فشلَها.")
        if keys.get("shell") != "bash":
            reason("shell", f"خطوةُ التحقّقِ الموجبةُ بلا «shell: bash» حرفيًّا (القيمة: {keys.get('shell', '<غائب>')!r}).")
        tok = env.get("GH_TOKEN")
        if tok is None or not TOKEN_RE.match(tok):
            reason("token",
                   "GH_TOKEN: ${{ github.token }} غائبٌ عن خطوةِ التحقّقِ الموجبةِ نفسِها (verify-sbom-attestations.sh) — "
                   "وجودُه في خطوةٍ أخرى لا يُغني؛ gh يفشلُ بلا مصادقة (CLM-0576).")
        extra_env = sorted(set(env) - ALLOWED_ENV)
        if extra_env:
            reason("env-keys",
                   f"متغيّراتُ بيئةٍ غيرُ مدعومةٍ في خطوةِ التحقّقِ الموجبة: {', '.join(extra_env)} — "
                   "(مثلُ BASH_ENV) قد تغيّرُ سلوكَ الصدفة.")
        pre = lines[: lines.index(call)]
        post = lines[lines.index(call) + 1:]
        if not pre or pre[0] != "set -euo pipefail":
            reason("strict-mode", "أوّلُ أمرٍ في خطوةِ التحقّقِ الموجبةِ ليس «set -euo pipefail» — بلا pipefail يبتلعُ tee الفشل.")
        for l in pre[1:]:
            if l not in ALLOWED_PRE[1:]:
                reason("extra-line", f"سطرٌ غيرُ مدعومٍ قبلَ الاستدعاءِ في خطوةِ التحقّقِ الموجبة: «{l}».")
        for l in post:
            reason("extra-line", f"سطرٌ غيرُ مدعومٍ بعدَ الاستدعاءِ في خطوةِ التحقّقِ الموجبة: «{l}» — قد يحوّلُ النتيجةَ النهائيّة.")

    if reasons:
        print("\n".join(reasons))
    else:
        print(f"OK step={positive[0][0]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

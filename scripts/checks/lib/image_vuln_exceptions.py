#!/usr/bin/env python3
# image_vuln_exceptions.py — إنفاذُ شروطِ استثناءاتِ بوّابةِ ثغراتِ الصورةِ. (M2-01)
#
# ── العطبُ المحروسُ ────────────────────────────────────────────────────────
# ملفُّ استثناءاتٍ هوَ أسرعُ طريقةٍ لقتلِ بوّابةٍ أمنيّةٍ: يُفتَحُ لحالةٍ واحدةٍ
# مُبرَّرةٍ، ثمَّ يكبرُ سطراً سطراً بلا سببٍ ولا مهلةٍ ولا مالكٍ، فتصيرُ البوّابةُ
# خضراءَ دائماً وهيَ لا تقيسُ شيئاً. فالشروطُ الأربعةُ التاليةُ **مُنفَذةٌ آليّاً**
# ونقصُ أيِّها يُسقِطُ الفحصَ 19 و`scan-image.sh` معاً:
#   1) `paths` غيرُ فارغةٍ — لا استثناءَ عامّاً يسري على الصورةِ كلِّها.
#   2) `expired_at` موجودةٌ · غيرُ منقضيةٍ · ولا تتجاوزُ 90 يوماً من اليومِ.
#   3) `statement` يُسمّي رقمَ خطرٍ (RISK-XXXX) **قائماً غيرَ مُغلَقٍ** في السجلِّ.
#   4) `id` بصيغةِ CVE — لا تعريفاتٍ مُبهَمةً.
#
# ولأنَّ المنطقَ واحدٌ في موضعَينِ (الحارسُ المحلّيُّ · سكربتُ المسحِ في CI) فهوَ
# مكتوبٌ **مرّةً واحدةً** هنا: مصدرانِ للقاعدةِ نفسِها يفترقانِ بصمتٍ.
#
# المرجع: docs/07-security/IMAGE_VULN_EXCEPTIONS.yaml · docs/08-infrastructure/CONTAINER_IMAGES.md §6.2
from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
EXCEPTIONS = ROOT / "docs/07-security/IMAGE_VULN_EXCEPTIONS.yaml"
RISKS = ROOT / "docs/07-security/RISK_REGISTER.md"
MAX_DAYS = 90


def open_risks() -> set[str]:
    """أرقامُ المخاطرِ **المُعلَنةِ سطراً** في السجلِّ وحالتُها ليست `closed`.

    والقياسُ على **سطرِ الإعلانِ** وحدَهُ (`^RISK-XXXX | … status:… |`) لا على أيِّ
    ذِكرٍ في نصٍّ: أوّلُ صياغةٍ لهذا المنطقِ كانت تقبلُ **أيَّ** ظهورٍ للرقمِ في
    أيِّ سطرٍ، فمرَّت حالةُ الطفرةِ «حُذِفَ سطرُ الخطرِ» **خضراءَ** لأنَّ خطراً
    آخرَ يذكرُ الرقمَ في شرحِهِ — أي أنَّ الحارسَ كانَ يقبلُ استثناءً بلا خطرٍ
    مُعلَنٍ. (كشفَتْهُ حزمةُ الطفراتِ لا مراجعةٌ بالعينِ.)
    """
    if not RISKS.is_file():
        return set()
    found: set[str] = set()
    for line in RISKS.read_text(encoding="utf-8").splitlines():
        match = re.match(r"(RISK-\d{4})\s*\|", line)
        if not match:
            continue
        status = re.search(r"status:(\w+)", line)
        if status and status.group(1).lower() == "closed":
            continue
        found.add(match.group(1))
    return found


def validate(today: date | None = None) -> list[str]:
    today = today or date.today()
    if not EXCEPTIONS.is_file():
        return [f"ملفُّ الاستثناءاتِ المُعلَنُ مفقودٌ: {EXCEPTIONS.relative_to(ROOT)}"]

    try:
        data = yaml.safe_load(EXCEPTIONS.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as error:
        return [f"ملفُّ الاستثناءاتِ غيرُ قابلٍ للتحليلِ: {error}"]

    if not isinstance(data, dict):
        return ["ملفُّ الاستثناءاتِ ليسَ خريطةً — بنيةٌ غيرُ مفهومةٍ لا تُقاسُ"]

    problems: list[str] = []
    for key in data:
        if key not in {"vulnerabilities", "misconfigurations", "secrets", "licenses"}:
            problems.append(f"قسمٌ غيرُ معروفٍ في ملفِّ الاستثناءاتِ: «{key}»")
    for key in ("misconfigurations", "secrets", "licenses"):
        if data.get(key):
            problems.append(
                f"قسمُ «{key}» مُستخدَمٌ — هذا الملفُّ لثغراتِ الصورةِ وحدَها في هذهِ الدورةِ"
            )

    risks = open_risks()
    entries = data.get("vulnerabilities") or []
    if not isinstance(entries, list):
        return problems + ["`vulnerabilities` ليسَ قائمةً"]

    for index, entry in enumerate(entries, start=1):
        label = f"مُدخَلٌ {index}"
        if not isinstance(entry, dict):
            problems.append(f"{label}: ليسَ خريطةً")
            continue
        ident = str(entry.get("id") or "")
        label = f"مُدخَلٌ {index} ({ident or 'بلا معرّفٍ'})"
        if not re.fullmatch(r"CVE-\d{4}-\d+", ident):
            problems.append(f"{label}: `id` ليسَ بصيغةِ CVE")

        paths = entry.get("paths")
        if not isinstance(paths, list) or not paths or not all(
            isinstance(item, str) and item.strip() for item in paths
        ):
            problems.append(
                f"{label}: `paths` فارغةٌ أو غائبةٌ — استثناءٌ عامٌّ يُسكِتُ الصورةَ كلَّها"
            )

        statement = str(entry.get("statement") or "").strip()
        if not statement:
            problems.append(f"{label}: `statement` فارغٌ — استثناءٌ بلا سببٍ مُسجَّلٍ")
        else:
            refs = set(re.findall(r"RISK-\d{4}", statement))
            if not refs:
                problems.append(f"{label}: `statement` بلا رقمِ خطرٍ (RISK-XXXX)")
            else:
                for ref in sorted(refs - risks):
                    problems.append(
                        f"{label}: {ref} غيرُ موجودٍ قائماً في RISK_REGISTER.md — "
                        "استثناءٌ بلا مالكٍ ولا دَينٍ مُسجَّلٍ"
                    )

        expiry = entry.get("expired_at")
        if expiry is None:
            problems.append(f"{label}: بلا `expired_at` — استثناءٌ أبديٌّ هوَ تعطيلُ بوّابةٍ")
            continue
        if isinstance(expiry, str):
            try:
                expiry = date.fromisoformat(expiry.strip())
            except ValueError:
                problems.append(f"{label}: `expired_at` ليسَ تاريخاً yyyy-mm-dd: «{expiry}»")
                continue
        if not isinstance(expiry, date):
            problems.append(f"{label}: `expired_at` نوعٌ غيرُ تاريخٍ")
            continue
        remaining = (expiry - today).days
        if remaining <= 0:
            problems.append(f"{label}: المهلةُ انقضَتْ في {expiry.isoformat()} — يُعالَجُ أو يُمدَّدُ بقرارٍ مُسجَّلٍ")
        elif remaining > MAX_DAYS:
            problems.append(
                f"{label}: المهلةُ {remaining} يوماً > {MAX_DAYS} — استثناءٌ طويلُ الأجلِ يُنسى"
            )

    return problems


def summary() -> str:
    data = yaml.safe_load(EXCEPTIONS.read_text(encoding="utf-8")) or {}
    entries = data.get("vulnerabilities") or []
    risks = sorted(
        {
            ref
            for entry in entries
            if isinstance(entry, dict)
            for ref in re.findall(r"RISK-\d{4}", str(entry.get("statement") or ""))
        }
    )
    expiries = sorted(
        {str(entry.get("expired_at")) for entry in entries if isinstance(entry, dict)}
    )
    return (
        f"• استثناءاتٌ مُعلَنةٌ ومحروسةٌ: {len(entries)} معرّفاً · "
        f"خطرٌ: {', '.join(risks) or 'لا شيء'} · مهلةٌ: {', '.join(expiries) or 'لا شيء'}"
    )


def main(argv: list[str]) -> int:
    problems = validate()
    if problems:
        print("✗ ملفُّ استثناءاتِ ثغراتِ الصورةِ مخالفٌ للعقدِ:", file=sys.stderr)
        for message in problems:
            print(f"  ✗ {message}", file=sys.stderr)
        return 1
    if "--report" in argv:
        print(summary())
    else:
        print("✓ " + summary().lstrip("• "))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

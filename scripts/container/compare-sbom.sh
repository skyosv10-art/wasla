#!/usr/bin/env bash
# compare-sbom.sh — إثباتُ أنَّ بناءَينِ مستقلَّينِ يُنتِجانِ الإغلاقَ نفسَهُ. (M2-01)
#
#   bash scripts/container/compare-sbom.sh artifacts/sbom/pass1.cdx.json artifacts/sbom/pass2.cdx.json
#
# المقارنةُ على **مجموعةِ purl المرتَّبةِ** لا على البايتاتِ: القائمةُ تحملُ
# طوابعَ زمنٍ ومعرِّفاتِ تشغيلٍ تختلفُ بينَ نداءَينِ بلا معنىً، فمقارنةُ البايتاتِ
# تكذبُ حمراءَ. وما يُهِمُّ هوَ أنَّ الشجرةَ نفسَها أنتجَتْ **التبعيّاتَ نفسَها**:
# فرقٌ واحدٌ هنا يعني بناءً غيرَ قابلٍ للإعادةِ، أي أنَّ ما فُحِصَ ليسَ ما يُشحَنُ.
set -euo pipefail

A="${1:?قائمةُ الموادِ الأولى مطلوبةٌ}"
B="${2:?قائمةُ الموادِ الثانيةُ مطلوبةٌ}"

python3 - "$A" "$B" <<'PY'
import hashlib, json, sys

def closure(path):
    doc = json.load(open(path, encoding="utf-8"))
    items = set()
    for component in doc.get("components") or []:
        key = component.get("purl") or f'{component.get("name")}@{component.get("version")}'
        items.add(key)
    return items

a_path, b_path = sys.argv[1], sys.argv[2]
a, b = closure(a_path), closure(b_path)

def digest(items):
    return hashlib.sha256("\n".join(sorted(items)).encode()).hexdigest()[:16]

print(f"• البناءُ الأوّلُ : {len(a)} مكوِّناً · بصمةُ الإغلاقِ {digest(a)}")
print(f"• البناءُ الثاني: {len(b)} مكوِّناً · بصمةُ الإغلاقِ {digest(b)}")

only_a = sorted(a - b)
only_b = sorted(b - a)
if only_a or only_b:
    print(f"\n✗ البناءُ غيرُ قابلٍ للإعادةِ — {len(only_a) + len(only_b)} فرقاً:")
    for item in only_a[:20]:
        print(f"  − في الأوّلِ فقط: {item}")
    for item in only_b[:20]:
        print(f"  + في الثاني فقط: {item}")
    raise SystemExit(1)

print(f"\n✓ الإغلاقُ متطابقٌ في بناءَينِ مستقلَّينِ: {len(a)} مكوِّناً · {digest(a)}")
PY

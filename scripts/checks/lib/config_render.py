#!/usr/bin/env python3
# config_render.py — المُصدِّرُ الوحيدُ لأرتفاكتِ الإعدادِ من السجلِّ المرجعيِّ. (M2-04)
#
# ── لماذا يوجد هذا الملف ───────────────────────────────────────────────
# قِيسَ قبلَ العملِ: في المستودعِ **مئةٌ وثلاثةَ عشرَ موضعَ قراءةٍ** للبيئةِ
# مُوزَّعةً على أربعٍ وستّينَ ملفّاً، **ولا ملفَّ `.env.example` واحدٌ** في الشجرةِ،
# و`packages/config/` مُعلَنٌ منطقةً مشتركةً عاليةَ الخطرِ في `WORK_INDEX.md`
# وفيهِ `.gitkeep` وحدَهُ. فمَن أرادَ نشرَ الخدمةِ لا يجدُ قائمةً يقرأُها، ومَن
# أرادَ زيادةَ متغيّرٍ لا يجدُ موضعاً يُسجِّلُهُ فيهِ.
#
# والحلُّ **مصدرٌ واحدٌ يُولِّدُ**، لا وثيقةٌ تُكتَبُ بيدٍ ويُحرَسُ تطابقُها:
# `packages/config/env-registry.json` هوَ الحقيقةُ، وكلُّ ما عداهُ مُشتَقٌّ منهُ
# بايتاً بايتاً (`.env.example` · `registry.generated.ts`). وهذا إعمالٌ لسابقةِ
# `lib/required-artifacts.sh` (M0-04): الحارسُ يكشفُ الانحرافَ بعدَ وقوعِهِ،
# والمصدرُ الواحدُ يمنعُ وقوعَهُ.
#
# ── الاستخدام ─────────────────────────────────────────────────────────
#   from config_render import load_registry, render_env_example, render_typescript
#   python3 scripts/config/render-config-artifacts.py            # يكتبُ
#   python3 scripts/config/render-config-artifacts.py --check    # يقارنُ فقط
#
# لا يطبعُ هذا الملفُّ شيئاً ولا يكتبُ ملفّاً عندَ الاستيرادِ: دوالٌّ محضةٌ.
# المرجع: docs/08-infrastructure/CONFIG_SCHEMA.md · ADR-032

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SCHEMA_ID = "wasla.env-registry/v1"
REGISTRY_PATH = "packages/config/env-registry.json"
ENV_EXAMPLE_PATH = ".env.example"
GENERATED_TS_PATH = "packages/config/src/registry.generated.ts"

VALID_TYPES = (
    "postgres_url",
    "http_url",
    "port",
    "positive_int",
    "non_negative_int",
    "string",
    "csv",
    "flag",
    "secret_material",
)
VALID_REQUIRED = ("always", "conditional", "optional")
VALID_SCOPES = ("runtime", "tooling", "test")
# `indirect_literal`: الاسمُ مكتوبٌ حرفاً في الملفِّ لكنَّهُ **ثابتٌ مُصدَّرٌ** يُمرَّرُ
# إلى القارئِ بدلَ أن يُكتَبَ في موضعِ النداءِ، فالماسحُ لا يراهُ قراءةً. يفترقُ عن
# `default_literal` بأنَّ ذاكَ قيمةٌ افتراضيّةٌ في دالّةٍ — والفرقُ يُكتَبُ ولا يُطمَسُ.
VALID_MODES = (
    "direct",
    "reader",
    "bag",
    "helper",
    "template",
    "default_literal",
    "indirect_literal",
)

# نصُّ نائبٍ لكلِّ سرٍّ: لا قيمةَ سرٍّ تُلتزَمُ في المستودعِ ولو مثالاً.
SECRET_PLACEHOLDER = "__SET_ME__"

SCOPE_TITLES = {
    "runtime": "متغيّراتُ التشغيلِ الإنتاجيِّ",
    "tooling": "متغيّراتُ الأدواتِ (ترحيلاتٌ وسكربتاتُ تشغيلٍ)",
    "test": "متغيّراتُ الاختبارِ والتكاملِ المحليِّ",
}

TYPE_TITLES = {
    "postgres_url": "وصلةُ Postgres",
    "http_url": "عنوانُ HTTP",
    "port": "منفذٌ (1..65535)",
    "positive_int": "عددٌ صحيحٌ ≥ 1",
    "non_negative_int": "عددٌ صحيحٌ ≥ 0",
    "string": "نصٌّ",
    "csv": "قائمةٌ بفواصلَ",
    "flag": "رايةٌ (1 يُفعِّلُ)",
    "secret_material": "مادّةٌ سرِّيّةٌ",
}


class RegistryError(Exception):
    """خطأٌ بنيويٌّ في السجلِّ المرجعيِّ — يُرفَعُ باسمِ المتغيّرِ لا بعمومٍ."""


def load_registry(root: Path) -> dict[str, Any]:
    """يقرأُ السجلَّ ويتحقّقُ من صيغتِهِ الدنيا (لا من دلالتِهِ — تلكَ للحارسِ)."""
    path = root / REGISTRY_PATH
    if not path.is_file():
        raise RegistryError(f"السجلُّ المرجعيُّ مفقودٌ: {REGISTRY_PATH}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:  # صيغةٌ فاسدةٌ تُسمّى بموضعِها
        raise RegistryError(f"{REGISTRY_PATH} ليسَ JSON صالحاً: {exc}") from exc
    if data.get("schema") != SCHEMA_ID:
        raise RegistryError(
            f"مُعرِّفُ الصيغةِ في {REGISTRY_PATH} يجبُ أن يكونَ {SCHEMA_ID!r}"
        )
    variables = data.get("variables")
    if not isinstance(variables, list) or not variables:
        raise RegistryError(f"{REGISTRY_PATH}: `variables` قائمةٌ غيرُ فارغةٍ إلزاماً")
    return data


def variables_sorted(registry: dict[str, Any]) -> list[dict[str, Any]]:
    """ترتيبٌ واحدٌ لا يعتمدُ على ترتيبِ الكتابةِ: بالاسمِ. فالتوليدُ حتميٌّ."""
    return sorted(registry["variables"], key=lambda v: str(v.get("name", "")))


def _example_value(var: dict[str, Any]) -> str:
    if var.get("secret"):
        return SECRET_PLACEHOLDER
    example = var.get("example")
    if example is None:
        default = var.get("default")
        return "" if default is None else str(default)
    return str(example)


def render_env_example(registry: dict[str, Any]) -> str:
    """`.env.example` — مُشتَقٌّ كاملاً، لا سطرَ فيهِ يُكتَبُ بيدٍ."""
    out: list[str] = []
    out.append("# .env.example — مُولَّدٌ من السجلِّ المرجعيِّ. لا يُحرَّرُ بيدٍ.")
    out.append(f"# المصدرُ: {REGISTRY_PATH}")
    out.append("# التوليدُ: python3 scripts/config/render-config-artifacts.py")
    out.append("# المرجعُ: docs/08-infrastructure/CONFIG_SCHEMA.md")
    out.append("#")
    out.append("# لا تُكتَبُ قيمةُ سرٍّ هنا: كلُّ سرٍّ قيمتُهُ " + SECRET_PLACEHOLDER + ".")
    variables = variables_sorted(registry)
    for scope in VALID_SCOPES:
        group = [v for v in variables if scope in v.get("scopes", [])]
        if not group:
            continue
        out.append("")
        out.append("# " + "─" * 68)
        out.append(f"# {SCOPE_TITLES[scope]} ({len(group)} متغيّراً)")
        out.append("# " + "─" * 68)
        for var in group:
            default = var.get("default")
            default_txt = "لا افتراضيَّ" if default is None else str(default)
            readers = var.get("readers", [])
            out.append("")
            out.append(f"# {var.get('description_ar', '')}")
            out.append(
                f"# النوعُ: {TYPE_TITLES[var['type']]}"
                f" · الإلزامُ: {var['required']}"
                f" · الافتراضيُّ: {default_txt}"
                f" · القارئون: {len(readers)}"
                f" · البندُ: {var.get('owner_item', '—')}"
            )
            if var.get("note_ar"):
                out.append(f"# ملاحظةٌ: {var['note_ar']}")
            out.append(f"{var['name']}={_example_value(var)}")
    out.append("")
    return "\n".join(out)


def _ts_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def render_typescript(registry: dict[str, Any]) -> str:
    """`registry.generated.ts` — السجلُّ نفسُهُ مقروءاً بأنواعٍ في زمنِ الترجمةِ."""
    variables = variables_sorted(registry)
    lines: list[str] = []
    lines.append("// registry.generated.ts — مُولَّدٌ من السجلِّ المرجعيِّ. لا يُحرَّرُ بيدٍ.")
    lines.append(f"// المصدرُ: {REGISTRY_PATH}")
    lines.append("// التوليدُ: python3 scripts/config/render-config-artifacts.py")
    lines.append("// والفحصُ 18 يُعيدُ التوليدَ ويقارنُ بايتاً بايتاً، فلا انحرافَ يمرُّ.")
    lines.append("")
    lines.append("/** أنواعُ المتغيّراتِ المُعتَمدةُ — قائمةٌ مغلقةٌ. */")
    lines.append(
        "export type EnvVarType =\n"
        + "\n".join(f"  | {_ts_string(t)}" for t in VALID_TYPES)
        + ";"
    )
    lines.append("")
    lines.append("/** درجةُ الإلزامِ: `conditional` تعني «إلزاميٌّ في حالةٍ مُسمّاةٍ». */")
    lines.append(
        "export type EnvRequirement = "
        + " | ".join(_ts_string(r) for r in VALID_REQUIRED)
        + ";"
    )
    lines.append("")
    lines.append("/** موضعُ الاستهلاكِ: إنتاجٌ أو أداةٌ أو اختبارٌ. */")
    lines.append(
        "export type EnvScope = " + " | ".join(_ts_string(s) for s in VALID_SCOPES) + ";"
    )
    lines.append("")
    lines.append("export interface EnvVarSpec {")
    lines.append("  readonly name: string;")
    lines.append("  readonly type: EnvVarType;")
    lines.append("  readonly required: EnvRequirement;")
    lines.append("  readonly secret: boolean;")
    lines.append("  readonly default: string | null;")
    lines.append("  readonly scopes: readonly EnvScope[];")
    lines.append("  readonly readerCount: number;")
    lines.append("  readonly ownerItem: string;")
    lines.append("}")
    lines.append("")
    lines.append(f"/** كلُّ متغيّرٍ مقروءٍ في الشجرةِ: {len(variables)} متغيّراً. */")
    lines.append("export const ENV_REGISTRY: readonly EnvVarSpec[] = [")
    for var in variables:
        default = var.get("default")
        default_ts = "null" if default is None else _ts_string(str(default))
        scopes = ", ".join(_ts_string(s) for s in var.get("scopes", []))
        lines.append("  {")
        lines.append(f"    name: {_ts_string(var['name'])},")
        lines.append(f"    type: {_ts_string(var['type'])},")
        lines.append(f"    required: {_ts_string(var['required'])},")
        lines.append(f"    secret: {'true' if var.get('secret') else 'false'},")
        lines.append(f"    default: {default_ts},")
        lines.append(f"    scopes: [{scopes}],")
        lines.append(f"    readerCount: {len(var.get('readers', []))},")
        lines.append(f"    ownerItem: {_ts_string(str(var.get('owner_item', '')))},")
        lines.append("  },")
    lines.append("] as const;")
    lines.append("")
    lines.append("/** أسماءُ المتغيّراتِ وحدَها — نوعٌ مغلقٌ يُستعملُ في القراءاتِ. */")
    lines.append("export const ENV_VAR_NAMES = [")
    for var in variables:
        lines.append(f"  {_ts_string(var['name'])},")
    lines.append("] as const;")
    lines.append("")
    lines.append("export type EnvVarName = (typeof ENV_VAR_NAMES)[number];")
    lines.append("")
    lines.append("/** بحثٌ بالاسمِ — يُعيدُ `undefined` لغيرِ المُسجَّلِ لا يُلقي. */")
    lines.append("export function findEnvVarSpec(name: string): EnvVarSpec | undefined {")
    lines.append("  return ENV_REGISTRY.find((entry) => entry.name === name);")
    lines.append("}")
    lines.append("")
    return "\n".join(lines)


def rendered_artifacts(registry: dict[str, Any]) -> dict[str, str]:
    """كلُّ الأرتفاكتِ المُشتقّةِ في خريطةٍ واحدةٍ: مسارٌ ⇒ محتوىً مُتوقَّعٌ."""
    return {
        ENV_EXAMPLE_PATH: render_env_example(registry),
        GENERATED_TS_PATH: render_typescript(registry),
    }

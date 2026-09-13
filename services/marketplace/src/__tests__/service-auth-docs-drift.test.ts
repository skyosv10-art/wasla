/**
 * حرسُ انحرافٍ بينَ **الشفرةِ** و**وثيقتَي الحدِّ** في صلاحيّاتِ السوقِ
 * (`M1-04` · المراجعةُ 29/N).
 *
 * ── لماذا يُكتَبُ هذا الحرسُ **معَ** الفرضِ لا بعدَهُ ─────────────────────────
 * حدُّ التوصيلِ انحرفَ مرّتَينِ قبلَ أن يُحرَسَ: أُضيفَت الصلاحيّةُ العاشرةُ ثمَّ
 * الحاديةَ عشرةَ في الشفرةِ وبقيَ الجدولانِ يُعلِنانِ تسعاً، ولم يُسقِطْ ذلكَ
 * بناءً ولا اختباراً — لأنَّ حارسَ التغطيةِ يقرأُ سطورَ العملاءِ في §4 لا جدولَ
 * الصلاحيّاتِ. فكُتِبَ الحرسُ هناكَ في المراجعةِ 22/N **متأخّراً** (الملفُّ
 * `services/delivery/src/__tests__/service-auth-docs-drift.test.ts`).
 *
 * وحدُّ السوقِ يدخلُ بستَّ عشرةَ صلاحيّةً — **أكبرُ جدولٍ في المستودعِ** —
 * فانتظارُ الانحرافِ الأوّلِ لكي يُحرَسَ كانَ سيُعيدُ العطبَ نفسَهُ بعدَ أن صارَ
 * معروفاً. و**عطبٌ معروفٌ يُترَكُ ليقعَ مرّةً أخرى ليسَ سهواً بل قراراً**.
 *
 * ── ما لا يُدَّعى ──────────────────────────────────────────────────────────
 * - يُطابِقُ **أسماءَ الصلاحيّاتِ** لا نصَّ تعليلِها: وثيقةٌ تسردُ الستَّ عشرةَ
 *   بتعليلٍ خاطئٍ تمرُّ هنا — المراجعةُ البشريّةُ تبقى.
 * - ولا يُطابِقُ **المساراتَ** بالصلاحيّاتِ: الربطُ يُثبَتُ في
 *   `service-identity.test.ts` على السلكِ (401/403)، وهوَ الإثباتُ لا الجدولُ.
 * - ونطاقُهُ حدُّ السوقِ وحدَهُ؛ الحدودُ الستّةُ الأخرى بلا حرسٍ كهذا بعدُ،
 *   وتوسيعُهُ إليها عملٌ مستقلٌّ بحجزٍ مستقلٍّ.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MARKETPLACE_SCOPES } from "../http/service-identity.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

/** العلامتانِ نفسُهما نمطاً في وثيقتَي الحدِّ — نمطُ §4 في السجلِّ لا اختراعٌ. */
const BEGIN = "<!-- marketplace-scopes:begin -->";
const END = "<!-- marketplace-scopes:end -->";

const DOCS: readonly string[] = [
  "docs/07-security/SERVICE_AUTH_ENFORCEMENT.md",
  "docs/12-testing/M1-04_GATE.md",
];

/** كلُّ ما بينَ عصاتَي التنصيصِ في الكتلةِ المُعلَّمةِ — بلا تفسيرِ جدولٍ. */
function declaredScopes(relativePath: string): readonly string[] {
  const text = readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
  const from = text.indexOf(BEGIN);
  const to = text.indexOf(END);
  if (from < 0 || to < 0 || to < from) {
    throw new Error(
      `الكتلةُ المُعلَّمةُ (${BEGIN} … ${END}) غائبةٌ أو مقلوبةٌ في ${relativePath}. ` +
        `هذهِ الكتلةُ عقدٌ يقرأُهُ الحرسُ، فحذفُها إسقاطُ حرسٍ لا تنظيفُ نصٍّ.`,
    );
  }
  const block = text.slice(from + BEGIN.length, to);
  return [...block.matchAll(/`(marketplace:[a-z0-9:-]+)`/gu)].map((match) => match[1]);
}

const CODE_SCOPES: readonly string[] = Object.values(MARKETPLACE_SCOPES);

describe("حرس انحراف صلاحيات السوق بين الشفرة ووثيقتي الحد", () => {
  it("`MARKETPLACE_SCOPES` بلا تكرارٍ — الاسمُ مفتاحُ المطابقةِ فلا يُعَدُّ مرّتَين", () => {
    expect(new Set(CODE_SCOPES).size).toBe(CODE_SCOPES.length);
  });

  it.each(DOCS)("%s تُعلِنُ كلَّ صلاحيّةٍ مفروضةٍ في الشفرةِ — لا صلاحيّةَ صامتةً", (doc) => {
    const declared = new Set(declaredScopes(doc));
    const missing = CODE_SCOPES.filter((scope) => !declared.has(scope));
    expect(missing).toEqual([]);
  });

  it.each(DOCS)("%s لا تُعلِنُ صلاحيّةً لا وجودَ لها في الشفرةِ", (doc) => {
    const code = new Set(CODE_SCOPES);
    const invented = declaredScopes(doc).filter((scope) => !code.has(scope));
    expect(invented).toEqual([]);
  });

  it.each(DOCS)("%s لا تُكرِّرُ صلاحيّةً في كتلتِها — سطرٌ لكلِّ صلاحيّةٍ", (doc) => {
    const declared = declaredScopes(doc);
    expect(new Set(declared).size).toBe(declared.length);
  });
});

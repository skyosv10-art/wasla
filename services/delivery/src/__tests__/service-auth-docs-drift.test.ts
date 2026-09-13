/**
 * حرسُ انحرافٍ بينَ **الشفرةِ** و**وثيقتَي الحدِّ** في صلاحيّاتِ التوصيلِ
 * (`M1-04` · المراجعةُ 22/N).
 *
 * ── العطبُ الذي أنشأَ هذا الملفَّ (مقيسٌ لا متخيَّلٌ) ──────────────────────
 * الموجةُ السادسةُ فرضت حدَّ التوصيلِ بتسعِ صلاحيّاتٍ لتسعةِ مساراتٍ مُغلَقةٍ،
 * وكُتِبَ ذلكَ جدولاً بيدٍ في [السجلِّ الحاكمِ](../../../../docs/07-security/SERVICE_AUTH_ENFORCEMENT.md) §2.7
 * وبوّابةِ [`M1-04_GATE.md`](../../../../docs/12-testing/M1-04_GATE.md). ثمَّ
 * أُضيفَت الصلاحيّةُ **العاشرةُ** (إقرارُ الرايةِ · 18/N) و**الحاديةَ عشرةَ**
 * (دفترُ الرسائلِ الميتةِ · 21/N) في الشفرةِ، **ولم يتغيّرِ الجدولانِ**. ولم
 * يُسقِطْ ذلكَ بناءً ولا اختباراً ولا الفحصَ 12 — لأنَّ حارسَ التغطيةِ يقرأُ
 * **سطورَ العملاءِ الصادرينَ** في §4 لا جدولَ الصلاحيّاتِ في §2.7. فبقيَت
 * الوثيقةُ تُعلِنُ تسعاً والحدُّ يفرضُ إحدى عشرةَ: **انحرافٌ صامتٌ في وثيقةِ أمنٍ**
 * تُقرأُ في مراجعةٍ وتدقيقٍ.
 *
 * ── ولمَ حرسٌ لا تصحيحٌ يدويٌّ وحدَه ──────────────────────────────────────
 * تصحيحُ الجدولَينِ يرفعُ الانحرافَ **اليومَ** ولا يمنعُ عودتَهُ عندَ الصلاحيّةِ
 * الثانيةَ عشرةَ — وهذا بالضبطِ ما حدثَ مرّتَينِ. فالمصدرُ الوحيدُ للحقيقةِ
 * `DELIVERY_SCOPES` في الشفرةِ، والوثيقتانِ تُقرآنِ منهُ لا تُوصَفانِ بيدٍ:
 * كلُّ صلاحيّةٍ **حاضرةٌ** في كتلةٍ مُعلَّمةٍ في كلِّ وثيقةٍ، وكلُّ ما في الكتلةِ
 * **موجودٌ** في الشفرةِ (فلا صلاحيّةٌ متخيَّلةٌ في وثيقةِ أمنٍ أيضاً).
 *
 * ── ما لا يُدَّعى ──────────────────────────────────────────────────────────
 * - الحرسُ يُطابِقُ **أسماءَ الصلاحيّاتِ** لا نصَّ تعليلِها: وثيقةٌ تسردُ
 *   الأحدَ عشرَ اسماً بتعليلٍ خاطئٍ تمرُّ هنا — المراجعةُ البشريّةُ تبقى.
 * - ولا يُطابِقُ **المساراتَ** بالحدِّ نفسِهِ: الربطُ بينَ مسارٍ وصلاحيّتِهِ
 *   يُثبَتُ في `service-identity.test.ts` على السلكِ (401/403 بلا توقيعٍ)،
 *   وهوَ الإثباتُ لا الجدولُ.
 * - ولا يمسُّ حدوداً أخرى (`orders` · `dispatch` · `geography` …): توسيعُهُ
 *   إليها عملٌ مستقلٌّ بحجزٍ مستقلٍّ، وهذا الملفُّ يُعلِنُ نطاقَهُ ولا يُوهِمُ
 *   بشمولٍ.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DELIVERY_SCOPES } from "../http/service-identity.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

/** العلامتانِ نفسُهما في الوثيقتَينِ — نمطُ §4 في السجلِّ لا اختراعٌ. */
const BEGIN = "<!-- delivery-scopes:begin -->";
const END = "<!-- delivery-scopes:end -->";

const DOCS: readonly string[] = [
  "docs/07-security/SERVICE_AUTH_ENFORCEMENT.md",
  "docs/12-testing/M1-04_GATE.md",
];

/** كلُّ ما بينَ عصاتَي التنصيصِ في الكتلةِ المُعلَّمةِ — بلا تفسيرِ جدولٍ ولا قائمةٍ. */
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
  return [...block.matchAll(/`(delivery:[a-z0-9:-]+)`/gu)].map((match) => match[1]);
}

const CODE_SCOPES: readonly string[] = Object.values(DELIVERY_SCOPES);

describe("حرس انحراف الصلاحيات بين الشفرة ووثيقتي الحد", () => {
  it("`DELIVERY_SCOPES` بلا تكرارٍ — الاسمُ مفتاحُ المطابقةِ فلا يُعَدُّ مرّتَين", () => {
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

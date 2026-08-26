/**
 * موضعُ الاستمرارِ مُعتِماً: نصٌّ واحدٌ يُعطى للمُتَّصلِ ويُعاد كما هو.
 *
 * ## لماذا مُعتِمٌ لا `?after_created_at=…&after_id=…`
 *
 * كشفُ أعمدةِ الترتيبِ في الرابطِ يجعلها عقداً: أوّلُ تغييرٍ في مفتاحِ الترتيبِ (إضافةُ فاصلٍ
 * ثانٍ · تحويلُ ترتيبٍ من تنازليٍّ إلى تصاعديّ) يُبطل روابطَ محفوظةً في تطبيقاتِ عملاءَ لا
 * نتحكّم بها. والنصُّ المُعتِمُ يجعل الشكلَ الداخليَّ قابلاً للتطويرِ بلا كسرِ عميل.
 *
 * وهو **ليس** تشفيراً ولا يُدّعى أنّه: `base64url` تمثيلٌ لا حِمايةٌ، ومَن فكّه لا يرى إلّا
 * لحظةَ إنشاءِ صفٍّ ومُعرِّفَه — وكلاهما في جسمِ الجوابِ أصلاً. والغرضُ منعُ الاعتمادِ لا
 * منعُ القراءة.
 *
 * ## لماذا يُرفَض المُعطوبُ برمزٍ مُسمّىً
 *
 * موضعٌ معطوبٌ يُتجاهَل صامتاً يُعيد الصفحةَ الأولى، فيقرأ الزاحفُ الصفحةَ الأولى إلى الأبد
 * في حلقةٍ لا يشعر بها أحد. والرفضُ الصريحُ (`MARKETPLACE_VALIDATION_FAILED`) يُظهر الخللَ في
 * أوّلِ طلب.
 */

import { validationFailed } from "../domain/errors.js";

/** حدُّ العقد لطولِ الموضع (`Cursor` في `api.openapi.yml`). */
export const CURSOR_MAX_LENGTH = 256;

function encode(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  if (encoded.length > CURSOR_MAX_LENGTH) {
    throw validationFailed("cursor", `at most ${CURSOR_MAX_LENGTH} characters`);
  }
  return encoded;
}

function decode(cursor: string): unknown {
  if (cursor.length < 1 || cursor.length > CURSOR_MAX_LENGTH) {
    throw validationFailed("cursor", `1..${CURSOR_MAX_LENGTH} characters`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw validationFailed("cursor", "opaque cursor returned by a previous page");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw validationFailed("cursor", "opaque cursor returned by a previous page");
  }
  return parsed;
}

/** موضعٌ مُركَّبٌ: لحظةُ الإنشاءِ ثمّ المُعرِّفُ فاصلاً — لأنّ اللحظةَ وحدَها ليست فريدة. */
export interface CompositeCursor {
  readonly createdAt: string;
  readonly id: string;
}

export function encodeCompositeCursor(value: CompositeCursor): string {
  return encode({ t: value.createdAt, i: value.id });
}

export function decodeCompositeCursor(cursor: string): CompositeCursor {
  const parsed = decode(cursor) as { readonly t?: unknown; readonly i?: unknown };
  if (typeof parsed.t !== "string" || typeof parsed.i !== "string") {
    throw validationFailed("cursor", "opaque cursor returned by a previous page");
  }
  return { createdAt: parsed.t, id: parsed.i };
}

/** وموضعٌ تسلسليٌّ للسجلّ: رقمُ التسلسلِ فريدٌ ومُتّصلٌ، فعمودٌ واحدٌ يكفي. */
export function encodeSequenceCursor(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw validationFailed("cursor", "non-negative sequence");
  }
  return encode({ s: sequence });
}

export function decodeSequenceCursor(cursor: string): number {
  const parsed = decode(cursor) as { readonly s?: unknown };
  if (typeof parsed.s !== "number" || !Number.isSafeInteger(parsed.s) || parsed.s < 0) {
    throw validationFailed("cursor", "opaque cursor returned by a previous page");
  }
  return parsed.s;
}

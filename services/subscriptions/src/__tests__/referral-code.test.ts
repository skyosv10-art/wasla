/**
 * رمزُ الإحالة: اشتقاقٌ ثابتٌ من مُعرّفِ المالك — لا عشوائيّةَ ولا جدولَ محاولات.
 *
 * ولمَ اشتقاقاً لا عشوائيّةً؟ لأنّ العشوائيّةَ تحتاج فحصَ تعارضٍ وحلقةَ إعادةٍ داخلَ
 * معاملةِ بدءِ التجربة: مسارٌ يُصيب مرّةً في كلّ مليونٍ، فيُختبَر بمُولّدٍ مُهيَّأٍ في اختبارٍ
 * ولا يُختبَر في الحقيقة أبداً. والاشتقاقُ يجعل التعارضَ **مستحيلاً بالبناء** لمالكَين
 * مختلفَين، ويجعل الرمزَ نفسَه قابلاً لإعادة الحساب في تحقيقٍ بعد سنة بلا قراءةِ صفّ.
 *
 * وهذه المجموعةُ سريعةٌ بلا قاعدة: كلُّ ما تُثبته دالّةٌ نقيّةٌ واحدةٌ لا تعرف مخزناً.
 */

import { describe, expect, it } from "vitest";

import { REFERRAL_CODE_PATTERN } from "@wasla/contracts-subscription";

import { REFERRAL_CODE_ALPHABET, referralCodeFor } from "../app/referral-code.js";

const DRIVER = "WS-1000000001";
const OTHER_DRIVER = "WS-1000000002";

describe("أبجديّةُ الرمز", () => {
  it("اثنان وثلاثون حرفاً بالعدّ — فلا يمرّ حرفٌ يُحذف سهواً", () => {
    // الطولُ مقروءٌ لا موصوفٌ: حذفُ حرفٍ يجعل باقي القسمةِ منحازاً، ويبقى الرمزُ مطابقاً
    // للصيغةِ فيمرّ كلُّ اختبارٍ آخر — وهذا بالضبط نوعُ الخللِ الذي لا يُلاحظ.
    expect(REFERRAL_CODE_ALPHABET).toHaveLength(32);
  });

  it("لا حروفَ ملتبسةً: I و L و O و U غائبةٌ قصداً", () => {
    /**
     * الرمزُ يُقرأ في رسالةٍ ويُكتب بيدٍ: `O` مع `0` و`I` مع `1` تجعل مطالبةً صحيحةً تسقط
     * بـ`REFERRAL_CODE_NOT_FOUND`، فيقرأ السائقُ «الرمزُ غيرُ صالح» والرمزُ صالحٌ وإنّما
     * قُرئ خطأً. و`U` تُسقَط لأنّها تُنتج كلماتٍ غيرَ لائقةٍ مع بقيّةِ الأبجديّة.
     */
    for (const letter of ["I", "L", "O", "U"]) {
      expect(REFERRAL_CODE_ALPHABET).not.toContain(letter);
    }
  });

  it("وكلُّ حرفٍ فيها من مجموعةِ صيغةِ العقد", () => {
    expect(/^[0-9A-Z]+$/.test(REFERRAL_CODE_ALPHABET)).toBe(true);
    expect(new Set(REFERRAL_CODE_ALPHABET).size).toBe(REFERRAL_CODE_ALPHABET.length);
  });
});

describe("اشتقاقُ الرمز", () => {
  it("يُطابق صيغةَ العقد `^WR-[0-9A-Z]{8}$`", () => {
    expect(REFERRAL_CODE_PATTERN.test(referralCodeFor(DRIVER))).toBe(true);
  });

  it("ثابتٌ: نفسُ المالكِ نفسُ الرمزِ في كلّ نداء", () => {
    // ولهذا يُزرع الرمزُ داخلَ معاملةِ بدءِ التجربة بلا خوفٍ من إعادةِ محاولة: إعادةُ
    // الحسابِ تُنتج القيمةَ نفسَها، فالمحاولةُ الثانيةُ لا تُنشئ رمزاً ثانياً لمالكٍ واحد.
    expect(referralCodeFor(DRIVER)).toBe(referralCodeFor(DRIVER));
  });

  it("ومالكان مختلفان لا يتشاركان رمزاً", () => {
    expect(referralCodeFor(DRIVER)).not.toBe(referralCodeFor(OTHER_DRIVER));
  });

  it("وجسمُه من الأبجديّةِ وحدَها — لا حرفَ من خارجها", () => {
    const body = referralCodeFor(DRIVER).slice(3);
    expect(body).toHaveLength(8);
    for (const character of body) expect(REFERRAL_CODE_ALPHABET).toContain(character);
  });

  it("وتغييرُ محرفٍ واحدٍ في المُعرّفِ يُغيّر الرمز", () => {
    /**
     * خاصّيّةُ الانتشارِ ليست تجميلاً: مُعرّفان متجاوران (`…001` و`…002`) يُنتجان رمزَين
     * متجاورَين لو كان الاشتقاقُ خطّياً، فيصير تخمينُ رمزِ سائقٍ آخرَ ممكناً بالعدّ —
     * ومطالبةٌ بتخمينٍ صحيحٍ تُنشئ إحالةً باسمِ من لم يُحِل أحداً.
     */
    const codes = new Set(
      ["WS-1000000001", "WS-1000000002", "WS-1000000003", "WS-1000000011"].map(referralCodeFor),
    );
    expect(codes.size).toBe(4);
  });
});

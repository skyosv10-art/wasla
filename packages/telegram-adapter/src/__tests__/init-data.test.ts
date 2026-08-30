/**
 * اختبارُ التحقُّقِ من `init-data` — عنصرُ العمل **M1-02**.
 *
 * ما تحرسه هذه المجموعةُ ليس «أنّ الدالّةَ تعمل» بل **أنّها ترفض**. ولذلك
 * أكثرُ حالاتِها سلبيّةٌ: كلُّ حالةٍ تُمثّل طريقاً كان يمكن أن يدخل بها
 * مهاجمٌ لو غفلت الدالّة.
 *
 * والتوقيعُ يُبنى بـ`signInitDataForTests` وهي في ملفِّ الإنتاجِ لا في
 * الاختبارِ — وذلك مقصودٌ ومُعلَنٌ: التوقيعُ والتحقُّقُ يشتركانِ في اشتقاقِ
 * المفتاحِ ونصِّ التحقُّق، فلو كُتبت المُوقِّعةُ هنا لصارت نسخةً ثانيةً قد
 * تفترق عن الأولى فتُخفي عيباً. وثمنُ هذا الاشتراكِ صريحٌ: **خطأٌ مشترَكٌ في
 * نصِّ التحقُّقِ لن تكشفه هذه المجموعةُ**، ويكشفه `init-data` حقيقيٌّ من
 * تلغرامَ وحدَه — وهو ما لا يُملَك في اختبارٍ آليٍّ. ولذلك أُضيفت حالةُ
 * «متجَهٌ ثابتٌ» أدناه: توقيعٌ محسوبٌ مسبقاً بقيمةٍ hex مكتوبةٍ حرفيّاً،
 * تُخفِق إن تغيّر اشتقاقُ المفتاحِ أو نصُّ التحقُّق في الطرفَينِ معاً.
 */

import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_INIT_DATA_MAX_AGE_SECONDS,
  InitDataError,
  InitDataRejection,
  fingerprintInitData,
  signInitDataForTests,
  verifyTelegramInitData,
} from "../init-data.js";

const BOT_TOKEN = "123456:AAHfake-bot-token-for-tests-only";
const AUTH_DATE = 1_760_000_000; // ثوانٍ — قيمةٌ ثابتةٌ كي يكون الاختبارُ حتميّاً
const NOW = new Date(AUTH_DATE * 1000);

const TELEGRAM_USER_ID = 42;

const USER_JSON = JSON.stringify({
  id: TELEGRAM_USER_ID,
  first_name: "سالم",
  username: "salem",
  language_code: "ar",
  is_premium: true,
});

function baseFields(over: Record<string, string> = {}): Record<string, string> {
  return {
    auth_date: String(AUTH_DATE),
    query_id: "AAHquery",
    user: USER_JSON,
    ...over,
  };
}

/** يُلتقط سببُ الرفضِ بلا `try/catch` مكرَّرٍ في كلِّ حالة. */
function rejectionOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof InitDataError) return error.reason;
    return `NOT_AN_INIT_DATA_ERROR:${(error as Error).name}`;
  }
  return "NO_REJECTION";
}

describe("verifyTelegramInitData — الطريقُ السليم", () => {
  it("يقبل init-data مُوقَّعاً ويُعيد ما وُقِّع عليه", () => {
    const raw = signInitDataForTests(baseFields(), BOT_TOKEN);
    const out = verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW });

    expect(out.user.id).toBe(42);
    expect(out.user.firstName).toBe("سالم");
    expect(out.user.username).toBe("salem");
    expect(out.user.languageCode).toBe("ar");
    expect(out.user.isPremium).toBe(true);
    expect(out.authDateSeconds).toBe(AUTH_DATE);
    expect(out.authDate).toBe(new Date(AUTH_DATE * 1000).toISOString());
    expect(out.queryId).toBe("AAHquery");
  });

  it("لا يُصدِر حقولاً لم تُوقَّع عليها تلغرام", () => {
    const raw = signInitDataForTests(baseFields(), BOT_TOKEN);
    const out = verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW });
    // لا `startParam` ولا `chatInstance` لأنّهما لم يكونا في المُدخَل.
    expect(out.startParam).toBeUndefined();
    expect(out.chatInstance).toBeUndefined();
  });

  it("يتجاهل حقلَ signature في حسابِ HMAC ولا يرفض بسببِ وجودِه", () => {
    // تلغرام أضافت حقلاً جديداً (`signature`) لتوقيعٍ آخر. لو دخلَ نصَّ
    // التحقُّقِ لَكَسر كلَّ جلسةٍ في اليومِ الذي تُرسله فيه.
    const raw = `${signInitDataForTests(baseFields(), BOT_TOKEN)}&signature=ed25519_blob`;
    const out = verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW });
    expect(out.user.id).toBe(42);
  });

  it("يقبل حقولاً لا يعرفها ولا يُسقِطها من التوقيع", () => {
    const raw = signInitDataForTests(
      baseFields({ some_future_field: "قيمةٌ لم تكن موجودةً" }),
      BOT_TOKEN,
    );
    expect(verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW }).user.id).toBe(42);
  });
});

describe("verifyTelegramInitData — التوقيع", () => {
  it("يرفض توقيعاً بحرفٍ واحدٍ مختلف", () => {
    const raw = signInitDataForTests(baseFields(), BOT_TOKEN);
    const flipped = raw.replace(/hash=([0-9a-f])/, (_m, c: string) =>
      `hash=${c === "0" ? "1" : "0"}`,
    );
    expect(rejectionOf(() => verifyTelegramInitData(flipped, BOT_TOKEN, { now: NOW }))).toBe(
      InitDataRejection.BadSignature,
    );
  });

  it("يرفض حقلاً عُدِّل بعدَ التوقيع", () => {
    const raw = signInitDataForTests(baseFields(), BOT_TOKEN);
    // نفسُ التوقيعِ، ومعرّفُ مستخدمٍ آخر — أخطرُ حالةٍ في الملفِّ كلِّه:
    // نجاحُها يعني انتحالَ أيِّ مستخدم.
    const tampered = raw.replace(
      encodeURIComponent(USER_JSON),
      encodeURIComponent(JSON.stringify({ id: 99, first_name: "دخيل" })),
    );
    expect(rejectionOf(() => verifyTelegramInitData(tampered, BOT_TOKEN, { now: NOW }))).toBe(
      InitDataRejection.BadSignature,
    );
  });

  it("يرفض توقيعاً بُني برمزِ روبوتٍ آخر", () => {
    const raw = signInitDataForTests(baseFields(), "999999:another-bot-token-entirely");
    expect(rejectionOf(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW }))).toBe(
      InitDataRejection.BadSignature,
    );
  });

  it("يرفض توقيعاً مبتوراً ولا يقبل بادئةً صحيحة", () => {
    const raw = signInitDataForTests(baseFields(), BOT_TOKEN);
    const short = raw.replace(/hash=([0-9a-f]{32})[0-9a-f]{32}/, "hash=$1");
    expect(rejectionOf(() => verifyTelegramInitData(short, BOT_TOKEN, { now: NOW }))).toBe(
      InitDataRejection.BadSignature,
    );
  });

  it("يرفض توقيعاً ليس hex", () => {
    // **اعترافٌ مقيسٌ:** هذه الحالةُ **ليست تشخيصيّةً لفحصِ صيغةِ الـhex**
    // في `hexEquals`. أُجريَ اختبارُ طفرةٍ: بإزالةِ سطرِ التعبيرِ النمطيِّ
    // **بقيت المجموعةُ خضراءَ 132/132** — لأنّ `Buffer.from("zz…","hex")` يُعيد
    // بايتاتٍ فارغةً فيرفضها فحصُ الطولِ بعدَه. فالتعبيرُ النمطيُّ
    // **دفاعٌ مُعمَّقٌ** يحمي لو أُسقطَ فحصُ الطولِ غداً، وليس سطراً
    // يحرسه اختبارٌ. والحالةُ تبقى لأنّها تحرس **السلوكَ** (رفضٌ) وإن
    // لم تحرس ذلك السطرَ بعينِه — ويُقال ولا يُدّعى غيرُه.
    const raw = signInitDataForTests(baseFields(), BOT_TOKEN).replace(
      /hash=.+$/,
      `hash=${"z".repeat(64)}`,
    );
    expect(rejectionOf(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW }))).toBe(
      InitDataRejection.BadSignature,
    );
  });

  it("يرفض غيابَ hash أصلاً", () => {
    const raw = "auth_date=1760000000&user=%7B%22id%22%3A42%7D";
    expect(rejectionOf(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW }))).toBe(
      InitDataRejection.MissingHash,
    );
  });

  it("متجَهٌ ثابتٌ: التوقيعُ يُطابق قيمةً محسوبةً خارجَ الدالّتَين", () => {
    // نصُّ التحقُّقِ مكتوبٌ حرفيّاً هنا، والمفتاحُ مُشتَقٌّ حرفيّاً — بلا
    // استدعاءِ أيٍّ من دالّتَي الملفّ. فلو تغيّر الملحُ أو الترتيبُ أو
    // الفاصلُ في الطرفَينِ معاً، تُخفِق هذه الحالةُ وحدَها.
    const fields = { a: "1", b: "2" };
    const key = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const expected = createHmac("sha256", key).update("a=1\nb=2").digest("hex");
    const raw = `a=1&b=2&hash=${expected}`;
    // يمرُّ بابَ التوقيعِ ثمّ يُرفَض على `auth_date` — وهذا هو المقصود:
    // الحالةُ تُثبت **التوقيعَ** لا الطريقَ كلَّه.
    expect(rejectionOf(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW }))).toBe(
      InitDataRejection.MissingAuthDate,
    );
    expect(signInitDataForTests(fields, BOT_TOKEN)).toBe(raw);
  });
});

describe("verifyTelegramInitData — البنية", () => {
  it("يرفض نصّاً فارغاً", () => {
    expect(rejectionOf(() => verifyTelegramInitData("", BOT_TOKEN, { now: NOW }))).toBe(
      InitDataRejection.Malformed,
    );
  });

  it("يرفض حقلاً مكرَّراً — بابَ تلبيسِ المُعامِلات", () => {
    // يوقِّع المهاجمُ على `user` سليمٍ ثمّ يُلحِق `user` ثانياً. `URLSearchParams`
    // يقبل هذا صامتاً؛ فالرفضُ الصريحُ هو ما يمنع أن يقرأ التحقُّقُ أحدَهما
    // ويقرأ التطبيقُ الآخر.
    const raw = `${signInitDataForTests(baseFields(), BOT_TOKEN)}&user=%7B%22id%22%3A99%7D`;
    expect(rejectionOf(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW }))).toBe(
      InitDataRejection.Malformed,
    );
  });

  it("يرفض حقلاً بلا علامةِ يساوي", () => {
    const raw = `${signInitDataForTests(baseFields(), BOT_TOKEN)}&dangling`;
    expect(rejectionOf(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW }))).toBe(
      InitDataRejection.Malformed,
    );
  });

  it("يرفض ترميزاً مئويّاً معطوباً بدلَ أن ينفجر", () => {
    const raw = `${signInitDataForTests(baseFields(), BOT_TOKEN)}&broken=%zz`;
    expect(rejectionOf(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW }))).toBe(
      InitDataRejection.Malformed,
    );
  });

  it("يرفض مفتاحاً فارغاً", () => {
    const raw = `${signInitDataForTests(baseFields(), BOT_TOKEN)}&=value`;
    expect(rejectionOf(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW }))).toBe(
      InitDataRejection.Malformed,
    );
  });
});

describe("verifyTelegramInitData — العمر", () => {
  it("يقبل عمراً يساوي الحدَّ بالضبط (الحدُّ شاملٌ بقرار)", () => {
    const raw = signInitDataForTests(baseFields(), BOT_TOKEN);
    const at = new Date((AUTH_DATE + DEFAULT_INIT_DATA_MAX_AGE_SECONDS) * 1000);
    expect(verifyTelegramInitData(raw, BOT_TOKEN, { now: at }).user.id).toBe(42);
  });

  it("يرفض ثانيةً واحدةً بعدَ الحدّ", () => {
    const raw = signInitDataForTests(baseFields(), BOT_TOKEN);
    const at = new Date((AUTH_DATE + DEFAULT_INIT_DATA_MAX_AGE_SECONDS + 1) * 1000);
    expect(rejectionOf(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: at }))).toBe(
      InitDataRejection.Expired,
    );
  });

  it("يحترم حدَّ عمرٍ مُمرَّراً أضيقَ من الافتراضي", () => {
    const raw = signInitDataForTests(baseFields(), BOT_TOKEN);
    const at = new Date((AUTH_DATE + 61) * 1000);
    expect(
      rejectionOf(() =>
        verifyTelegramInitData(raw, BOT_TOKEN, { now: at, maxAgeSeconds: 60 }),
      ),
    ).toBe(InitDataRejection.Expired);
  });

  it("يقبل انحرافَ ساعةٍ صغيراً للأمام", () => {
    const raw = signInitDataForTests(baseFields(), BOT_TOKEN);
    const at = new Date((AUTH_DATE - 30) * 1000);
    expect(verifyTelegramInitData(raw, BOT_TOKEN, { now: at }).user.id).toBe(42);
  });

  it("يرفض auth_date من المستقبلِ البعيد", () => {
    const raw = signInitDataForTests(baseFields(), BOT_TOKEN);
    const at = new Date((AUTH_DATE - 3600) * 1000);
    expect(rejectionOf(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: at }))).toBe(
      InitDataRejection.FromTheFuture,
    );
  });

  it("يرفض auth_date غيرَ رقميٍّ وإن كان التوقيعُ سليماً", () => {
    const raw = signInitDataForTests(baseFields({ auth_date: "٢٠٢٦" }), BOT_TOKEN);
    expect(rejectionOf(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW }))).toBe(
      InitDataRejection.MissingAuthDate,
    );
  });

  it("يرفض auth_date سالباً", () => {
    const raw = signInitDataForTests(baseFields({ auth_date: "-1" }), BOT_TOKEN);
    expect(rejectionOf(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW }))).toBe(
      InitDataRejection.MissingAuthDate,
    );
  });

  it("يفحص التوقيعَ قبلَ العمرِ — لا يُعلَن انتهاءُ صلاحيّةِ رسالةٍ مجهولةِ الأصل", () => {
    // لو رُتِّب الفحصُ بالعكسِ لصار الردُّ عرّافاً: «منتهيةٌ» تعني أنّ
    // التوقيعَ صحيحٌ، فيتعلَّم المهاجمُ متى نجحَ تخمينُه.
    const raw = signInitDataForTests(baseFields(), "999999:another-bot-token-entirely");
    const at = new Date((AUTH_DATE + 99_999) * 1000);
    expect(rejectionOf(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: at }))).toBe(
      InitDataRejection.BadSignature,
    );
  });
});

describe("verifyTelegramInitData — المستخدم", () => {
  it("يرفض غيابَ user", () => {
    const raw = signInitDataForTests({ auth_date: String(AUTH_DATE) }, BOT_TOKEN);
    expect(rejectionOf(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW }))).toBe(
      InitDataRejection.MissingUser,
    );
  });

  it("يرفض user ليس JSON", () => {
    const raw = signInitDataForTests(baseFields({ user: "ليس JSON" }), BOT_TOKEN);
    expect(rejectionOf(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW }))).toBe(
      InitDataRejection.MissingUser,
    );
  });

  it("يرفض معرِّفاً نصّيّاً وإن كان رقماً في صورةِ نصّ", () => {
    const raw = signInitDataForTests(
      baseFields({ user: JSON.stringify({ id: "42" }) }),
      BOT_TOKEN,
    );
    expect(rejectionOf(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW }))).toBe(
      InitDataRejection.MissingUser,
    );
  });

  it("يرفض معرِّفاً أكبرَ من العددِ الصحيحِ الآمن", () => {
    // خارجَ `Number.MAX_SAFE_INTEGER` يُقارَب المعرِّفُ إلى معرِّفٍ آخرَ —
    // وذلك خلطُ هويّاتٍ صامتٌ لا خطأُ صيغة.
    const raw = signInitDataForTests(
      baseFields({ user: '{"id":9007199254740993}' }),
      BOT_TOKEN,
    );
    expect(rejectionOf(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW }))).toBe(
      InitDataRejection.MissingUser,
    );
  });

  it("يرفض معرِّفاً صفراً أو سالباً", () => {
    for (const id of [0, -7]) {
      const raw = signInitDataForTests(
        baseFields({ user: JSON.stringify({ id }) }),
        BOT_TOKEN,
      );
      expect(rejectionOf(() => verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW }))).toBe(
        InitDataRejection.MissingUser,
      );
    }
  });

  it("يُسقِط الحقولَ الغريبةَ ولا يُمرِّرها إلى المجال", () => {
    const raw = signInitDataForTests(
      baseFields({ user: JSON.stringify({ id: 42, is_admin: true, role: "admin" }) }),
      BOT_TOKEN,
    );
    const out = verifyTelegramInitData(raw, BOT_TOKEN, { now: NOW });
    // لا يُرقّي المُدخَلُ نفسَه: `is_admin` في الحمولةِ لا يعني شيئاً هنا.
    expect(Object.keys(out.user)).toEqual(["id"]);
  });
});

describe("رمزُ الروبوتِ وبصمةُ الرسالة", () => {
  it("يُلقي خطأَ تهيئةٍ لا رفضَ مُدخَلٍ حين لا رمزَ للروبوت", () => {
    const raw = signInitDataForTests(baseFields(), BOT_TOKEN);
    // النوعُ مقصودٌ: نشرةٌ نسيت الرمزَ يجب أن تتوقّفَ لا أن تردَّ 401 صامتةً.
    expect(() => verifyTelegramInitData(raw, "", { now: NOW })).toThrow(TypeError);
    expect(() => verifyTelegramInitData(raw, "short", { now: NOW })).toThrow(TypeError);
  });

  it("البصمةُ تختلف باختلافِ الرسالةِ وتثبت لنفسِ الرسالة", () => {
    const a = signInitDataForTests(baseFields(), BOT_TOKEN);
    const b = signInitDataForTests(baseFields({ query_id: "AAHother" }), BOT_TOKEN);
    expect(fingerprintInitData(a)).toBe(fingerprintInitData(a));
    expect(fingerprintInitData(a)).not.toBe(fingerprintInitData(b));
    expect(fingerprintInitData(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("البصمةُ ليست hash الواردةَ من تلغرام", () => {
    // لو كانت هي نفسَها لصار مفتاحُ منعِ الإعادةِ قيمةً يتحكّم بها المُدخَلُ
    // جزئيّاً؛ والبصمةُ يجب أن تُغطّيَ الرسالةَ كلَّها بما فيها التوقيع.
    const raw = signInitDataForTests(baseFields(), BOT_TOKEN);
    const hash = /hash=([0-9a-f]{64})/.exec(raw)?.[1];
    expect(hash).toBeDefined();
    expect(fingerprintInitData(raw)).not.toBe(hash);
  });
});

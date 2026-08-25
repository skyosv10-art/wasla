/**
 * حارسُ التركيبِ عند الجذر — `M0-01`.
 *
 * ## ما الثغرةُ التي يسدُّها هذا الملفّ؟
 *
 * اختباراتُ HTTP كلُّها تستورد `http/app.ts` — مصنعَ التطبيقِ النقيَّ الذي **يستلم** الخدماتِ
 * جاهزةً. ولا ملفَّ اختبارٍ واحدٍ يستورد `http/server.ts`، وهو **الموضعُ الوحيدُ** الذي
 * يُركّب فيه الإنتاجُ خدماتَه: يقرأ `DATABASE_URL`، ويبني المخزنَ، ويحقن الساعةَ ومُوَلِّدَ
 * المُعرِّفات. فكان مسارُ التركيبِ الحقيقيُّ غيرَ مُغطّىً بحرفٍ واحد، بينما 205 اختباراً
 * أخضرَ يوحي بالعكس.
 *
 * وهذه بعينِها الثغرةُ التي وقع فيها العيبُ المُدقَّق: خدمةٌ تُبنى بلا مُوَلِّدِ مُعرِّفاتٍ
 * محقونٍ. العيبُ **مُصلَحٌ الآن** — الأسطرُ تُمرِّر `uuidIdGenerator` فعلاً — لكنّ إصلاحاً بلا
 * حارسٍ يعود، ويعود صامتاً: `typecheck` لن يمنعه إن صار الوسيطُ اختيارياً يوماً، ولا اختبارُ
 * `app.ts` يراه أصلاً.
 *
 * ## ولمَ حارسٌ على النصِّ لا اختبارٌ سلوكيّ؟
 *
 * لأنّ البديلَ كان أسوأ. لاستدعاءِ `startSubscriptionServer()` سلوكياً نحتاج قاعدةً ومنفذاً
 * يُفتَح، فيصير الاختبارُ integration يحتاج Postgres — أي لا يعمل في الحصّةِ المجانيّةِ ولا
 * على جهازٍ بلا قاعدة، فيُتجاوَز فيعود المسارُ بلا غطاء. ولإخراجِ التركيبِ إلى ملفٍّ نقيٍّ
 * يُختبَر كان يجب أن يعرفَ ذلك الملفُّ الجديدُ المخزنَ، و`purity.test.ts` يحرس قائمةَ «من
 * يعرف القاعدة» **بالضبط** — فكان الثمنُ إضعافَ ضمانةٍ قائمةٍ لتقويةِ أخرى، وهذه مقايضةٌ
 * خاسرة.
 *
 * فالحارسُ هنا على نمطِ `purity.test.ts` نفسِه: يُحسب الواقعُ من المصدرِ لا من قائمةٍ
 * مكتوبة. وهو يمنع الانحدارَ في أجزاءٍ من الثانيةِ بلا قاعدةٍ ولا منفذ.
 *
 * وحدُّه مُعلَنٌ صراحةً: يُثبت **الوصلَ** لا صحّةَ زمنِ التشغيل. فإن كذب `runtime.ts` في
 * تنفيذِ مُوَلِّدِه فهذا ما تحرسه `purity.test.ts` و`events.test.ts`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");

function sourceFiles(directory: string = SRC): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "__tests__") continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (entry.endsWith(".ts")) found.push(path);
  }
  return found.sort();
}

/** الكودُ وحده: بلا تعليقات كتلةٍ ولا تعليقات سطر — فتعليقٌ يذكر اسماً لا يُحسب وصلاً. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

function readCode(file: string): string {
  return codeOnly(readFileSync(join(SRC, ...file.split("/")), "utf8"));
}

/**
 * وسائطُ كلِّ `new <اسم>(...)` في نصٍّ، بمُوازنةِ أقواس.
 *
 * ولمَ لا تعبيرٌ نمطيٌّ واحد؟ لأنّ `new X(a, f(b, c))` يجعل الفاصلةَ داخلَ وسيطٍ فاصلةً
 * بين وسيطين عند تعبيرٍ ساذج، فيمرّ نقصُ وسيطٍ أو يُرفض تركيبٌ سليم.
 */
function constructorArguments(code: string, className: string): readonly string[][] {
  const calls: string[][] = [];
  const needle = `new ${className}(`;
  let cursor = code.indexOf(needle);
  while (cursor !== -1) {
    let depth = 0;
    let index = cursor + needle.length - 1;
    const start = index + 1;
    for (; index < code.length; index += 1) {
      const character = code[index];
      if (character === "(") depth += 1;
      else if (character === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const inner = code.slice(start, index);
    const args: string[] = [];
    let buffer = "";
    let nested = 0;
    for (const character of inner) {
      if (character === "(" || character === "[" || character === "{") nested += 1;
      if (character === ")" || character === "]" || character === "}") nested -= 1;
      if (character === "," && nested === 0) {
        args.push(buffer.trim());
        buffer = "";
        continue;
      }
      buffer += character;
    }
    if (buffer.trim() !== "") args.push(buffer.trim());
    calls.push(args);
    cursor = code.indexOf(needle, index);
  }
  return calls;
}

const SERVER = "http/server.ts";

describe("الحارسُ نفسُه يعمل — فلا يمرّ على قائمةٍ فارغة", () => {
  it("يجد حدَّ التشغيلِ ويقرأ منه كوداً", () => {
    const code = readCode(SERVER);
    expect(code).toContain("startSubscriptionServer");
    expect(code).toContain("createSubscriptionApp");
  });

  it("حذفُ التعليقات يعمل — فاسمٌ في تعليقٍ لا يُحسب وصلاً", () => {
    expect(codeOnly("/* new SubscriptionService(a, b, c) */ const x = 1;")).not.toContain(
      "SubscriptionService",
    );
    expect(codeOnly("// new SubscriptionService(a)\nconst y = 2;")).not.toContain(
      "SubscriptionService",
    );
  });

  it("مُحلِّلُ الوسائطِ يوازن الأقواسَ فعلاً", () => {
    expect(constructorArguments("new S(a, f(b, c), d)", "S")).toEqual([["a", "f(b, c)", "d"]]);
    expect(constructorArguments("new S(uow, clock)", "S")).toEqual([["uow", "clock"]]);
    expect(constructorArguments("const x = 1;", "S")).toEqual([]);
  });
});

describe("تركيبُ الجذر — مصادرُ اللاحَتميّةِ محقونةٌ لا مُخترَعةٌ في الطبقة", () => {
  it("خدمةُ الاشتراكِ تُبنى بثلاثةِ وسائطَ: المخزنُ ثمّ الساعةُ ثمّ مُوَلِّدُ المُعرِّفات", () => {
    const calls = constructorArguments(readCode(SERVER), "SubscriptionService");
    expect(calls).toHaveLength(1);
    const [args] = calls;
    expect(args).toHaveLength(3);
    expect(args[1]).toBe("systemClock");
    expect(args[2]).toBe("uuidIdGenerator");
  });

  it("ولا موضعَ واحداً في المصدرِ كلِّه يبنيها بأقلَّ من ثلاثة", () => {
    const offences: string[] = [];
    for (const path of sourceFiles()) {
      const file = relative(SRC, path).split(sep).join("/");
      for (const args of constructorArguments(
        codeOnly(readFileSync(path, "utf8")),
        "SubscriptionService",
      )) {
        if (args.length !== 3) offences.push(`${file}: ${args.length} وسيطاً`);
      }
    }
    expect(offences).toEqual([]);
  });

  it("والساعةُ المحقونةُ واحدةٌ في الخدمتين — لا ساعتان تُنتجان فرقاً لا يُفسَّر", () => {
    const code = readCode(SERVER);
    const [subscription] = constructorArguments(code, "SubscriptionService");
    const [referral] = constructorArguments(code, "ReferralService");
    expect(referral).toHaveLength(2);
    expect(subscription[1]).toBe(referral[1]);
  });

  it("والساعةُ والمُوَلِّدُ يأتيان من `app/runtime.ts` لا يُعرَّفان هنا", () => {
    const code = readCode(SERVER);
    expect(code).toMatch(
      /import\s*\{[^}]*\bsystemClock\b[^}]*\buuidIdGenerator\b[^}]*\}\s*from\s*"\.\.\/app\/runtime\.js"/,
    );
    expect(code).not.toMatch(/\b(const|let|function|class)\s+(systemClock|uuidIdGenerator)\b/);
  });

  it("ولا يُولّد حدُّ التشغيلِ مُعرِّفاً ولا يقرأ ساعةً بنفسِه", () => {
    const code = readCode(SERVER);
    expect(code).not.toMatch(/randomUUID\s*\(/);
    expect(code).not.toMatch(/\bDate\s*\.\s*now\s*\(|new\s+Date\s*\(\s*\)/);
  });
});

describe("وضعُ الذاكرةِ يبقى بلا خدمات — الصحّةُ ناطقةٌ والعملياتُ 503", () => {
  it("مسارُ غيابِ `DATABASE_URL` لا يُمرِّر خدمةً ولا يبني مخزناً", () => {
    const code = readCode(SERVER);
    const memoryCall = code.match(/createSubscriptionApp\s*\(\s*\{\s*mode:\s*"memory"[^}]*\}\s*\)/);
    expect(memoryCall).not.toBeNull();
    expect(memoryCall?.[0]).not.toContain("services");
  });

  it("والمخزنُ لا يُبنى إلّا بعد التحقّقِ من العنوان", () => {
    const code = readCode(SERVER);
    const guard = code.indexOf("databaseUrl === undefined");
    expect(guard).toBeGreaterThan(-1);
    // يُقاس موضعُ **الاستدعاء** لا موضعُ الاسم: سطرُ الاستيرادِ يذكر `createSubscriptionDb`
    // في أعلى الملفِّ دائماً، فقياسُ الاسمِ وحدَه كان يجعل الحارسَ يرفض كوداً سليماً.
    const call = /createSubscriptionDb\s*\(/;
    expect(call.test(code.slice(0, guard))).toBe(false);
    expect(call.test(code.slice(guard))).toBe(true);
  });
});

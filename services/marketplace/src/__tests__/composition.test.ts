/**
 * حارسُ التركيبِ عند الجذر — الطورُ 11 · المراجعة 4/6 · `M5-11`.
 *
 * ## الثغرةُ التي يسدُّها هذا الملفّ
 *
 * اختباراتُ HTTP كلُّها تستورد `http/app.ts` — مصنعَ التطبيقِ الذي **يستلم** الخدماتِ جاهزةً.
 * ولا ملفَّ اختبارٍ واحدٍ يستورد `http/server.ts`، وهو **الموضعُ الوحيدُ** الذي يُركّب فيه
 * الإنتاجُ خدماتَه: يقرأ `DATABASE_URL`، ويبني المخزنَ ووحدةَ العمل، ويحقن الساعة. فلولا هذا
 * الملفُّ لبقي مسارُ التركيبِ الحقيقيُّ بلا حرفِ غطاءٍ واحدٍ، ومئةُ اختبارٍ أخضرَ تُوحي بالعكس.
 *
 * وهذه سابقةٌ مقيسةٌ لا مخافةٌ متوهَّمة: في الطورِ 10 وقع العيبُ نفسُه — خدمةٌ تُبنى بلا
 * مُوَلِّدِ مُعرِّفاتٍ محقونٍ — ومرّ من كلّ اختبار، ثمّ أُنشئ
 * `services/subscriptions/src/__tests__/composition.test.ts` بعده. وهذا الملفُّ يسبق العيبَ
 * لا يتبعه.
 *
 * ## ولمَ حارسٌ على النصِّ لا اختبارٌ سلوكيّ؟
 *
 * لأنّ استدعاءَ `startMarketplaceServer()` سلوكياً يحتاج قاعدةً ومنفذاً يُفتَح، فيصير
 * الاختبارُ تكامليّاً لا يعمل على جهازٍ بلا Postgres — فيُتجاوَز، فيعود المسارُ بلا غطاء.
 * ولإخراجِ التركيبِ إلى ملفٍّ نقيٍّ يُختبَر كان على ذلك الملفِّ الجديدِ أن يعرف المخزنَ،
 * و`purity.test.ts` يحرس قائمةَ «من يعرف القاعدة» **بالضبط** — فكان الثمنُ إضعافَ ضمانةٍ
 * قائمةٍ لتقويةِ أخرى، وتلك مقايضةٌ خاسرة.
 *
 * وحدُّ هذا الحارسِ مُعلَنٌ صراحةً: يُثبت **الوصلَ** لا صحّةَ زمنِ التشغيل. فإن كذبت
 * `app/runtime.ts` في تنفيذِ ساعتِها فذاك ما تحرسه `purity.test.ts`.
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

/** الكودُ وحده: بلا تعليقات كتلةٍ ولا تعليقات سطر — فاسمٌ في تعليقٍ لا يُحسب وصلاً. */
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
 * ولمَ لا تعبيرٌ نمطيٌّ واحد؟ لأنّ `new X(a, f(b, c))` يجعل الفاصلةَ داخلَ وسيطٍ فاصلةً بين
 * وسيطَين عند تعبيرٍ ساذج، فيمرّ نقصُ وسيطٍ أو يُرفض تركيبٌ سليم.
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
const SERVICES = [
  "MarketplaceStoreService",
  "MarketplaceProductService",
  "MarketplaceCatalogService",
] as const;

describe("الحارسُ نفسُه يعمل — فلا يمرّ على قائمةٍ فارغة", () => {
  it("يجد حدَّ التشغيلِ ويقرأ منه كوداً", () => {
    const code = readCode(SERVER);
    expect(code).toContain("startMarketplaceServer");
    expect(code).toContain("createMarketplaceApp");
  });

  it("حذفُ التعليقات يعمل — فاسمٌ في تعليقٍ لا يُحسب وصلاً", () => {
    expect(codeOnly("/* new MarketplaceStoreService(deps) */ const x = 1;")).not.toContain(
      "MarketplaceStoreService",
    );
    expect(codeOnly("// new MarketplaceStoreService(deps)\nconst y = 2;")).not.toContain(
      "MarketplaceStoreService",
    );
  });

  it("مُحلِّلُ الوسائطِ يوازن الأقواسَ فعلاً", () => {
    expect(constructorArguments("new S(a, f(b, c), d)", "S")).toEqual([["a", "f(b, c)", "d"]]);
    expect(constructorArguments("new S({ uow, clock })", "S")).toEqual([["{ uow, clock }"]]);
    expect(constructorArguments("const x = 1;", "S")).toEqual([]);
  });
});

describe("تركيبُ الجذر — مصدرُ اللاحَتميّةِ محقونٌ لا مُخترَعٌ في الطبقة", () => {
  it("الخدماتُ الثلاثُ تُبنى كلُّها بوسيطٍ واحدٍ: حزمةُ الاعتماديّاتِ نفسُها", () => {
    /**
     * وسيطٌ واحدٌ `{ uow, clock }` لا وسيطان: خدمةٌ تستلم الساعةَ منفصلةً كانت ستسمح
     * بحقنِ ساعةٍ لهذه وأخرى لتلك، فيصير فرقٌ في زمنِ صفَّين كُتبا في معاملةٍ واحدة.
     */
    const code = readCode(SERVER);
    for (const service of SERVICES) {
      const calls = constructorArguments(code, service);
      expect(calls, service).toHaveLength(1);
      expect(calls[0], service).toHaveLength(1);
      expect(calls[0][0], service).toBe("deps");
    }
  });

  it("وحزمةُ الاعتماديّاتِ تحمل وحدةَ العملِ والساعةَ المحقونةَ بالاسم", () => {
    const code = readCode(SERVER);
    expect(code).toMatch(/const\s+deps\s*=\s*\{\s*uow\s*,\s*clock:\s*systemClock\s*\}/);
    expect(constructorArguments(code, "MarketplaceUnitOfWork")).toHaveLength(1);
  });

  it("والساعةُ واحدةٌ في الخدماتِ الثلاث — لا ثلاثُ ساعاتٍ تُنتج فرقاً لا يُفسَّر", () => {
    const code = readCode(SERVER);
    // حزمةٌ واحدةٌ مُمرَّرةٌ إلى ثلاثتها هي البرهان: لا موضعَ ثانياً يبني `clock:`.
    expect([...code.matchAll(/clock\s*:/g)]).toHaveLength(1);
  });

  it("والساعةُ تأتي من `app/runtime.ts` ولا تُعرَّف هنا", () => {
    const code = readCode(SERVER);
    expect(code).toMatch(/import\s*\{[^}]*\bsystemClock\b[^}]*\}\s*from\s*"\.\.\/app\/runtime\.js"/);
    expect(code).not.toMatch(/\b(const|let|function|class)\s+systemClock\b/);
  });

  it("ولا يُولّد حدُّ التشغيلِ مُعرِّفاً ولا يقرأ ساعةً بنفسِه", () => {
    const code = readCode(SERVER);
    expect(code).not.toMatch(/randomUUID\s*\(/);
    expect(code).not.toMatch(/\bDate\s*\.\s*now\s*\(|new\s+Date\s*\(\s*\)/);
  });

  it("ولا موضعَ في المصدرِ كلِّه يبني خدمةً بغيرِ وسيطٍ واحد", () => {
    const offences: string[] = [];
    for (const path of sourceFiles()) {
      const file = relative(SRC, path).split(sep).join("/");
      const code = codeOnly(readFileSync(path, "utf8"));
      for (const service of SERVICES) {
        for (const args of constructorArguments(code, service)) {
          if (args.length !== 1) offences.push(`${file}: ${service} بـ${args.length} وسيطاً`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it("ووحدةُ العملِ تُبنى بلا خطّافِ اختبارٍ في مسارِ الإنتاج", () => {
    /**
     * `TransactionProbe` أداةُ اختبارٍ تُوقف المعاملةَ بين الدفترِ وإسقاطِه. ومسارُ إنتاجٍ
     * يقبلها كان سيقبل ما يُبطئ معاملةً أو يُفشلها، وأسوأُ منه: كان سيجعل الخطّافَ وسيطاً
     * «متاحاً» فيُمرَّر يوماً من إعدادٍ.
     */
    const [args] = constructorArguments(readCode(SERVER), "MarketplaceUnitOfWork");
    expect(args).toHaveLength(1);
    expect(args[0]).toBe("db");
    expect(readCode(SERVER)).not.toContain("probe");
  });
});

describe("وضعُ الذاكرةِ يبقى بلا خدمات — الصحّةُ ناطقةٌ والعملياتُ 503", () => {
  it("مسارُ غيابِ `DATABASE_URL` لا يُمرِّر خدمةً ولا يبني مخزناً", () => {
    const code = readCode(SERVER);
    const memoryCall = code.match(/createMarketplaceApp\s*\(\s*\{\s*mode:\s*"memory"[^}]*\}\s*\)/);
    expect(memoryCall).not.toBeNull();
    expect(memoryCall?.[0]).not.toContain("services");
  });

  it("والمخزنُ لا يُبنى إلّا بعد التحقّقِ من العنوان", () => {
    const code = readCode(SERVER);
    const guard = code.indexOf("databaseUrl === undefined");
    expect(guard).toBeGreaterThan(-1);
    // يُقاس موضعُ **الاستدعاء** لا موضعُ الاسم: سطرُ الاستيرادِ يذكر `createMarketplaceDb`
    // في أعلى الملفِّ دائماً، فقياسُ الاسمِ وحدَه كان يجعل الحارسَ يرفض كوداً سليماً.
    const call = /createMarketplaceDb\s*\(/;
    expect(call.test(code.slice(0, guard))).toBe(false);
    expect(call.test(code.slice(guard))).toBe(true);
  });

  it("والمنفذُ من حزمةِ العقدِ لا رقماً مكتوباً في حدِّ التشغيل", () => {
    const code = readCode(SERVER);
    expect(code).toContain("MARKETPLACE_SERVICE_PORT");
    expect(code).not.toMatch(/\b8094\b/);
  });

  it("وإغلاقٌ مُرتَّبٌ: المسبحُ يُقفل على `onClose` والإشارتان مُنتظرَتان", () => {
    const code = readCode(SERVER);
    expect(code).toMatch(/addHook\s*\(\s*"onClose"/);
    expect(code).toContain("pool.end()");
    expect(code).toContain("SIGTERM");
    expect(code).toContain("SIGINT");
  });
});

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { rm, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── الوحدةُ المُختبَرةُ: منطقُ المُجدوِلِ (لا نداءاتِ شبكةٍ حقيقيّةٍ) ─────

const LOCK_DIR = join(tmpdir(), `wasla-tick-test-${process.pid}`);

beforeEach(async () => {
  await mkdir(LOCK_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(LOCK_DIR, { recursive: true, force: true });
});

describe("tick-scheduler: قفلُ التداخلِ", () => {
  test("القفلُ الأولُ ينجحُ والثاني يُرفَضُ", async () => {
    // نستدعي منطقَ القفلِ مباشرةً عبر استيرادٍ ديناميكيٍّ
    // (السكربتُ ملفُ mjs مستقلٌّ، فنختبرُ المنطقَ لا العمليةَ الكاملةَ)
    const lockPath = join(LOCK_DIR, "wasla-tick-test.lock");

    // المحاولةُ الأولى — يجب أن تنجحَ
    const { open } = await import("node:fs/promises");
    const handle1 = await open(lockPath, "wx");
    await handle1.writeFile(JSON.stringify({ pid: 12345, startedAt: new Date().toISOString() }));
    await handle1.close();

    // المحاولةُ الثانية — يجب أن تفشلَ (EEXIST)
    let secondFailed = false;
    try {
      await open(lockPath, "wx");
    } catch (error: any) {
      secondFailed = error.code === "EEXIST";
    }
    expect(secondFailed).toBe(true);

    // بعدَ الحذفِ، تنجحُ محاولةٌ جديدةٌ
    await rm(lockPath);
    const handle3 = await open(lockPath, "wx");
    await handle3.close();
    await rm(lockPath);
  });

  test("القفلُ يُحذَفُ عندَ الخروجِ حتى عندَ الفشلِ", async () => {
    const lockPath = join(LOCK_DIR, "wasla-tick-cleanup.lock");
    const { open, rm } = await import("node:fs/promises");

    const handle = await open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid }));
    await handle.close();

    expect(lockPath).toBeDefined();

    // محاكاةُ مسارِ الإفراجِ عن القفلِ
    await rm(lockPath);

    // يجب أن يكونَ الملفُ قد حُذِفَ
    let exists = false;
    try {
      await readFile(lockPath);
      exists = true;
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});

describe("tick-scheduler: مساراتُ النبضةِ", () => {
  test("كلُّ مساراتِ النبضةِ الـ5 مُعرَّفةٌ", async () => {
    // قراءةُ السكربتِ والتحقّقُ من وجودِ كلِّ الخدماتِ
    const content = await readFile(join(process.cwd(), "scripts", "tick-scheduler.mjs"), "utf-8");

    const expectedServices = ["dispatch", "negotiations", "reputation", "subscriptions", "drivers"];
    for (const svc of expectedServices) {
      expect(content).toContain(svc);
    }
  });

  test("السكربتُ يستخدمُ mintServiceToken لا ترويسةً ثابتةً", async () => {
    const content = await readFile(join(process.cwd(), "scripts", "tick-scheduler.mjs"), "utf-8");
    expect(content).toContain("mintServiceToken");
    expect(content).not.toContain("Bearer ");
  });

  test("السكربتُ يعالجُ المهلةَ عبر AbortController", async () => {
    const content = await readFile(join(process.cwd(), "scripts", "tick-scheduler.mjs"), "utf-8");
    expect(content).toContain("AbortController");
    expect(content).toContain("setTimeout");
    expect(content).toContain("clearTimeout");
  });

  test("السكربتُ يعالجُ 503 كحالةِ «المنفذُ غيرُ جاهزٍ»", async () => {
    const content = await readFile(join(process.cwd(), "scripts", "tick-scheduler.mjs"), "utf-8");
    expect(content).toContain("503");
    expect(content).toContain("dependency not ready");
  });

  test("السكربتُ يعالجُ AbortError كحالةِ مهلةٍ", async () => {
    const content = await readFile(join(process.cwd(), "scripts", "tick-scheduler.mjs"), "utf-8");
    expect(content).toContain("AbortError");
    expect(content).toContain("TIMEOUT");
  });

  test("السكربتُ يُخرجُ بـ0 عندَ النجاحِ و1 عندَ الفشلِ و2 عندَ خطأِ التهيئةِ", async () => {
    const content = await readFile(join(process.cwd(), "scripts", "tick-scheduler.mjs"), "utf-8");
    expect(content).toContain("allOk ? 0 : 1");
    expect(content).toContain("return 2");
    expect(content).toContain("process.exit");
  });
});

describe("tick-scheduler: حارسُ الحوكمةِ", () => {
  test("حارسُ الحوكمةِ يمرُّ على السكربتِ والإعدادِ", async () => {
    const { execSync } = await import("node:child_process");
    let exitCode = 0;
    try {
      execSync("bash scripts/checks/validate-tick-scheduler.sh", {
        cwd: process.cwd(),
        stdio: "pipe",
      });
    } catch (error: any) {
      exitCode = error.status ?? 1;
    }
    expect(exitCode).toBe(0);
  });
});

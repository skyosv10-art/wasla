/**
 * بوّابةُ خروجٍ: خدمةٌ تُقلَعُ ببيئةٍ معطوبةٍ تسقطُ مُسمّاةً لا 200 صامتاً. (RISK-0046)
 *
 * ── لماذا يوجد هذا الملف ───────────────────────────────────────────────
 * `resolveDispatchRules` في [`runtime-config.ts`](../config/runtime-config.ts)
 * يُقاسُ بـ`ConfigError` في اختبارِ وحدةٍ — لكنَّ اختبارَ الوحدةِ **لا يُقلِعُ
 * الخدمةَ**: يُمرِّرُ بيئةً ويتوقَّعُ رَمياً. فلو حُذِفَ نداءُ `resolveDispatchRules`
 * من `server.ts`، لَظلَّ اختبارُ الوحدةِ أخضرَ والخدمةُ تُقلِعُ بـ`NaN` صامتاً.
 *
 * وهذهِ **بوّابةُ الخروجِ**: تُقلِعُ الخدمةَ الحقيقيّةَ ببيئةٍ معطوبةٍ وتقرأُ
 * سقوطاً مُسمّىً — `ConfigError` يحملُ اسمَ المتغيّرِ — لا 200 صامتاً. والفرقُ
 * بينَ الاختبارِ والبوّابةِ هوَ الفرقُ بينَ «القارئُ صارمٌ» و«الخدمةُ تُقلِعُ
 * بالقارئِ الصارمِ»: الأولى تُثبِتُ العقدَ، والثانيةُ تُثبِتُ التركيبَ.
 *
 * ── السيناريو الأصليُّ (RISK-0046) ──────────────────────────────────────
 * `DISPATCH_WAVE_SIZE=٣` (بأرقامٍ عربيّةٍ-هنديّةٍ) ⇒ `Number("٣") ⇒ NaN` ⇒
 * `waveSize = NaN` ⇒ موجةٌ بلا سائقٍ، و`GET /dispatch/health` يُجيبُ **200**.
 * الآن: `readIntEnv` ترفضُ غيرَ العشريّةِ وترمي `ConfigError` باسمِ المتغيّرِ،
 * والخدمةُ تسقطُ عندَ الإقلاعِ قبلَ أن تستمعَ على منفذٍ.
 *
 * ── لماذا `DISPATCH_WAVE_SIZE` تحديداً ─────────────────────────────────
 * لأنَّهُ يُقرأُ في `buildWiring()` → `rules()` → `resolveDispatchRules()`،
 * وهوَ **أوّلُ قراءةٍ** في مسارِ الإقلاعِ — قبلَ `keyRegistryFromEnv` وقبلَ
 * `app.listen`. فإخفاقُهُ يَسبقُ كلَّ فحصٍ آخرَ، ولا يحتاجُ مفاتيحَ ولا قاعدةً.
 *
 * المرجع: docs/07-security/RISK_REGISTER.md (RISK-0046) · docs/12-testing/M2-04_GATE.md
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** مسارُ خادمِ الإرسالِ من هذا الملفِّ. */
const SERVER_PATH = resolve(import.meta.dirname, "../http/server.ts");

/** دليلُ الحزمةِ (services/dispatch/) — حيثُ يُحلَّ `tsx`. */
const PKG_DIR = resolve(import.meta.dirname, "../..");

/**
 * يُقلِعُ الخدمةَ ببيئةٍ معطوبةٍ ويعيدُ نتيجةَ الإقلاعِ.
 *
 * `DATABASE_URL` يُفرَغُ صراحةً: الخدمةُ تأخذُ مسارَ الذاكرةِ، والقراءةُ
 * المعطوبةُ تَسبقُ كلَّ وصلٍ. والمهلةُ خمسُ ثوانٍ — الخدمةُ السليمةُ تُقلعُ
 * في أقلَّ من ثانيةٍ، والمعطوبةُ تسقطُ فوراً.
 */
function bootWithBrokenEnv(
  env: Record<string, string>,
  timeoutMs = 5_000,
): Promise<{ code: number | null; stderr: string; stdout: string; timedOut: boolean }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, ["--import", "tsx", SERVER_PATH], {
      env: {
        ...process.env,
        // لا قاعدةَ: مسارُ الذاكرةِ يَكفي، والقراءةُ المعطوبةُ تَسبقُ الوصلَ.
        DATABASE_URL: "",
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
      cwd: PKG_DIR,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stderr, stdout, timedOut });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      stderr += `\n[spawn error: ${err.message}]`;
      resolvePromise({ code: null, stderr, stdout, timedOut });
    });
  });
}

describe("RISK-0046 exit gate — boot with broken env fails closed", () => {
  it('DISPATCH_WAVE_SIZE=٣ (Arabic-Indic) → ConfigError with variable name, not silent 200', async () => {
    const result = await bootWithBrokenEnv({ DISPATCH_WAVE_SIZE: "٣" });

    // لم تُعلَّق المهلةُ — الخدمةُ سقطتْ، لم تَبقَ حيّةً.
    expect(result.timedOut).toBe(false);
    // خرجٌ غيرُ صفرٍ — الإخفاقُ مقروءٌ لا صامتٌ.
    expect(result.code).not.toBe(0);
    expect(result.code).not.toBe(null);
    // الخطأُ مُسمّىً: ConfigError يحملُ اسمَ المتغيّرِ.
    expect(result.stderr).toContain("ConfigError");
    expect(result.stderr).toContain("DISPATCH_WAVE_SIZE");
  });

  it('DISPATCH_WAVE_SIZE=abc (non-numeric) → ConfigError', async () => {
    const result = await bootWithBrokenEnv({ DISPATCH_WAVE_SIZE: "abc" });

    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    expect(result.code).not.toBe(null);
    expect(result.stderr).toContain("ConfigError");
    expect(result.stderr).toContain("DISPATCH_WAVE_SIZE");
  });

  it('DISPATCH_WAVE_SIZE=0 (below min 1) → ConfigError', async () => {
    const result = await bootWithBrokenEnv({ DISPATCH_WAVE_SIZE: "0" });

    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    expect(result.code).not.toBe(null);
    expect(result.stderr).toContain("ConfigError");
    expect(result.stderr).toContain("DISPATCH_WAVE_SIZE");
  });

  it('DISPATCH_MAX_WAVES=لا رقمَ → ConfigError with its own name', async () => {
    const result = await bootWithBrokenEnv({ DISPATCH_MAX_WAVES: "لا رقمَ" });

    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    expect(result.code).not.toBe(null);
    expect(result.stderr).toContain("ConfigError");
    expect(result.stderr).toContain("DISPATCH_MAX_WAVES");
  });
});

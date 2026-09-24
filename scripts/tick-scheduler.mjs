#!/usr/bin/env node
/**
 * tick-scheduler.mjs — مُجدوِلُ النبضاتِ الخارجيُّ (G8 · CLM-0328)
 *
 * يقيسُ وينفِّذُ دوراتِ النبضةِ (tick) لكلِّ خدمةٍ تمتلكُ مسارَ نبضةٍ.
 * مصمَّمٌ ليُشغَّلَ كـ Render Cron Job لا كعمليةٍ مستمرّةٍ داخلَ خدمةٍ.
 *
 * مبادئُ التصميمِ (مقتبسةٌ من الجردِ §4):
 *   - لا `setInterval` ولا `setTimeout` داخلَ أيِّ عمليةِ خدمةٍ.
 *   - كلُّ نبضةٍ متطابِقةٌ (idempotent) بالبناءِ — لا مؤشِّرَ «آخرُ معالَجٍ».
 *   - الأخطاءُ لا تُقتلُ العمليةَ ولا تُسكَتُ بلا سجلٍّ.
 *   - لا تداخلَ: إن كانَ مُجدوِلٌ آخرُ يعملُ، يخرجُ هذا بأمانٍ.
 *
 * الاستدعاءُ:
 *   node scripts/tick-scheduler.mjs
 *
 * متغيّراتُ البيئةِ:
 *   WASLA_SERVICE_AUTH_KEYS        — سجلُّ مفاتيحِ هويّةِ الخدمةِ (إلزاميٌّ)
 *   WASLA_SERVICE_AUTH_ACTIVE_KID  — معرِّفُ المفتاحِ النشطِّ (إلزاميٌّ)
 *   WASLA_TICK_SERVICES            — قائمةُ الخدماتِ (اختياريٌّ، افتراضيٌّ: كلُّ الخدماتِ)
 *   WASLA_TICK_BASE_URL_<SERVICE>  — عنوانُ URL الأساسيُّ لكلِّ خدمةٍ (إلزاميٌّ)
 *   WASLA_TICK_LOCK_DIR            — دليلُ ملفِّ القفلِ (اختياريٌّ، افتراضيٌّ: /tmp)
 *   WASLA_TICK_TIMEOUT_MS          — مهلةُ كلِّ نداءٍ بالميلي ثانيةِ (اختياريٌّ، افتراضيٌّ: 30000)
 *   WASLA_TICK_LOG_LEVEL           — مستوى التسجيل (debug · info · error · silent)
 *
 * الخروجُ:
 *   0 — كلُّ النبضاتِ نجحت أو تُخطّيت بأمانٍ
 *   1 — نبضةٌ واحدةٌ أو أكثر أخفقت
 *   2 — خطأُ تهيئةٍ (مفاتيحُ ناقصةٌ، خدماتُ غيرُ محدَّدةٍ)
 */

import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";

// ── تعريفُ النبضاتِ ────────────────────────────────────────────────────

/** كلُّ مساراتِ النبضةِ في المستودعِ — مقيسٌ من packages/authz-policy/src/operations.ts */
const TICK_ROUTES = [
  { service: "dispatch",      audience: "dispatch",      path: "/dispatch/tick",           scopes: ["dispatch:tick:write"] },
  { service: "negotiations",  audience: "negotiations",  path: "/negotiations/tick",       scopes: ["negotiations:tick:run"] },
  { service: "reputation",    audience: "reputation",    path: "/reputation/tick",         scopes: ["reputation:tick:run"] },
  { service: "subscriptions", audience: "subscriptions", path: "/subscriptions/tick",      scopes: ["subscriptions:tick:run"] },
  { service: "drivers",       audience: "drivers",       path: "/drivers/eligibility/tick", scopes: ["drivers:eligibility:tick"] },
];

const LOG_LEVELS = ["silent", "error", "info", "debug"] as const;
type LogLevel = typeof LOG_LEVELS[number];

function log(level: LogLevel, message: string) {
  const currentLevel = LOG_LEVELS.indexOf(getLogLevel());
  const messageLevel = LOG_LEVELS.indexOf(level);
  if (messageLevel <= currentLevel && currentLevel > 0) {
    const timestamp = new Date().toISOString();
    const prefix = level === "error" ? "✗" : level === "info" ? "✓" : "·";
    process.stderr.write(`[${timestamp}] ${prefix} ${message}\n`);
  }
}

let cachedLogLevel: LogLevel | null = null;
function getLogLevel(): LogLevel {
  if (cachedLogLevel !== null) return cachedLogLevel;
  const env = process.env.WASLA_TICK_LOG_LEVEL ?? "info";
  const level = LOG_LEVELS.includes(env as LogLevel) ? (env as LogLevel) : "info";
  cachedLogLevel = level;
  return level;
}

// ── قفلُ التداخلِ ──────────────────────────────────────────────────────

/**
 * قفلُ ملفٍّ بسيطٌ يمنعُ تداخلَ مُجدوِلَينِ. لا يعتمدُ على `flock` لأنَّ
 * Render Cron Jobs قد تُشغَّلُ في حاوياتٍ مختلفةٍ. يستخدمُ `O_EXCL` لإنشاءٍ
 * ذريٍّ، ويحذفُ الملفَّ عندَ الخروجِ.
 */
async function acquireLock(lockDir: string, serviceName: string): Promise<string | null> {
  const lockPath = join(lockDir, `wasla-tick-${serviceName}.lock`);
  try {
    await mkdir(lockDir, { recursive: true });
    const handle = await open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }));
    await handle.close();
    return lockPath;
  } catch (error: any) {
    if (error.code === "EEXIST") {
      return null; // مُجدوِلٌ آخرُ يعملُ
    }
    throw error;
  }
}

async function releaseLock(lockPath: string) {
  try {
    await rm(lockPath);
  } catch {
    // تجاهلُ الأخطاءِ عندَ الحذفِ — لا يُقتلُ العمليةُ لسببٍ كهذا
  }
}

// ── توكيلُ النداءِ ──────────────────────────────────────────────────────

/**
 * يُنتِجُ رمزَ هويّةِ خدمةٍ للنداءِ. يستخدمُ `@wasla/service-auth` مباشرةً.
 * إن لم يُمكن استيرادُ الحزمةِ (بيئةٌ بلا node_modules)، يخرجُ بخطأٍ واضحٍ.
 */
async function mintToken(
  serviceName: string,
  audience: string,
  path: string,
  scopes: readonly string[],
  method: string,
): Promise<string> {
  const { keyRegistryFromEnv } = await import("@wasla/service-auth/keys.js");
  const { mintServiceToken } = await import("@wasla/service-auth/token.js");

  const keys = keyRegistryFromEnv(process.env as Record<string, string | undefined>);
  return mintServiceToken({
    serviceName,
    audience,
    scopes,
    method,
    path,
    keys,
    now: new Date(),
    jti: randomUUID(),
  });
}

/**
 * ينفِّذُ نداءَ نبضةٍ واحدًا. يُعيدُ `true` عندَ النجاحِ و`false` عندَ الفشلِ.
 */
async function callTick(
  service: string,
  audience: string,
  path: string,
  scopes: readonly string[],
  baseUrl: string,
  timeoutMs: number,
): Promise<boolean> {
  const url = `${baseUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const token = await mintToken("tick-scheduler", audience, path, scopes, "POST");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-wasla-service-auth": token,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    if (response.ok) {
      log("info", `${service}: tick OK (${response.status})`);
      return true;
    }

    // 503 يعني أنَّ المنفذَ غيرَ مُهيَّأٍ — ليس خطأً قاتلًا
    if (response.status === 503) {
      log("info", `${service}: tick 503 (dependency not ready — skipping)`);
      return true;
    }

    const body = await response.text().catch(() => "<unreadable>");
    log("error", `${service}: tick FAILED (${response.status}) ${body.slice(0, 200)}`);
    return false;
  } catch (error: any) {
    if (error.name === "AbortError") {
      log("error", `${service}: tick TIMEOUT after ${timeoutMs}ms`);
    } else {
      log("error", `${service}: tick ERROR ${error.message}`);
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ── النقطةُ الرئيسةُ ───────────────────────────────────────────────────

async function main(): Promise<number> {
  const lockDir = process.env.WASLA_TICK_LOCK_DIR ?? "/tmp";
  const timeoutMs = parseInt(process.env.WASLA_TICK_TIMEOUT_MS ?? "30000", 10);
  const servicesFilter = process.env.WASLA_TICK_SERVICES?.split(",").map(s => s.trim()).filter(Boolean);

  const ticks = servicesFilter
    ? TICK_ROUTES.filter(t => servicesFilter.includes(t.service))
    : TICK_ROUTES;

  if (ticks.length === 0) {
    log("error", "لا نبضاتٍ للتنفيذِ — WASLA_TICK_SERVICES لا تطابق أيَّ خدمةٍ");
    return 2;
  }

  // التحقّقُ من مفاتيحِ الهويّةِ قبلَ البدءِ
  try {
    await mintToken("tick-scheduler", ticks[0].audience, ticks[0].path, ticks[0].scopes, "POST");
  } catch (error: any) {
    log("error", `فشلُ تهيئةِ مفاتيحِ الهويّةِ: ${error.message}`);
    return 2;
  }

  let allOk = true;

  for (const tick of ticks) {
    const baseUrl = process.env[`WASLA_TICK_BASE_URL_${tick.service.toUpperCase()}`];
    if (!baseUrl) {
      log("error", `${tick.service}: WASLA_TICK_BASE_URL_${tick.service.toUpperCase()} غيرُ محدَّدٍ`);
      allOk = false;
      continue;
    }

    // قفلُ التداخلِ
    const lockPath = await acquireLock(lockDir, tick.service);
    if (lockPath === null) {
      log("info", `${tick.service}: tick SKIP (another scheduler holds the lock)`);
      continue;
    }

    try {
      const ok = await callTick(tick.service, tick.audience, tick.path, tick.scopes, baseUrl, timeoutMs);
      if (!ok) allOk = false;
    } finally {
      await releaseLock(lockPath);
    }
  }

  return allOk ? 0 : 1;
}

const exitCode = await main();
process.exit(exitCode);

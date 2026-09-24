/**
 * scheduler.ts — منطقُ مُجدوِلِ النبضاتِ الخارجيِّ (G8 · M2-09A · CLM-0330).
 *
 * ── العيبُ المقيسُ الذي عولِجَ هنا ─────────────────────────────────────────
 * السلفُ `scripts/tick-scheduler.mjs` (CLM-0328) **لم يكن قابلًا للتشغيلِ**:
 * صياغةُ TypeScript داخلَ `.mjs` (`node --check` ← `SyntaxError: Unexpected
 * identifier 'as'`)، واستيرادُ `@wasla/service-auth/keys.js` وهو مسارٌ فرعيٌّ
 * غيرُ مُصدَّرٍ من حزمةٍ لا يعتمدُ عليها جذرُ المستودعِ أصلًا، واختباراتٌ تسعةٌ
 * لا تستوردُ السكربتَ فتقيسُ `node:fs` لا المُجدوِلَ. فانتقلَ المنطقُ إلى حزمةِ
 * فضاءِ عملٍ حقيقيّةٍ يحلُّها مدخلُ الصورةِ (`WASLA_SERVICE=@wasla/tick-scheduler`)
 * وتختبرُها الاختباراتُ بالاستيرادِ لا بالبحثِ عن نصٍّ.
 *
 * ── ولِمَ 503 فشلٌ لا نجاحٌ ────────────────────────────────────────────────
 * السلفُ عَدَّ 503 «نجاحًا متخطّى» ويخرجُ بـ0. لكنَّ 503 من هذه المساراتِ معناهُ
 * أنَّ النبضةَ **لم تجرِ** (منفذٌ غيرُ مُركَّبٍ أو مخزنُ إعادةٍ غيرُ متاحٍ). عدُّهُ
 * نجاحًا يجعلُ وظيفةَ cron خضراءَ أبدًا بينما لا شيءَ يتقدّمُ — كذبٌ في القياسِ.
 * فصارَ نتيجةً مُسمّاةً `unavailable` تُسقِطُ الخروجَ (1)، والسجلُّ يفرّقُها عن
 * `failed` كي يُعرَفَ العلاجُ.
 *
 * ── وما لا يُدَّعى ──────────────────────────────────────────────────────────
 * قفلُ الملفِّ يمنعُ التداخلَ **داخلَ حاويةٍ واحدةٍ** فقط؛ كلُّ تشغيلٍ لـRender
 * Cron Job حاويةٌ جديدةٌ، فعدمُ التداخلِ بينَ التشغيلاتِ مصدرُهُ المنصّةُ لا هذا
 * القفلُ. وتطابُقُ النبضةِ (idempotency) مصدرُهُ الخدمةُ نفسُها.
 */
import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  createServiceRequestSigner,
  keyRegistryFromEnv,
  type ServiceAuthKeyRegistry,
  type ServiceRequestSigner,
} from "@wasla/service-auth";
import { postTick } from "./infrastructure/http-tick.js";

export interface TickRoute {
  readonly service: string;
  readonly audience: string;
  readonly method: "POST";
  readonly path: string;
  readonly scopes: readonly string[];
}

/**
 * ثوابتُ الصلاحيّاتِ — كلٌّ منها **دليلُ منحٍ** في `PRODUCTION_GRANTS["tick-scheduler"]`
 * (`packages/authz-policy/src/grants.ts`). صلاحيّةٌ واحدةٌ لكلِّ جمهورٍ: نبضتُهُ لا غيرُ.
 */
export const TICK_SCHEDULER_DISPATCH_SCOPES: readonly string[] = ["dispatch:tick:write"];
export const TICK_SCHEDULER_NEGOTIATIONS_SCOPES: readonly string[] = ["negotiations:tick:run"];
export const TICK_SCHEDULER_REPUTATION_SCOPES: readonly string[] = ["reputation:tick:run"];
export const TICK_SCHEDULER_SUBSCRIPTIONS_SCOPES: readonly string[] = ["subscriptions:tick:run"];
export const TICK_SCHEDULER_DRIVERS_SCOPES: readonly string[] = ["drivers:eligibility:tick"];

/** كلُّ مساراتِ النبضةِ — مقيسةٌ من `packages/authz-policy/src/operations.ts` (يفرضُ الاختبارُ التطابقَ). */
export const TICK_ROUTES: readonly TickRoute[] = [
  { service: "dispatch", audience: "dispatch", method: "POST", path: "/dispatch/tick", scopes: TICK_SCHEDULER_DISPATCH_SCOPES },
  { service: "negotiations", audience: "negotiations", method: "POST", path: "/negotiations/tick", scopes: TICK_SCHEDULER_NEGOTIATIONS_SCOPES },
  { service: "reputation", audience: "reputation", method: "POST", path: "/reputation/tick", scopes: TICK_SCHEDULER_REPUTATION_SCOPES },
  { service: "subscriptions", audience: "subscriptions", method: "POST", path: "/subscriptions/tick", scopes: TICK_SCHEDULER_SUBSCRIPTIONS_SCOPES },
  { service: "drivers", audience: "drivers", method: "POST", path: "/drivers/eligibility/tick", scopes: TICK_SCHEDULER_DRIVERS_SCOPES },
];

/**
 * المُوقِّعونَ الخمسةُ — **حرفيّونَ بقصدٍ** لا حلقةً: الفحصُ 16 يقرأُ كلَّ ثلاثيّةِ
 * (دورٍ · جمهورٍ · ثابتٍ) ساكنًا ويطابقُها مع المصفوفةِ، و`createServiceRequestSigner`
 * يُنادي `assertSignerComposition` فيرفضُ في زمنِ التشغيلِ ما لم يُمنَح.
 */
export function buildSigners(keys: ServiceAuthKeyRegistry, now: () => Date): Readonly<Record<string, ServiceRequestSigner>> {
  return {
    dispatch: createServiceRequestSigner({ serviceName: "tick-scheduler", audience: "dispatch", keys, scopes: TICK_SCHEDULER_DISPATCH_SCOPES, now }),
    negotiations: createServiceRequestSigner({ serviceName: "tick-scheduler", audience: "negotiations", keys, scopes: TICK_SCHEDULER_NEGOTIATIONS_SCOPES, now }),
    reputation: createServiceRequestSigner({ serviceName: "tick-scheduler", audience: "reputation", keys, scopes: TICK_SCHEDULER_REPUTATION_SCOPES, now }),
    subscriptions: createServiceRequestSigner({ serviceName: "tick-scheduler", audience: "subscriptions", keys, scopes: TICK_SCHEDULER_SUBSCRIPTIONS_SCOPES, now }),
    drivers: createServiceRequestSigner({ serviceName: "tick-scheduler", audience: "drivers", keys, scopes: TICK_SCHEDULER_DRIVERS_SCOPES, now }),
  };
}

/** اسمُ المُنادي في الرمزِ — ثابتٌ كي يُقرأَ في سجلّاتِ الخدماتِ مصدرًا واحدًا. */
export const SCHEDULER_SERVICE_NAME = "tick-scheduler";

export const EXIT_OK = 0;
export const EXIT_TICK_FAILED = 1;
export const EXIT_CONFIG = 2;

export type TickOutcome =
  | { readonly service: string; readonly outcome: "ok"; readonly status: number }
  | { readonly service: string; readonly outcome: "unavailable"; readonly status: 503 }
  | { readonly service: string; readonly outcome: "failed"; readonly status?: number; readonly reason: string }
  | { readonly service: string; readonly outcome: "timeout"; readonly timeoutMs: number }
  | { readonly service: string; readonly outcome: "locked" }
  | { readonly service: string; readonly outcome: "misconfigured"; readonly reason: string };

export interface RunResult {
  readonly exitCode: number;
  readonly outcomes: readonly TickOutcome[];
  readonly configError?: string;
}

export type Logger = (level: "info" | "error", message: string) => void;

export interface RunDependencies {
  readonly env: Record<string, string | undefined>;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly log: Logger;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function parseTimeout(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export function selectTicks(filter: string | undefined): readonly TickRoute[] | string {
  if (filter === undefined || filter.trim() === "") return TICK_ROUTES;
  const wanted = filter.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = wanted.filter((w) => !TICK_ROUTES.some((t) => t.service === w));
  if (unknown.length > 0) return `WASLA_TICK_SERVICES يسمّي خدماتٍ بلا مسارِ نبضةٍ: ${unknown.join(",")}`;
  return TICK_ROUTES.filter((t) => wanted.includes(t.service));
}

/**
 * عنوانُ كلِّ خدمةٍ — **قراءاتٌ حرفيّةٌ بقصدٍ** لا اسمٌ مُركَّبٌ: ماسحُ مخطَّطِ الإعدادِ
 * (`validate-config-schema.sh`) يرى `env.X` ولا يرى `env[\`…${x}\`]`، والقراءةُ
 * المُركَّبةُ كانت ستُخفي خمسةَ متغيّراتٍ عن السجلِّ.
 */
function baseUrls(env: Record<string, string | undefined>): Readonly<Record<string, string | undefined>> {
  return {
    dispatch: env.WASLA_TICK_BASE_URL_DISPATCH,
    negotiations: env.WASLA_TICK_BASE_URL_NEGOTIATIONS,
    reputation: env.WASLA_TICK_BASE_URL_REPUTATION,
    subscriptions: env.WASLA_TICK_BASE_URL_SUBSCRIPTIONS,
    drivers: env.WASLA_TICK_BASE_URL_DRIVERS,
  };
}

export function baseUrlVar(service: string): string {
  return `WASLA_TICK_BASE_URL_${service.toUpperCase()}`;
}

async function acquireLock(lockDir: string, service: string): Promise<string | null> {
  const lockPath = join(lockDir, `wasla-tick-${service}.lock`);
  await mkdir(lockDir, { recursive: true });
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await handle.close();
    return lockPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw error;
  }
}

async function releaseLock(lockPath: string): Promise<void> {
  await rm(lockPath, { force: true });
}

export async function runTicks(deps: RunDependencies): Promise<RunResult> {
  const { env, log } = deps;
  const selected = selectTicks(env.WASLA_TICK_SERVICES);
  if (typeof selected === "string") return configFailure(log, selected);
  if (selected.length === 0) return configFailure(log, "لا نبضاتٍ للتنفيذِ");

  const timeoutMs = parseTimeout(env.WASLA_TICK_TIMEOUT_MS);
  if (timeoutMs === undefined) return configFailure(log, "WASLA_TICK_TIMEOUT_MS ليس عددًا صحيحًا موجبًا");

  let signers: Readonly<Record<string, ServiceRequestSigner>>;
  try {
    signers = buildSigners(keyRegistryFromEnv(env), deps.now);
  } catch (error) {
    return configFailure(log, `فشلُ تهيئةِ مفاتيحِ الهويّةِ أو المُوقِّعِ: ${(error as Error).message}`);
  }

  const lockDir = env.WASLA_TICK_LOCK_DIR ?? "/tmp";
  const urls = baseUrls(env);
  const outcomes: TickOutcome[] = [];

  for (const tick of selected) {
    const baseUrl = urls[tick.service];
    if (baseUrl === undefined || baseUrl.trim() === "") {
      outcomes.push({ service: tick.service, outcome: "misconfigured", reason: `${baseUrlVar(tick.service)} غيرُ محدَّدٍ` });
      continue;
    }
    const lockPath = await acquireLock(lockDir, tick.service);
    if (lockPath === null) {
      outcomes.push({ service: tick.service, outcome: "locked" });
      continue;
    }
    try {
      outcomes.push(await postTick(deps.fetch, tick, baseUrl.replace(/\/+$/, ""), timeoutMs, signers[tick.service]!));
    } finally {
      await releaseLock(lockPath);
    }
  }

  for (const o of outcomes) log(o.outcome === "ok" || o.outcome === "locked" ? "info" : "error", `${o.service}: ${JSON.stringify(o)}`);
  const allOk = outcomes.every((o) => o.outcome === "ok" || o.outcome === "locked");
  return { exitCode: allOk ? EXIT_OK : EXIT_TICK_FAILED, outcomes };
}

function configFailure(log: Logger, message: string): RunResult {
  log("error", message);
  return { exitCode: EXIT_CONFIG, outcomes: [], configError: message };
}

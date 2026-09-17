/**
 * بناءُ حارسِ الإعادةِ من البيئةِ — **التصديرُ الفرعيُّ** `@wasla/service-auth/replay-store`
 * (M1-03 · إغلاقُ `RISK-0015` · [ADR-035](../../../docs/15-decisions/ADR-035-distributed-service-token-replay-store.md)).
 *
 * ── لِمَ مِغلافٌ واحدٌ ولا سطرٌ في كلِّ جذرِ إقلاعٍ ────────────────────────────
 * أربعةَ عشرَ جذرَ إقلاعٍ كانت تكتبُ `new InMemoryServiceTokenReplayGuard()` — أي
 * أربعةَ عشرَ قراراً مستقلّاً في أربعةَ عشرَ ملفّاً، وكلُّ واحدٍ منها قابلٌ للانحرافِ
 * وحدَهُ. فحينَ يصيرُ المخزنُ مشترَكاً يجبُ أن يصيرَ **القرارُ واحداً**: هذا
 * المِغلافُ هوَ الموضعُ الوحيدُ الذي يُقرِّرُ أيَّ مخزنٍ يُبنى ومتى يُرفَضُ الإقلاعُ،
 * وحارسُ `validate-replay-store.sh` يمنعُ عودةَ القرارِ إلى الجذورِ.
 *
 * ── والافتراضُ آمنٌ لا مُريحٌ ─────────────────────────────────────────────
 * `postgres` هوَ النمطُ الافتراضيُّ، ومخزنُ الذاكرةِ **يُطلَبُ صراحةً** ولا يُورَثُ
 * بالسكوتِ، ويُرفَضُ في `NODE_ENV=production` مهما طُلِبَ. فالنسيانُ يُنتِجُ سقوطاً
 * عندَ الإقلاعِ برسالةٍ تُسمّي المتغيّرَ، لا حدّاً يُقبَلُ فيهِ الرمزُ مرّةً لكلِّ نسخةٍ.
 *
 * ── و`pg` تُستورَدُ استيراداً ديناميكيّاً ─────────────────────────────────────
 * جذرُ الحزمةِ يبقى بلا تبعيّةِ قاعدةِ بياناتٍ (كما بقيَ بلا Fastify): من يستوردُ
 * هذا التصديرَ الفرعيَّ يملكُ `pg` أصلاً في خدمتِهِ، ومن لا يستوردُهُ لا يحملُها.
 */

import { readRawEnv, readPostgresUrlEnv, type EnvBag } from "@wasla/config";

import {
  InMemoryServiceTokenReplayGuard,
  ServiceTokenReplayStoreUnavailableError,
  type ServiceTokenReplayDecision,
  type ServiceTokenReplayGuard,
  type ServiceTokenReplayRecord,
} from "./replay.js";
import {
  ensureServiceTokenReplaySchema,
  PostgresServiceTokenReplayGuard,
  type PostgresReplayGuardOptions,
  type ReplaySqlExecutor,
} from "./replay-postgres.js";

/** أسماءُ المتغيّراتِ — مُعلَنةٌ ثوابتَ كي لا تُكتَبَ حرفيّاً في موضعَينِ. */
export const REPLAY_STORE_MODE_ENV = "WASLA_SERVICE_TOKEN_REPLAY_MODE";
export const REPLAY_STORE_URL_ENV = "WASLA_SERVICE_TOKEN_REPLAY_URL";

/** الأنماطُ المقبولةُ. لا نمطَ ثالثٌ ضمنيٌّ: ما ليسَ منها يُرفَضُ باسمِهِ. */
export const REPLAY_STORE_MODES = ["postgres", "memory"] as const;
export type ReplayStoreMode = (typeof REPLAY_STORE_MODES)[number];

/**
 * إعدادُ المخزنِ غيرُ صالحٍ. **تُلقى عندَ الإقلاعِ** لا عندَ أوّلِ نداءٍ: خدمةٌ
 * أقلعت ثمَّ سقطت على أوّلِ رمزٍ تُخفي العطبَ في سجلٍّ، وخدمةٌ لم تُقلِعْ تُظهِرُهُ
 * في النشرةِ نفسِها.
 */
export class ReplayStoreConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ReplayStoreConfigError";
  }
}

function readMode(env: EnvBag): ReplayStoreMode {
  const raw = readRawEnv(env, REPLAY_STORE_MODE_ENV);
  if (raw === undefined || raw === "") return "postgres";
  if ((REPLAY_STORE_MODES as readonly string[]).includes(raw)) {
    return raw as ReplayStoreMode;
  }
  throw new ReplayStoreConfigError(
    `${REPLAY_STORE_MODE_ENV}="${raw}" غيرُ معروفٍ — المقبولُ: ${REPLAY_STORE_MODES.join(" · ")}.`,
  );
}

export interface CreateReplayGuardOptions extends PostgresReplayGuardOptions {
  /**
   * مُنشئُ المُنفِّذِ. يُمرَّرُ في الاختبارِ كي يُقاسَ القرارُ بلا شبكةٍ، ويُترَكُ
   * في الإنتاجِ فيُبنى من `pg` باستيرادٍ ديناميكيٍّ.
   */
  readonly createExecutor?: (connectionString: string) => Promise<{
    executor: ReplaySqlExecutor;
    close?: () => Promise<void>;
  }>;
}

/** ما يُعيدُهُ المِغلافُ: الحارسُ ومِغلاقُهُ (للاختبارِ والإيقافِ النظيفِ). */
export interface ServiceTokenReplayStore {
  readonly guard: ServiceTokenReplayGuard;
  readonly mode: ReplayStoreMode;
  readonly close: () => Promise<void>;
}

async function createPgExecutor(connectionString: string): Promise<{
  executor: ReplaySqlExecutor;
  close?: () => Promise<void>;
}> {
  let pg: typeof import("pg");
  try {
    pg = await import("pg");
  } catch (cause) {
    throw new ReplayStoreConfigError(
      "الحزمةُ `pg` غيرُ متوفّرةٍ، فمخزنُ الآثارِ المشترَكُ لا يُبنى — أضِفْها إلى الخدمةِ أو اطلبْ نمطَ الذاكرةِ صراحةً في التطويرِ.",
      { cause },
    );
  }
  const Pool = (pg.default ?? pg).Pool;
  const pool = new Pool({ connectionString, max: 4 });
  return {
    executor: {
      query: (sql, params) =>
        pool.query(sql, params as unknown[]) as Promise<{
          rowCount: number | null;
        }>,
    },
    close: () => pool.end(),
  };
}

/**
 * يبني مخزنَ الآثارِ من البيئةِ ويُهيِّئُ مخطَّطَهُ.
 *
 * القراراتُ كلُّها هنا وفي موضعٍ واحدٍ:
 *  · النمطُ الافتراضيُّ `postgres`، و`memory` يُطلَبُ صراحةً ويُمنَعُ في الإنتاجِ.
 *  · الوصلةُ: `WASLA_SERVICE_TOKEN_REPLAY_URL` ثمَّ `DATABASE_URL` — فمن لا يملكُ
 *    قاعدةً مستقلّةً للآثارِ يستعملُ قاعدةَ خدمتِهِ، ومن يملكُها يُوجِّهُها بمتغيّرٍ
 *    واحدٍ بلا تغييرِ شفرةٍ.
 *  · غيابُ الوصلةِ في نمطِ `postgres` **يُسقِطُ الإقلاعَ** ولا يهبطُ إلى الذاكرةِ:
 *    الهبوطُ الصامتُ إلى الذاكرةِ هوَ العطبُ الذي أُغلِقَ، فلا يُعادُ بابُهُ افتراضاً.
 */
export async function createServiceTokenReplayStore(
  env: EnvBag,
  options: CreateReplayGuardOptions = {},
): Promise<ServiceTokenReplayStore> {
  const resolved = resolveReplayStoreConfig(env);

  if (resolved.mode === "memory") {
    const guard = new InMemoryServiceTokenReplayGuard({
      retentionSkewSeconds: options.retentionSkewSeconds,
      now: options.now,
    });
    return { guard, mode: "memory", close: async () => {} };
  }

  const { mode, url } = resolved;

  const factory = options.createExecutor ?? createPgExecutor;
  const { executor, close } = await factory(url);
  try {
    await ensureServiceTokenReplaySchema(executor);
  } catch (cause) {
    await close?.();
    throw new ReplayStoreConfigError(
      "تهيئةُ جدولِ آثارِ الرموزِ أخفقت، فالخدمةُ لا تُقلِعُ بلا حارسِ إعادةٍ.",
      { cause },
    );
  }

  const guard = new PostgresServiceTokenReplayGuard(executor, {
    retentionSkewSeconds: options.retentionSkewSeconds,
    now: options.now,
    sweepIntervalMs: options.sweepIntervalMs,
    onSweepError: options.onSweepError,
  });
  return { guard, mode, close: async () => close?.() };
}

/**
 * قرارُ البيئةِ — النمطُ والوصلةُ — مفصولاً عن الاتّصالِ.
 *
 * الفصلُ مقصودٌ: **الخطأُ في الإعدادِ يُقاسُ بلا شبكةٍ**، فيُلقى عندَ الإقلاعِ حتماً
 * ولو كانت قاعدةُ البياناتِ ساقطةً في تلكَ اللحظةِ. وما بعدَهُ — الاتّصالُ
 * والمخطَّطُ — عُطبٌ تشغيليٌّ لا إعداديٌّ، وجوابُهُ 503 لا سقوطُ إقلاعٍ.
 */
export type ResolvedReplayStoreConfig =
  | { readonly mode: "memory" }
  | { readonly mode: "postgres"; readonly url: string };

export function resolveReplayStoreConfig(env: EnvBag): ResolvedReplayStoreConfig {
  const mode = readMode(env);

  if (mode === "memory") {
    if (readRawEnv(env, "NODE_ENV") === "production") {
      throw new ReplayStoreConfigError(
        `${REPLAY_STORE_MODE_ENV}=memory مرفوضٌ في NODE_ENV=production — مخزنُ الذاكرةِ يقبلُ الرمزَ مرّةً لكلِّ نسخةٍ (RISK-0015).`,
      );
    }
    return { mode };
  }

  const url =
    readPostgresUrlEnv(env, REPLAY_STORE_URL_ENV) ??
    readPostgresUrlEnv(env, "DATABASE_URL");
  if (url === undefined) {
    throw new ReplayStoreConfigError(
      `مخزنُ آثارِ الرموزِ يحتاجُ وصلةً: عيِّنْ ${REPLAY_STORE_URL_ENV} أو DATABASE_URL. ولا هبوطَ إلى الذاكرةِ بالسكوتِ — اطلبْ ${REPLAY_STORE_MODE_ENV}=memory صراحةً في التطويرِ.`,
    );
  }
  return { mode, url };
}

/**
 * المِغلافُ القصيرُ لجذورِ الإقلاعِ: حارسٌ وحدَهُ، **ومُتزامِنٌ**.
 *
 * ── لِمَ مُتزامِنٌ ولا `await` في أربعةَ عشرَ جذراً ──────────────────────────
 * جعلُ البناءِ غيرَ متزامنٍ كانَ سيُعدي `async` من `serviceIdentityWiring` إلى
 * `buildBotApp` إلى `buildApp` في ثلاثةِ بوتاتٍ وإلى مِرقاتِ الاختبارِ من بعدِها —
 * انتشارٌ واسعٌ ثمنُهُ مِلفّاتٌ لا علاقةَ لها بالخطرِ المُغلَقِ. والمطلوبُ نفسُهُ
 * يتحقَّقُ بفصلٍ أدقَّ: **الإعدادُ يُقاسُ الآنَ** (فالنسيانُ يُسقِطُ الإقلاعَ كما
 * كانَ)، و**الاتّصالُ يُؤجَّلُ إلى أوّلِ قرارٍ**.
 *
 * ── وما يجري حينَ يُخفِقُ الاتّصالُ ───────────────────────────────────────
 * التهيئةُ المُخفِقةُ **لا تُحفَظُ**: كلُّ نداءٍ يُعيدُ المحاولةَ، فقاعدةٌ عادت بعدَ
 * انقطاعٍ تُشفي الخدمةَ بلا إعادةِ نشرٍ. وحتّى تعودَ، الجوابُ
 * `ServiceTokenReplayStoreUnavailableError` أي 503 مُغلَقاً — لا قبولاً بلا حارسٍ.
 */
export function createServiceTokenReplayGuardFromEnv(
  env: EnvBag,
  options: CreateReplayGuardOptions = {},
): ServiceTokenReplayGuard {
  const resolved = resolveReplayStoreConfig(env);

  if (resolved.mode === "memory") {
    return new InMemoryServiceTokenReplayGuard({
      retentionSkewSeconds: options.retentionSkewSeconds,
      now: options.now,
    });
  }

  let pending: Promise<ServiceTokenReplayGuard> | null = null;
  const open = async (): Promise<ServiceTokenReplayGuard> => {
    pending ??= createServiceTokenReplayStore(env, options).then(
      ({ guard }) => guard,
      (cause: unknown) => {
        // إخفاقُ الفتحِ لا يُحفَظُ، كي لا تبقى الخدمةُ ساقطةً بعدَ عودةِ القاعدةِ.
        pending = null;
        throw new ServiceTokenReplayStoreUnavailableError(
          "مخزنُ آثارِ الرموزِ المشترَكُ لم يُفتَحْ، فالقرارُ مُغلَقٌ (503) لا مفتوحٌ.",
          { cause },
        );
      },
    );
    return pending;
  };

  return {
    async remember(record: ServiceTokenReplayRecord): Promise<ServiceTokenReplayDecision> {
      const guard = await open();
      return guard.remember(record);
    },
  };
}

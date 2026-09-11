/**
 * مُنادي المُكنسةِ — جَولةٌ واحدةٌ تُنادى من خارجٍ (المراجعةُ 14/N · ADR-026 §4.16).
 *
 * المراجعةُ 13/N بنَت المُكنسةَ وتركَتها **بلا مُنادٍ** ديناً مُعلَناً (§4.15 أ):
 * مسارٌ يُحذَفُ بهِ المنتهي، ولا شيءَ يطرقُهُ. وهذا الملفُّ يسدُّ ذلكَ بأصغرِ
 * ما يكفي: **إجراءُ جَولةٍ واحدةٍ ثمّ خروجٌ**.
 *
 * ## لماذا عمليّةٌ تُنتهي لا خِدمةٌ تدورُ
 *
 * لا `setInterval` هنا ولا في الخدمةِ — والمنظومةُ تمنعُهُ بحُجّةٍ مكتوبةٍ في
 * ADR-011 و014 و015: مؤقِّتٌ في الذاكرةِ ينساهُ أوّلُ إعادةِ تشغيلٍ، ويجبرُ
 * الاختبارَ على انتظارِ الزمنِ، ويجعلُ «هل عملَ أمسِ؟» سؤالاً لا جوابَ لهُ.
 * فالمُنادي عمليّةٌ قصيرةٌ: تفتحُ اتّصالاً، تُصرِّفُ جَولةً، تطبعُ أرقامَها،
 * وتُغلِقُ. ومن يُكرِّرُها **جَدوَلُ التشغيلِ** (cron أو `CronJob`) لا شفرتُنا —
 * فالتواتُرُ قرارُ تشغيلٍ يُغيَّرُ بسطرٍ في الجَدوَلِ لا بنشرِ خدمةٍ.
 *
 * وهذا التقسيمُ نفسُهُ سابقةٌ في هذهِ الحزمةِ: `db/migrate.ts` منطقٌ لا يقرأُ
 * البيئةَ، و`db/migrate-cli.ts` حدُّ تشغيلٍ يقرأُها ويُنهي العمليّةَ. فهنا
 * المنطقُ (`runIdempotencySweepRound`) لا يعرفُ `process` ولا يطبعُ ولا يخرجُ،
 * والحدُّ (`idempotency-sweep-cli.ts`) هوَ وحدَهُ من يفعلُ الثلاثةَ.
 *
 * ## ولماذا لا يُنادى المسارُ عبرَ HTTP
 *
 * المسارُ `POST /delivery/idempotency-keys/sweep` باقٍ لصيانةٍ يدويّةٍ عندَ
 * الحاجةِ، لكنَّ الجَدوَلَ لا يُنادَى بهِ لسببَينِ مقيسَينِ لا مذاقَينِ:
 * **(١)** لكانَ على مضيفِ الجَدوَلِ أن يحملَ مفاتيحَ هويّةِ خدمةٍ ليُوقِّعَ
 * طلباً — أي توسيعُ مساحةِ سرٍّ لأجلِ حذفِ صفوفٍ منتهيةٍ. **(٢)** ومَهَلُ
 * عميلِ HTTP تقطعُ جَولةً طويلةً في منتصفِها فيُقرأُ القطعُ عطلاً وليسَ عطلاً.
 * والعمليّةُ المباشرةُ لا تحتاجُ مفتاحاً ولا تعرفُ مَهَلاً.
 *
 * ## رمزُ الخروجِ حُكمٌ لا زينةٌ
 *
 * الدَينُ الثاني في §4.15 كانَ «لا مقياسَ ولا تنبيهَ على `remaining`». وأرخصُ
 * تنبيهٍ في الدنيا موجودٌ أصلاً في كلِّ جَدوَلٍ: **رمزُ خروجٍ غيرُ صفريٍّ**.
 * فصارَ للجَولةِ ثلاثةُ أحكامٍ مُميَّزةٍ (`SWEEP_EXIT_*`): نظيفةٌ · بقيَ عملٌ
 * مقفولٌ الآنَ · بلغَتِ السقفَ وبقيَ تراكُمٌ. والثالثُ وحدَهُ يستحقُّ قراراً
 * (رفعُ التواتُرِ أو السقفِ أو تقصيرُ المدّةِ)، والثاني عابرٌ في العادةِ فلا
 * يُنبَّهُ إلّا إذا تكرَّرَ — وذاكَ تمييزٌ لا يُعطيهِ رمزٌ واحدٌ لكلِّ «لم يكتملْ».
 *
 * Scope: خدمة التوصيل · مُنادي مُكنسةِ مفاتيحِ التماثُلِ (جَولةٌ واحدةٌ)
 * Last Updated: 2026-09-12
 * Status: Active
 * Related Code: src/use-cases/sweep-expired-idempotency-keys.ts · src/ops/idempotency-sweep-cli.ts
 * Related Docs: docs/14-runbooks/DELIVERY_IDEMPOTENCY_SWEEP.md · docs/15-decisions/ADR-026-store-orders-and-delivery-boundary.md
 * Related Team: Delivery & Store Orders
 */

import type { IdempotencyKeySweepPort } from "../ports.js";
import {
  IDEMPOTENCY_SWEEP_BATCH_SIZE,
  IDEMPOTENCY_SWEEP_MAX_BATCHES,
  sweepExpiredIdempotencyKeys,
  type SweepExpiredIdempotencyKeysResult,
} from "../use-cases/sweep-expired-idempotency-keys.js";

/** جَولةٌ نظيفةٌ: لم يبقَ مفتاحٌ منتهٍ. */
export const SWEEP_EXIT_DRAINED = 0;

/** إخفاقٌ: إعدادٌ غيرُ مقروءٍ أو قاعدةٌ لم تُجِبْ. */
export const SWEEP_EXIT_FAILED = 1;

/**
 * بلغَتِ الجَولةُ سقفَ دفعاتِها وبقيَ منتهٍ — تراكُمٌ يستحقُّ قراراً تشغيليّاً.
 * ليسَ عطلاً: الشفرةُ عمِلَت كما وُصِفَت، والعملُ أكثرُ من جَولةٍ واحدةٍ.
 */
export const SWEEP_EXIT_ACCUMULATING = 3;

/**
 * دفعةٌ حذفَت صفراً وبقيَ منتهٍ — صفوفٌ مقفولةٌ لكاتبٍ الآنَ تخطّاها
 * `SKIP LOCKED`. عابرٌ في العادةِ: الجَولةُ التاليةُ تُدرِكُها.
 */
export const SWEEP_EXIT_CONTENDED = 4;

/** إعدادُ الجَولةِ كما يُقرأُ من البيئةِ. */
export interface IdempotencySweepRunnerConfig {
  readonly batchSize: number;
  readonly maxBatches: number;
}

/** تقريرُ الجَولةِ — سطرٌ واحدٌ يُطبَعُ ويُقرأُ آليّاً. */
export interface IdempotencySweepRunReport extends SweepExpiredIdempotencyKeysResult {
  readonly service: "delivery";
  readonly runner: "idempotency-sweep";
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly batchSize: number;
  readonly maxBatches: number;
  readonly exitCode: number;
}

/**
 * يُقرأُ الإعدادُ **بصياحٍ لا بإهمالٍ**.
 *
 * سابقةُ `MARKETPLACE_TIMEOUT_MS` تُهمِلُ قيمةً غيرَ مقروءةٍ إلى الافتراضِ،
 * وسابقةُ `IDEMPOTENCY_KEY_TTL_SECONDS` تُوقِفُ الإقلاعَ. وهذا الملفُّ يتبعُ
 * الثانيةَ لسببٍ يخصُّهُ: المُنادي **يُقاسُ بأرقامِهِ**، ومَن ضبطَ
 * `IDEMPOTENCY_SWEEP_BATCH_SIZE=5oo` في جَدوَلِهِ ثمَّ رأى الجدولَ ينمو لن
 * يعرفَ أبداً أنَّ رقمَهُ لم يُقرأْ. وثمنُ الرفضِ هنا زهيدٌ: عمليّةٌ قصيرةٌ
 * تُعيدُ المحاولةَ في الموعدِ التالي، لا خدمةٌ تسقطُ عن مساراتِها.
 */
export function resolveSweepRunnerConfig(
  env: Record<string, string | undefined>,
): IdempotencySweepRunnerConfig {
  return {
    batchSize: readPositiveInt(env, "IDEMPOTENCY_SWEEP_BATCH_SIZE", IDEMPOTENCY_SWEEP_BATCH_SIZE),
    maxBatches: readPositiveInt(env, "IDEMPOTENCY_SWEEP_MAX_BATCHES", IDEMPOTENCY_SWEEP_MAX_BATCHES),
  };
}

function readPositiveInt(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  // أرقامٌ عشريّةٌ صريحةٌ وحدَها. و`Number.isInteger(Number(raw))` **لا يكفي**:
  // قِيسَ أنَّهُ يقبلُ `"1e3"` (⇒ 1000) و`"0x10"` (⇒ **16**) و`" 12 "`. فمن كتبَ
  // `0x10` في جَدوَلِهِ يقصدُ عشرةً غالباً ويأخذُ ستّةَ عشرَ صامتاً — وذاكَ
  // بعينُهُ نوعُ الخطأِ الذي وُجِدَ هذا الحارسُ ليصيحَ بهِ.
  if (!/^[0-9]+$/.test(raw.trim()) || Number(raw) < 1) {
    throw new Error(
      `${name} يجبُ أن يكونَ عدداً صحيحاً ≥ 1 (القيمةُ المقروءةُ: ${JSON.stringify(raw)})`,
    );
  }
  return Number(raw.trim());
}

/** الحكمُ على الجَولةِ من سببِ توقُّفِها — لا من عددِ المحذوفِ. */
export function exitCodeForSweep(result: SweepExpiredIdempotencyKeysResult): number {
  if (result.stoppedBecause === "drained") return SWEEP_EXIT_DRAINED;
  if (result.stoppedBecause === "max_batches") return SWEEP_EXIT_ACCUMULATING;
  return SWEEP_EXIT_CONTENDED;
}

export interface RunIdempotencySweepRoundInput {
  readonly sweepPort: IdempotencyKeySweepPort;
  readonly config: IdempotencySweepRunnerConfig;
  /** ساعةٌ مُحقونةٌ: الاختبارُ يقيسُ التقريرَ بلا انتظارِ زمنٍ حقيقيٍّ. */
  readonly now: () => Date;
}

/**
 * جَولةٌ واحدةٌ: تُصرِّفُ، وتُقرِّرُ الحكمَ، وتُعيدُ التقريرَ. **لا تطبعُ ولا
 * تُنهي العمليّةَ ولا تلمسُ `process`** — وذاكَ شرطُ اختبارِها بلا عمليّةٍ.
 */
export async function runIdempotencySweepRound(
  input: RunIdempotencySweepRoundInput,
): Promise<IdempotencySweepRunReport> {
  const startedAt = input.now();
  const result = await sweepExpiredIdempotencyKeys({
    sweepPort: input.sweepPort,
    batchSize: input.config.batchSize,
    maxBatches: input.config.maxBatches,
  });
  const finishedAt = input.now();

  return {
    service: "delivery",
    runner: "idempotency-sweep",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    batchSize: input.config.batchSize,
    maxBatches: input.config.maxBatches,
    batches: result.batches,
    deleted: result.deleted,
    remaining: result.remaining,
    stoppedBecause: result.stoppedBecause,
    exitCode: exitCodeForSweep(result),
  };
}

/**
 * سطرُ السجلِّ: JSON واحدٌ في سطرٍ واحدٍ.
 *
 * لا «تمَّ التنظيفُ بنجاحٍ»: جامعُ السجلّاتِ لا يستطيعُ أن يرسمَ منحنى
 * `remaining` من جملةٍ عربيّةٍ، ويستطيعُ ذلكَ من حقلٍ. والحقولُ بالإنجليزيّةِ
 * لأنَّها مفاتيحُ آلةٍ لا نصُّ إنسانٍ، وهذا استثناءُ الشفرةِ المعروفُ.
 */
export function formatSweepReportLine(report: IdempotencySweepRunReport): string {
  return `${JSON.stringify({
    service: report.service,
    runner: report.runner,
    started_at: report.startedAt,
    finished_at: report.finishedAt,
    duration_ms: report.durationMs,
    batch_size: report.batchSize,
    max_batches: report.maxBatches,
    batches: report.batches,
    deleted: report.deleted,
    remaining: report.remaining,
    stopped_because: report.stoppedBecause,
    exit_code: report.exitCode,
  })}\n`;
}

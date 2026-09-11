/**
 * مُنادي المُكنسةِ — اختباراتُ وحدةٍ (المراجعةُ 14/N · ADR-026 §4.16).
 *
 * ثلاثةُ وعودٍ تُقاسُ هنا بلا قاعدةٍ ولا عمليّةٍ:
 *  1. الإعدادُ يُقرأُ **بصياحٍ**: قيمةٌ غيرُ مقروءةٍ تُوقِفُ الجَولةَ ولا تُهمَلُ
 *     إلى الافتراضِ صامتةً.
 *  2. الحكمُ (رمزُ الخروجِ) من **سببِ التوقُّفِ** لا من عددِ المحذوفِ — فجَولةٌ
 *     حذفَت ألفاً وبقيَ عليها ألفٌ ليست نجاحاً، وجَولةٌ حذفَت صفراً ولم يبقَ
 *     شيءٌ ليست إخفاقاً.
 *  3. التقريرُ سطرٌ آليٌّ واحدٌ بحقولٍ ثابتةٍ — وإلّا فلا منحنى لـ`remaining`.
 */

import { describe, expect, it } from "vitest";

import type { IdempotencyKeySweepBatch, IdempotencyKeySweepPort } from "../ports.js";
import {
  SWEEP_EXIT_ACCUMULATING,
  SWEEP_EXIT_CONTENDED,
  SWEEP_EXIT_DRAINED,
  SWEEP_EXIT_FAILED,
  exitCodeForSweep,
  formatSweepReportLine,
  resolveSweepRunnerConfig,
  runIdempotencySweepRound,
} from "../ops/idempotency-sweep-runner.js";
import {
  IDEMPOTENCY_SWEEP_BATCH_SIZE,
  IDEMPOTENCY_SWEEP_MAX_BATCHES,
} from "../use-cases/sweep-expired-idempotency-keys.js";

/** منفذُ مسحٍ مزيَّفٌ: يُعيدُ دفعاتٍ مُعطاةً ويُسجّلُ الحدودَ المطلوبةَ. */
class ScriptedSweepPort implements IdempotencyKeySweepPort {
  readonly limits: number[] = [];

  constructor(private readonly batches: IdempotencyKeySweepBatch[]) {}

  deleteExpiredIdempotencyKeys(limit: number): Promise<IdempotencyKeySweepBatch> {
    this.limits.push(limit);
    const next = this.batches[this.limits.length - 1] ?? { deleted: 0, remaining: 0 };
    return Promise.resolve(next);
  }
}

/** ساعةٌ تتقدَّمُ خطوةً مضبوطةً عندَ كلِّ نداءٍ — لا انتظارَ زمنٍ حقيقيٍّ. */
function steppingClock(startMs: number, stepMs: number): () => Date {
  let calls = 0;
  return () => new Date(startMs + stepMs * calls++);
}

describe("resolveSweepRunnerConfig — الإعدادُ يُقرأُ بصياحٍ", () => {
  it("بيئةٌ فارغةٌ ⇒ الافتراضاتُ المُعلَنةُ في حالةِ الاستخدامِ", () => {
    expect(resolveSweepRunnerConfig({})).toEqual({
      batchSize: IDEMPOTENCY_SWEEP_BATCH_SIZE,
      maxBatches: IDEMPOTENCY_SWEEP_MAX_BATCHES,
    });
  });

  it("قيمتانِ صحيحتانِ تُقرآنِ كما هما", () => {
    expect(
      resolveSweepRunnerConfig({
        IDEMPOTENCY_SWEEP_BATCH_SIZE: "50",
        IDEMPOTENCY_SWEEP_MAX_BATCHES: "3",
      }),
    ).toEqual({ batchSize: 50, maxBatches: 3 });
  });

  it("سلسلةٌ فارغةٌ أو فراغٌ ⇒ الافتراضُ (متغيّرٌ مضبوطٌ بلا قيمةٍ ليسَ خطأً)", () => {
    expect(
      resolveSweepRunnerConfig({
        IDEMPOTENCY_SWEEP_BATCH_SIZE: "",
        IDEMPOTENCY_SWEEP_MAX_BATCHES: "   ",
      }),
    ).toEqual({
      batchSize: IDEMPOTENCY_SWEEP_BATCH_SIZE,
      maxBatches: IDEMPOTENCY_SWEEP_MAX_BATCHES,
    });
  });

  it.each([
    ["5oo", "خطأُ طباعةٍ يُشبِهُ رقماً"],
    ["0", "صفرٌ: دفعةٌ لا تحذفُ شيئاً"],
    ["-1", "سالبٌ"],
    ["2.5", "كسرٌ"],
    ["1e3", "صيغةٌ علميّةٌ: Number تقبلُها ⇒ 1000"],
    ["0x10", "ستّةَ عشرَ لمن كتبَ عشرةً — Number تقبلُها صامتةً"],
    ["١٠", "أرقامٌ عربيّةٌ-هنديّةٌ لا يقرأُها Number"],
  ])("قيمةٌ غيرُ مقروءةٍ (%s) تُوقِفُ الجَولةَ وتُسمّي المتغيّرَ وقيمتَهُ", (raw) => {
    expect(() => resolveSweepRunnerConfig({ IDEMPOTENCY_SWEEP_BATCH_SIZE: raw })).toThrow(
      /IDEMPOTENCY_SWEEP_BATCH_SIZE/,
    );
    expect(() => resolveSweepRunnerConfig({ IDEMPOTENCY_SWEEP_BATCH_SIZE: raw })).toThrow(
      new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  it("سقفُ الدفعاتِ يُحرَسُ كما يُحرَسُ حجمُ الدفعةِ", () => {
    expect(() => resolveSweepRunnerConfig({ IDEMPOTENCY_SWEEP_MAX_BATCHES: "0" })).toThrow(
      /IDEMPOTENCY_SWEEP_MAX_BATCHES/,
    );
  });
});

describe("exitCodeForSweep — الحكمُ من سببِ التوقُّفِ", () => {
  it("جَولةٌ نظيفةٌ ⇒ صفرٌ", () => {
    expect(exitCodeForSweep({ batches: 1, deleted: 0, remaining: 0, stoppedBecause: "drained" })).toBe(
      SWEEP_EXIT_DRAINED,
    );
  });

  it("بلوغُ السقفِ وبقاءُ عملٍ ⇒ رمزُ التراكُمِ (لا صفرٌ ولو حذفَت ألفاً)", () => {
    expect(
      exitCodeForSweep({ batches: 20, deleted: 10_000, remaining: 4_000, stoppedBecause: "max_batches" }),
    ).toBe(SWEEP_EXIT_ACCUMULATING);
  });

  it("دفعةٌ فارغةٌ وبقيَ منتهٍ ⇒ رمزُ المزاحمةِ (عابرٌ لا تراكُمٌ)", () => {
    expect(
      exitCodeForSweep({ batches: 1, deleted: 0, remaining: 7, stoppedBecause: "empty_batch" }),
    ).toBe(SWEEP_EXIT_CONTENDED);
  });

  it("الرموزُ الأربعةُ متمايزةٌ — تنبيهُ الجَدوَلِ يفرِّقُ بينَ الحالاتِ", () => {
    const codes = [
      SWEEP_EXIT_DRAINED,
      SWEEP_EXIT_FAILED,
      SWEEP_EXIT_ACCUMULATING,
      SWEEP_EXIT_CONTENDED,
    ];
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("runIdempotencySweepRound — جَولةٌ واحدةٌ وتقريرُها", () => {
  it("تُصرِّفُ حتّى النظافةِ وتُعيدُ تقريراً كاملاً بحكمِهِ", async () => {
    const port = new ScriptedSweepPort([
      { deleted: 2, remaining: 3 },
      { deleted: 3, remaining: 0 },
    ]);

    const report = await runIdempotencySweepRound({
      sweepPort: port,
      config: { batchSize: 2, maxBatches: 5 },
      now: steppingClock(Date.parse("2026-09-12T00:00:00.000Z"), 250),
    });

    expect(port.limits).toEqual([2, 2]);
    expect(report).toEqual({
      service: "delivery",
      runner: "idempotency-sweep",
      startedAt: "2026-09-12T00:00:00.000Z",
      finishedAt: "2026-09-12T00:00:00.250Z",
      durationMs: 250,
      batchSize: 2,
      maxBatches: 5,
      batches: 2,
      deleted: 5,
      remaining: 0,
      stoppedBecause: "drained",
      exitCode: SWEEP_EXIT_DRAINED,
    });
  });

  it("سقفُ الدفعاتِ يُحتَرَمُ ويُعادُ حكمُ التراكُمِ لا استثناءٌ", async () => {
    const port = new ScriptedSweepPort([
      { deleted: 1, remaining: 9 },
      { deleted: 1, remaining: 8 },
      { deleted: 1, remaining: 7 },
    ]);

    const report = await runIdempotencySweepRound({
      sweepPort: port,
      config: { batchSize: 1, maxBatches: 2 },
      now: steppingClock(0, 0),
    });

    expect(port.limits).toEqual([1, 1]);
    expect(report.batches).toBe(2);
    expect(report.deleted).toBe(2);
    expect(report.remaining).toBe(8);
    expect(report.stoppedBecause).toBe("max_batches");
    expect(report.exitCode).toBe(SWEEP_EXIT_ACCUMULATING);
  });

  it("دفعةٌ فارغةٌ وبقيَ منتهٍ ⇒ توقُّفٌ فوريٌّ بحكمِ المزاحمةِ (لا حلقةٌ مشغولةٌ)", async () => {
    const port = new ScriptedSweepPort([{ deleted: 0, remaining: 4 }]);

    const report = await runIdempotencySweepRound({
      sweepPort: port,
      config: { batchSize: 500, maxBatches: 20 },
      now: steppingClock(0, 10),
    });

    expect(port.limits).toEqual([500]);
    expect(report.batches).toBe(1);
    expect(report.remaining).toBe(4);
    expect(report.exitCode).toBe(SWEEP_EXIT_CONTENDED);
  });

  it("جَولةٌ على جدولٍ نظيفٍ أصلاً: دفعةٌ واحدةٌ بلا محذوفٍ ورمزٌ صفريٌّ", async () => {
    const report = await runIdempotencySweepRound({
      sweepPort: new ScriptedSweepPort([{ deleted: 0, remaining: 0 }]),
      config: { batchSize: 500, maxBatches: 20 },
      now: steppingClock(0, 5),
    });

    expect(report.deleted).toBe(0);
    expect(report.stoppedBecause).toBe("drained");
    expect(report.exitCode).toBe(SWEEP_EXIT_DRAINED);
  });

  it("إعدادٌ غيرُ صالحٍ يمرُّ من الحدِّ يُرمى من حالةِ الاستخدامِ (حِرزٌ مُضاعَفٌ)", async () => {
    await expect(
      runIdempotencySweepRound({
        sweepPort: new ScriptedSweepPort([]),
        config: { batchSize: 0, maxBatches: 20 },
        now: steppingClock(0, 0),
      }),
    ).rejects.toThrow(/حجمُ الدفعةِ/);
  });
});

describe("formatSweepReportLine — سطرٌ آليٌّ واحدٌ", () => {
  it("سطرٌ واحدٌ ينتهي بسطرٍ جديدٍ وحقولُهُ snake_case مقروءةٌ آليّاً", async () => {
    const report = await runIdempotencySweepRound({
      sweepPort: new ScriptedSweepPort([{ deleted: 4, remaining: 0 }]),
      config: { batchSize: 500, maxBatches: 20 },
      now: steppingClock(Date.parse("2026-09-12T01:02:03.000Z"), 120),
    });

    const line = formatSweepReportLine(report);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd().includes("\n")).toBe(false);

    expect(JSON.parse(line)).toEqual({
      service: "delivery",
      runner: "idempotency-sweep",
      started_at: "2026-09-12T01:02:03.000Z",
      finished_at: "2026-09-12T01:02:03.120Z",
      duration_ms: 120,
      batch_size: 500,
      max_batches: 20,
      batches: 1,
      deleted: 4,
      remaining: 0,
      stopped_because: "drained",
      exit_code: 0,
    });
  });
});

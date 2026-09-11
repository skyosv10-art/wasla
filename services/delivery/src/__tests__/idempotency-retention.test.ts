/**
 * حياةُ مفاتيحِ التماثُلِ ومُكنستُها — اختباراتُ وحدةٍ (المراجعةُ 13/N · ADR-026 §4.15).
 *
 * ما يُقاسُ هنا لا يحتاجُ قاعدةً: حلُّ المدّةِ من البيئةِ، ورفضُ ما دونَ الحدِّ،
 * وحلقةُ الدفعاتِ بمنفذٍ مُصطنَعٍ، ومسارُ الصيانةِ بجسمٍ خاطئٍ وبلا مُكنسةٍ.
 * وأمّا ما لا يُقاسُ إلّا بقاعدةٍ (انتهاءُ مفتاحٍ، استيلاءٌ على صفٍّ ميّتٍ، ترقيةٌ
 * على بياناتٍ) فمقيسٌ في `idempotency-retention.integration.test.ts` — الفصلُ
 * بينَهما مقصودٌ: زمنُ القاعدةِ لا يُحاكى بساعةٍ مزيّفةٍ في مِلفِّ وحدةٍ.
 */

import { describe, expect, it } from "vitest";

import {
  IDEMPOTENCY_KEY_TTL_FLOOR_SECONDS,
  IDEMPOTENCY_KEY_TTL_SECONDS,
  resolveIdempotencyTtlSeconds,
} from "../domain/idempotency.js";
import {
  IDEMPOTENCY_SWEEP_BATCH_SIZE,
  IDEMPOTENCY_SWEEP_MAX_BATCHES,
  sweepExpiredIdempotencyKeys,
} from "../use-cases/sweep-expired-idempotency-keys.js";
import { buildDeliveryHttpApp } from "../http/app.js";
import type { IdempotencyKeySweepBatch, IdempotencyKeySweepPort } from "../ports.js";
import { FakeStoreOrderStore } from "./store-order-fakes.js";

/** منفذٌ مُصطنَعٌ يُعيدُ دفعاتٍ مُبرمَجةً ويسجّلُ الحدودَ المطلوبةَ. */
class ScriptedSweepPort implements IdempotencyKeySweepPort {
  readonly limits: number[] = [];
  private index = 0;
  constructor(private readonly batches: readonly IdempotencyKeySweepBatch[]) {}
  deleteExpiredIdempotencyKeys(limit: number): Promise<IdempotencyKeySweepBatch> {
    this.limits.push(limit);
    const batch = this.batches[Math.min(this.index, this.batches.length - 1)];
    this.index += 1;
    return Promise.resolve(batch as IdempotencyKeySweepBatch);
  }
}

describe("resolveIdempotencyTtlSeconds — المدّةُ من البيئةِ", () => {
  it("الغيابُ يعني الافتراضَ: يومٌ كاملٌ", () => {
    expect(resolveIdempotencyTtlSeconds({})).toBe(IDEMPOTENCY_KEY_TTL_SECONDS);
    expect(IDEMPOTENCY_KEY_TTL_SECONDS).toBe(86_400);
  });

  it("قيمةٌ فارغةٌ تُعامَلُ كالغيابِ لا كصفرٍ", () => {
    // متغيّرٌ مضبوطٌ إلى نصٍّ فارغٍ حالةٌ شائعةٌ في ملفاتِ البيئةِ، و`Number("")`
    // صفرٌ — أي أنَّ التحويلَ الساذجَ كانَ سيُلغي الحمايةَ بسطرٍ فارغٍ.
    expect(resolveIdempotencyTtlSeconds({ IDEMPOTENCY_KEY_TTL_SECONDS: "" })).toBe(
      IDEMPOTENCY_KEY_TTL_SECONDS,
    );
    expect(resolveIdempotencyTtlSeconds({ IDEMPOTENCY_KEY_TTL_SECONDS: "   " })).toBe(
      IDEMPOTENCY_KEY_TTL_SECONDS,
    );
  });

  it("قيمةٌ صحيحةٌ فوقَ الحدِّ تُقبَلُ كما هيَ", () => {
    expect(resolveIdempotencyTtlSeconds({ IDEMPOTENCY_KEY_TTL_SECONDS: "7200" })).toBe(7_200);
    expect(
      resolveIdempotencyTtlSeconds({
        IDEMPOTENCY_KEY_TTL_SECONDS: String(IDEMPOTENCY_KEY_TTL_FLOOR_SECONDS),
      }),
    ).toBe(IDEMPOTENCY_KEY_TTL_FLOOR_SECONDS);
  });

  it("ما دونَ الحدِّ الأدنى يُوقِفُ الإقلاعَ ولا يُصحَّحُ صامتاً", () => {
    for (const raw of ["1", "60", "3599", "0", "-1"]) {
      expect(() => resolveIdempotencyTtlSeconds({ IDEMPOTENCY_KEY_TTL_SECONDS: raw })).toThrow(
        /الحدِّ الأدنى|عدداً صحيحاً/u,
      );
    }
  });

  it("قيمةٌ غيرُ عدديّةٍ أو كسريّةٌ تُوقِفُ الإقلاعَ", () => {
    for (const raw of ["abc", "24h", "3600.5", "NaN", "1e"]) {
      expect(() => resolveIdempotencyTtlSeconds({ IDEMPOTENCY_KEY_TTL_SECONDS: raw })).toThrow(
        /عدداً صحيحاً/u,
      );
    }
  });

  it("الرسالةُ تُسمّي المتغيّرَ والقيمةَ — لا «إعدادٌ خاطئٌ» مجرَّداً", () => {
    expect(() => resolveIdempotencyTtlSeconds({ IDEMPOTENCY_KEY_TTL_SECONDS: "5" })).toThrow(
      /IDEMPOTENCY_KEY_TTL_SECONDS=5/u,
    );
  });
});

describe("sweepExpiredIdempotencyKeys — حلقةُ الدفعاتِ", () => {
  it("تتوقّفُ عندَ نظافةِ الجدولِ ولا تُنادي دفعةً زائدةً", async () => {
    const port = new ScriptedSweepPort([
      { deleted: 500, remaining: 300 },
      { deleted: 300, remaining: 0 },
    ]);
    const result = await sweepExpiredIdempotencyKeys({ sweepPort: port });
    expect(result).toEqual({
      batches: 2,
      deleted: 800,
      remaining: 0,
      stoppedBecause: "drained",
    });
    expect(port.limits).toEqual([IDEMPOTENCY_SWEEP_BATCH_SIZE, IDEMPOTENCY_SWEEP_BATCH_SIZE]);
  });

  it("سقفُ الدفعاتِ يحدُّ الجَولةَ ويُعلِنُ التراكُمَ بلا رميٍ", async () => {
    const port = new ScriptedSweepPort([{ deleted: 10, remaining: 1_000 }]);
    const result = await sweepExpiredIdempotencyKeys({
      sweepPort: port,
      batchSize: 10,
      maxBatches: 3,
    });
    expect(result).toEqual({
      batches: 3,
      deleted: 30,
      remaining: 1_000,
      stoppedBecause: "max_batches",
    });
    expect(port.limits).toEqual([10, 10, 10]);
  });

  it("دفعةٌ فارغةٌ وبقيَ عملٌ ⇒ توقُّفٌ لا حلقةٌ مشغولةٌ", async () => {
    // الحالةُ الواقعيّةُ: كلُّ ما بقيَ منتهياً مقفولٌ لكاتبٍ الآنَ فتخطّاهُ
    // `SKIP LOCKED`. والإصرارُ ينافسُ مساراً في المقدّمةِ على القفلِ نفسِهِ.
    const port = new ScriptedSweepPort([{ deleted: 0, remaining: 7 }]);
    const result = await sweepExpiredIdempotencyKeys({ sweepPort: port, maxBatches: 9 });
    expect(result).toEqual({
      batches: 1,
      deleted: 0,
      remaining: 7,
      stoppedBecause: "empty_batch",
    });
  });

  it("جدولٌ نظيفٌ أصلاً: دفعةٌ واحدةٌ لا صفرَ دفعاتٍ", async () => {
    // الدفعةُ الأولى هيَ القياسُ: لا سبيلَ لمعرفةِ نظافةِ الجدولِ بلا سؤالِه.
    const port = new ScriptedSweepPort([{ deleted: 0, remaining: 0 }]);
    const result = await sweepExpiredIdempotencyKeys({ sweepPort: port });
    expect(result).toEqual({ batches: 1, deleted: 0, remaining: 0, stoppedBecause: "drained" });
  });

  it("حدودٌ غيرُ صحيحةٍ تُرمى قبلَ أيِّ نداءٍ للقاعدةِ", async () => {
    const port = new ScriptedSweepPort([{ deleted: 0, remaining: 0 }]);
    await expect(sweepExpiredIdempotencyKeys({ sweepPort: port, batchSize: 0 })).rejects.toThrow(
      /حجمُ الدفعةِ/u,
    );
    await expect(sweepExpiredIdempotencyKeys({ sweepPort: port, maxBatches: -3 })).rejects.toThrow(
      /سقفُ الدفعاتِ/u,
    );
    await expect(
      sweepExpiredIdempotencyKeys({ sweepPort: port, batchSize: 1.5 }),
    ).rejects.toThrow(/حجمُ الدفعةِ/u);
    expect(port.limits).toEqual([]);
  });

  it("الافتراضاتُ مُعلَنةٌ ومعقولةٌ", () => {
    expect(IDEMPOTENCY_SWEEP_BATCH_SIZE).toBe(500);
    expect(IDEMPOTENCY_SWEEP_MAX_BATCHES).toBe(20);
  });
});

describe("POST /delivery/idempotency-keys/sweep — مسارُ الصيانةِ", () => {
  const buildApp = (sweepPort?: IdempotencyKeySweepPort) => {
    const store = new FakeStoreOrderStore();
    return buildDeliveryHttpApp({
      readPort: store,
      writePort: store,
      ...(sweepPort === undefined ? {} : { idempotencySweepPort: sweepPort }),
    });
  };

  it("مُكنسةٌ غيرُ مُركَّبةٍ ⇒ خطأٌ صريحٌ لا «مسحتُ صفراً»", async () => {
    const app = buildApp();
    const res = await app.fastify.inject({
      method: "POST",
      url: "/delivery/idempotency-keys/sweep",
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error_code).toBe("DELIVERY_INTERNAL_ERROR");
    await app.close();
  });

  it("بلا جسمٍ: يُنادى بالافتراضاتِ ويُعيدُ الأرقامَ المقيسةَ", async () => {
    const port = new ScriptedSweepPort([{ deleted: 4, remaining: 0 }]);
    const app = buildApp(port);
    const res = await app.fastify.inject({
      method: "POST",
      url: "/delivery/idempotency-keys/sweep",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      batches: 1,
      deleted: 4,
      remaining: 0,
      stopped_because: "drained",
    });
    expect(port.limits).toEqual([IDEMPOTENCY_SWEEP_BATCH_SIZE]);
    await app.close();
  });

  it("حدودٌ في الجسمِ تُمرَّرُ كما هيَ", async () => {
    const port = new ScriptedSweepPort([{ deleted: 2, remaining: 9 }]);
    const app = buildApp(port);
    const res = await app.fastify.inject({
      method: "POST",
      url: "/delivery/idempotency-keys/sweep",
      payload: { batch_size: 2, max_batches: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      batches: 2,
      deleted: 4,
      remaining: 9,
      stopped_because: "max_batches",
    });
    expect(port.limits).toEqual([2, 2]);
    await app.close();
  });

  it("حدٌّ خاطئٌ ⇒ 400 يُسمّي الحقلَ ولا يُصحَّحُ صامتاً", async () => {
    const port = new ScriptedSweepPort([{ deleted: 0, remaining: 0 }]);
    const app = buildApp(port);
    for (const payload of [
      { batch_size: 0 },
      { batch_size: -1 },
      { max_batches: 1.5 },
      { max_batches: "10" },
    ]) {
      const res = await app.fastify.inject({
        method: "POST",
        url: "/delivery/idempotency-keys/sweep",
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error_code).toBe("DELIVERY_VALIDATION_FAILED");
    }
    expect(port.limits).toEqual([]);
    await app.close();
  });

  it("جسمٌ ليسَ كائناً ⇒ 400", async () => {
    const port = new ScriptedSweepPort([{ deleted: 0, remaining: 0 }]);
    const app = buildApp(port);
    const res = await app.fastify.inject({
      method: "POST",
      url: "/delivery/idempotency-keys/sweep",
      payload: [1, 2, 3],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error_code).toBe("DELIVERY_VALIDATION_FAILED");
    await app.close();
  });
});

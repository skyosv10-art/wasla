import { describe, expect, it } from "vitest";

import { runTick } from "../run-tick.js";
import type { JobRepository } from "../ports.js";
import type { DispatchRunner } from "../runner.js";
import { createDispatchJob } from "../use-cases/create-job.js";
import { createHarness, driverId, orderRef, ZONE_ID } from "./harness.js";

async function seedJobs(count: number) {
  const harness = createHarness();
  const jobIds: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    const order = orderRef(index);
    harness.orders.seedOrder(order.orderId);
    const result = await createDispatchJob(harness.deps, {
      ...order,
      zoneId: ZONE_ID,
      orderType: "ride",
      vehicleClass: "sedan",
      idempotencyKey: `tick-create-${index}`,
    });
    jobIds.push(result.job.id);
  }
  harness.matching.setPool([driverId(1)]);
  return { harness, jobIds };
}

function directRecordingRunner(
  deps: Awaited<ReturnType<typeof seedJobs>>["harness"]["deps"],
  counters: { reads: number; writes: number },
): DispatchRunner {
  return {
    read: async (work) => {
      counters.reads += 1;
      return work(deps);
    },
    write: async (work) => {
      counters.writes += 1;
      return work(deps);
    },
  };
}

describe("تشغيل النبضة", () => {
  it("يفتح معاملة كتابة واحدة لكل واحدة من ثلاث مهام نشطة", async () => {
    const { harness } = await seedJobs(3);
    const counters = { reads: 0, writes: 0 };

    await runTick(directRecordingRunner(harness.deps, counters));

    expect(counters).toEqual({ reads: 1, writes: 3 });
  });

  it("يثبّت ساعة واحدة لكل المهام ويعيد اللحظة نفسها", async () => {
    const { harness, jobIds } = await seedJobs(2);
    const tickAt = "2026-01-01T01:02:03.000Z";
    harness.clock.set(tickAt);

    const outcome = await runTick({
      read: async (work) => work(harness.deps),
      write: async (work) => work(harness.deps),
    });

    expect(outcome.tickAt).toBe(tickAt);
    await expect(harness.waves.listForJob(jobIds[0])).resolves.toMatchObject([{ openedAt: tickAt }]);
    await expect(harness.waves.listForJob(jobIds[1])).resolves.toMatchObject([{ openedAt: tickAt }]);
  });

  it("يثبت معاملة المهمة السابقة عندما يفشل خطأ بنية تحتية في المهمة الوسطى", async () => {
    const { harness, jobIds } = await seedJobs(3);
    let writes = 0;
    const runner: DispatchRunner = {
      read: async (work) => work(harness.deps),
      write: async (work) => {
        writes += 1;
        if (writes !== 2) return work(harness.deps);
        return work({
          ...harness.deps,
          matching: {
            candidates: async () => {
              throw new TypeError("عطل بنية تحتية");
            },
            markUnavailable: (driverPublicId) => harness.matching.markUnavailable(driverPublicId),
          },
        });
      },
    };

    await expect(runTick(runner)).rejects.toThrow("عطل بنية تحتية");

    expect(writes).toBe(2);
    await expect(harness.waves.listForJob(jobIds[0])).resolves.toHaveLength(1);
    await expect(harness.waves.listForJob(jobIds[1])).resolves.toHaveLength(0);
  });

  it("لا يبتلع الخطأ غير المجالي الصادر من معاملة المهمة", async () => {
    const { harness } = await seedJobs(1);
    const runner: DispatchRunner = {
      read: async (work) => work(harness.deps),
      write: async (work) =>
        work({
          ...harness.deps,
          matching: {
            candidates: async () => {
              throw new Error("فشل غير مجالي");
            },
            markUnavailable: (driverPublicId) => harness.matching.markUnavailable(driverPublicId),
          },
        }),
    };

    await expect(runTick(runner)).rejects.toThrow("فشل غير مجالي");
  });

  it("لا يفتح معاملة كتابة عندما تفشل قراءة قائمة المهام النشطة", async () => {
    let writes = 0;
    const runner: DispatchRunner = {
      read: async () => {
        throw new Error("تعذر قراءة المهام");
      },
      write: async () => {
        writes += 1;
        throw new Error("لا يجب أن تصل الكتابة");
      },
    };

    await expect(runTick(runner)).rejects.toThrow("تعذر قراءة المهام");
    expect(writes).toBe(0);
  });

  it("يجمع عدادات المهام بما فيها المؤجلات", async () => {
    const { harness } = await seedJobs(2);
    harness.matching.failWith("unavailable");

    const outcome = await runTick({
      read: async (work) => work(harness.deps),
      write: async (work) => work(harness.deps),
    });

    expect(outcome).toMatchObject({
      openedWaves: 1,
      timedOutOffers: 0,
      escalatedJobs: 0,
      exhaustedJobs: 0,
      deferredJobs: 1,
    });
  });

  it("يعيد قائمة فارغة للمهمة المحذوفة بين القراءة والمعاملة", async () => {
    const { harness } = await seedJobs(1);
    let written = false;
    const jobs: JobRepository = {
      find: async () => null,
      findByOrderId: (orderId) => harness.jobs.findByOrderId(orderId),
      findByIdempotencyKey: (key) => harness.jobs.findByIdempotencyKey(key),
      insert: (input) => harness.jobs.insert(input),
      updateStatus: (id, status, reasonCode, changedAt) =>
        harness.jobs.updateStatus(id, status, reasonCode, changedAt),
      listActive: () => harness.jobs.listActive(),
    };
    const runner: DispatchRunner = {
      read: async (work) => work(harness.deps),
      write: async (work) => {
        written = true;
        return work({
          ...harness.deps,
          jobs,
        });
      },
    };

    const outcome = await runTick(runner);

    expect(written).toBe(true);
    expect(outcome).toMatchObject({
      openedWaves: 0,
      timedOutOffers: 0,
      escalatedJobs: 0,
      exhaustedJobs: 0,
      deferredJobs: 0,
    });
  });

  it("يعيد أصفاراً ولحظة نبضة صحيحة عندما لا توجد مهام نشطة", async () => {
    const harness = createHarness();
    const tickAt = "2026-01-02T00:00:00.000Z";
    harness.clock.set(tickAt);
    const counters = { reads: 0, writes: 0 };

    const outcome = await runTick(directRecordingRunner(harness.deps, counters));

    expect(outcome).toEqual({
      tickAt,
      timedOutOffers: 0,
      openedWaves: 0,
      escalatedJobs: 0,
      exhaustedJobs: 0,
      deferredJobs: 0,
    });
    expect(counters).toEqual({ reads: 1, writes: 0 });
  });
});

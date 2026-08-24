/**
 * الذرّيّةُ: القرارُ كلُّه أو لا شيءَ منه — ويُثبَت بكسرِ المعاملةِ من داخلِها.
 *
 * لماذا خطّافٌ داخليٌّ ولم يكفِ اختبارٌ من الخارج؟ لأنّ الفشلَ المُخيفَ ليس فشلَ الاستعلامِ
 * الأوّلِ ولا الثاني، بل فشلٌ **بينهما**: صفُّ دفترٍ مكتوبٌ وإسقاطٌ لم يُكتب. ولا سبيلَ لإحداثِ
 * هذا الفشلِ إلّا من داخلِ المعاملة؛ والبديلُ كان قتلَ العمليّةِ بإشارةٍ، وذاك يفحص Postgres لا
 * يفحص كودَنا.
 *
 * وما يُفحَص هنا هو **العطبُ الذي لا يُكتشَف بقراءة**: متجرٌ يقول سجلُّ قراراتِه إنّه اعتُمد
 * وعمودُه يقول `pending_review`. صفٌّ كهذا سليمٌ في ذاتِه، ولا اختبارَ وحداتٍ يراه، ولا إعادةَ
 * محاولةٍ تُصلحه — لأنّ لا أحدَ يعلم أنّه معطوب.
 *
 * ويُفحَص كذلك أنّ إعادةَ المحاولةِ **مقصورةٌ على سباقِ التسلسل**: خطأُ تحقّقٍ أو عطبُ برمجةٍ
 * يُرمى من أوّلِ محاولةٍ ولا يُعاد ثلاثاً. وإعادةٌ عمياءُ كانت ستُضاعف حِملَ قاعدةٍ متعبةٍ ثلاثاً
 * وتُؤخّر ظهورَ العطبِ ثلاثَ مرّاتٍ في السجلّ.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MAX_DECISION_ATTEMPTS, MarketplaceUnitOfWork } from "../db/unit-of-work.js";
import { deriveStoreState } from "../domain/state.js";
import { draftStore } from "../domain/catalog.js";
import {
  MODERATOR,
  OWNER,
  PG_ENABLED,
  T0,
  T1,
  countRows,
  resetData,
  seedLeafCategory,
  setupPostgres,
  type PgFixture,
} from "./pg-harness.js";

const CATEGORY = { slug: "electronics-phones", depth: 2, isActive: true } as const;

class ProbeFailure extends Error {
  constructor() {
    super("فشلٌ مدفوعٌ في وسطِ المعاملة");
  }
}

describe.runIf(PG_ENABLED)("ذرّيّةُ القرارِ الواحد", () => {
  let pg: PgFixture;
  let storeId: string;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(async () => {
    await resetData(pg.pool);
    const categoryId = await seedLeafCategory(pg.stores);
    const store = await pg.stores.resources.insertStore(
      draftStore({
        ownerPublicId: OWNER,
        slug: "medina-dates",
        titleAr: "متجرُ تمورِ المدينة",
        categoryId,
        category: CATEGORY,
        activeStoreCount: 0,
      }),
    );
    storeId = store.storeId;
    // طلبُ المراجعةِ أوّلُ صفٍّ في الدفتر (التسلسلُ 2 من `draft`)، وهو خطُّ الأساسِ الذي تُقاس
    // إليه كلُّ عدّةِ صفوفٍ في هذا الملفّ: ما يجب أن يبقى بعد فشلٍ هو **هو** لا صفرٌ مطلق.
    await new MarketplaceUnitOfWork(pg.db).write(async ({ stores }) => {
      await stores.ledger.appendStoreReview(storeId, {
        decision: "review_requested",
        actorType: "owner",
        actorPublicId: OWNER,
        fromState: "draft",
        toState: "pending_review",
        stateSequence: 2,
        decidedAt: T0,
      });
      const ledger = await stores.ledger.listStoreReviews(storeId);
      return stores.projection.projectStoreState(storeId, deriveStoreState(ledger));
    });
  });

  /** قرارُ اعتمادٍ كاملٌ: دفترٌ ثمّ إسقاطٌ، بخطّافٍ اختياريٍّ بينهما. */
  function approve(uow: MarketplaceUnitOfWork) {
    return uow.write(async ({ stores, probe }) => {
      await stores.ledger.appendStoreReview(storeId, {
        decision: "approved",
        actorType: "moderator",
        actorPublicId: MODERATOR,
        fromState: "pending_review",
        toState: "approved",
        stateSequence: 3,
        decidedAt: T1,
      });
      await probe?.("after-ledger");
      const ledger = await stores.ledger.listStoreReviews(storeId);
      return stores.projection.projectStoreState(storeId, deriveStoreState(ledger));
    });
  }

  it("فشلٌ بعد الدفترِ وقبل الإسقاطِ يمحو الاثنَين", async () => {
    const failing = new MarketplaceUnitOfWork(pg.db, async (stage) => {
      if (stage === "after-ledger") throw new ProbeFailure();
    });
    await expect(approve(failing)).rejects.toBeInstanceOf(ProbeFailure);

    expect(await countRows(pg.pool, "store_reviews")).toBe(1);
    const store = await pg.stores.resources.findStoreById(storeId);
    expect(store?.state).toBe("pending_review");
    expect(store?.stateSequence).toBe(2);
    expect(store?.firstApprovedAt).toBeUndefined();
  });

  it("وبلا خطّافٍ يمرّ القرارُ كاملاً بمحاولةٍ واحدة", async () => {
    const result = await approve(new MarketplaceUnitOfWork(pg.db));
    expect(result.attempts).toBe(1);
    expect(await countRows(pg.pool, "store_reviews")).toBe(2);
    expect((await pg.stores.resources.findStoreById(storeId))?.state).toBe("approved");
    expect((await pg.stores.resources.findStoreById(storeId))?.firstApprovedAt).toBe(T1);
  });

  it("والقراءةُ لا تفتح معاملةً ولا تُعيد محاولةً", async () => {
    await approve(new MarketplaceUnitOfWork(pg.db));
    const uow = new MarketplaceUnitOfWork(pg.db);
    const ledger = await uow.read(({ stores }) => stores.ledger.listStoreReviews(storeId));
    expect(ledger).toHaveLength(2);
  });

  it("وسباقُ التسلسلِ يُعاد ثلاثاً ثمّ يُرمى بلا كتابةٍ ناقصة", async () => {
    // القرارُ الأوّلُ يشغل التسلسلَ 1؛ والثاني يُصرّ عليه فيتكرّر السباقُ حتى السقف.
    await approve(new MarketplaceUnitOfWork(pg.db));
    let attempts = 0;
    const uow = new MarketplaceUnitOfWork(pg.db);
    await expect(
      uow.write(async ({ stores }) => {
        attempts += 1;
        return stores.ledger.appendStoreReview(storeId, {
          decision: "suspended",
          reasonCode: "policy_violation",
          actorType: "moderator",
          actorPublicId: MODERATOR,
          fromState: "approved",
          toState: "suspended",
          stateSequence: 3,
          decidedAt: T1,
        });
      }),
    ).rejects.toThrow();
    expect(attempts).toBe(MAX_DECISION_ATTEMPTS);
    expect(await countRows(pg.pool, "store_reviews")).toBe(2);
  });

  it("وخطأٌ ليس سباقاً يُرمى من أوّلِ محاولة", async () => {
    let attempts = 0;
    const uow = new MarketplaceUnitOfWork(pg.db);
    await expect(
      uow.write(async () => {
        attempts += 1;
        throw new ProbeFailure();
      }),
    ).rejects.toBeInstanceOf(ProbeFailure);
    expect(attempts).toBe(1);
  });

  it("وسقفُ المحاولاتِ ثلاثٌ مُعلَنةٌ لا رقمٌ مدسوس", () => {
    expect(MAX_DECISION_ATTEMPTS).toBe(3);
  });

  it("ولا كتابةَ تُفلت من المعاملةِ: الطاقمُ والدفترُ يسقطان معاً", async () => {
    const failing = new MarketplaceUnitOfWork(pg.db, async () => {
      throw new ProbeFailure();
    });
    await expect(
      failing.write(async ({ stores, probe }) => {
        await stores.staff.insertMember(storeId, {
          memberPublicId: OWNER,
          role: "owner",
          addedByPublicId: OWNER,
          addedAt: T0,
        });
        await stores.ledger.appendStoreReview(storeId, {
          decision: "approved",
          actorType: "moderator",
          actorPublicId: MODERATOR,
          fromState: "pending_review",
          toState: "approved",
          stateSequence: 3,
          decidedAt: T1,
        });
        await probe?.("after-ledger");
        return undefined;
      }),
    ).rejects.toBeInstanceOf(ProbeFailure);
    expect(await countRows(pg.pool, "store_staff")).toBe(0);
    expect(await countRows(pg.pool, "store_reviews")).toBe(1);
  });
});

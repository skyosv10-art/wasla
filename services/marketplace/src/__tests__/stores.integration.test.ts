/**
 * المتجرُ على قاعدةٍ حقيقيّة: الدفترُ مصدرٌ والعمودُ إسقاطٌ — يُثبَت لا يُدَّعى.
 *
 * الاختبارُ المركزيُّ هنا ليس «هل كُتب العمود» بل: **أعِد بناءَ الحالةِ من الدفترِ وقارنها
 * بالعمود**. فلو دخل يوماً مسارٌ يكتب `stores.state` بلا صفِّ دفترٍ، أو كتب حالةً غيرَ ما يشتقّه
 * `deriveStoreState`، سقط هذا الملفّ. وهذا هو الحارسُ الفعليُّ للقرارِ 1، لا التعليقُ فوقَه.
 *
 * ويُفحَص كذلك ما لا يُفحَص إلّا على قاعدةٍ: تفرّدُ اللاحقةِ، وحدُّ متجرٍ نشطٍ للمالكِ (فهرسٌ
 * جزئيّ)، وسباقُ التسلسلِ بين قرارَين متزامنَين — ثلاثةُ أشياءَ يستحيل إثباتُها بمخزنٍ في
 * الذاكرة، وثلاثةٌ كانت أصلَ أعطابٍ في أطوارٍ سابقة.
 *
 * ## ملاحظةٌ قِيست في هذه المراجعة: `ux_stores_slug_lower` حرسٌ مزدوجٌ لا وحيد
 *
 * أردنا فحصَ تفرّدٍ بفرقِ حالةِ أحرفٍ (`madinah-oud` مقابلَ `Madinah-Oud`) فوجدنا أنّ اللاحقةَ
 * بحرفٍ كبيرٍ **لا تصل الفهرسَ أصلاً**: يرفضها `CHECK (slug ~ '^[a-z][a-z0-9-]{2,47}$')` في
 * العقدِ، ويرفضها `assertStoreSlug` قبله في المجال. فالفهرسُ على `LOWER(slug)` طبقةٌ ثالثةٌ
 * تبقى نافعةً لو رُخِّي فحصُ الصيغةِ يوماً، وليست هي الحارسَ الوحيد. ولذلك يفحص هذا الملفُّ
 * **الحقيقتَين معاً**: لاحقةٌ مكرَّرةٌ تُرفَض برمزٍ مُعلَنٍ، ولاحقةٌ بحرفٍ كبيرٍ تُرفَض بصيغتِها —
 * ولا يُدَّعى فحصٌ لا يقع.
 *
 * ## والتسلسلُ يبدأ من 2 في الدفترِ لا من 1
 *
 * المتجرُ يُنشَأ بالتسلسلِ 1 بلا صفِّ دفترٍ (الإنشاءُ ليس قراراً مُراجَعاً)، فأوّلُ صفٍّ في
 * `store_reviews` تسلسلُه 2 و`from_state` فيه `draft`. وهذا ما يفرضه `deriveStoreState`
 * بحرفه، ولذلك تُكتب الأرقامُ هنا كما سيكتبها التطبيقُ في 4/6 لا كما تُريح الاختبار.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { deriveStoreState } from "../domain/state.js";
import { draftStore } from "../domain/catalog.js";
import { STORE_ACTIVE_LIMIT_PER_OWNER } from "@wasla/contracts-marketplace";
import { MarketplaceUnitOfWork } from "../db/unit-of-work.js";
import {
  MODERATOR,
  OWNER,
  PG_ENABLED,
  T0,
  T1,
  T2,
  countRows,
  rejectingConstraint,
  resetData,
  seedLeafCategory,
  setupPostgres,
  type PgFixture,
} from "./pg-harness.js";

describe.runIf(PG_ENABLED)("استمراريّةُ المتجر", () => {
  let pg: PgFixture;
  let categoryId: string;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(async () => {
    await resetData(pg.pool);
    categoryId = await seedLeafCategory(pg.stores);
  });

  async function createStore(slug = "medina-dates", ownerPublicId = OWNER): Promise<string> {
    const draft = draftStore({
      ownerPublicId,
      slug,
      titleAr: "متجرُ تمورِ المدينة",
      categoryId,
      category: { slug: "electronics-phones", depth: 2, isActive: true },
      activeStoreCount: 0,
    });
    const store = await pg.stores.resources.insertStore(draft);
    return store.storeId;
  }

  /** أوّلُ قرارٍ في الدفتر: طلبُ مراجعةٍ بتسلسلٍ 2 من `draft` — دفترٌ ثمّ إسقاطٌ في معاملةٍ. */
  async function requestReview(storeId: string, ownerPublicId = OWNER): Promise<void> {
    const uow = new MarketplaceUnitOfWork(pg.db);
    await uow.write(async ({ stores }) => {
      await stores.ledger.appendStoreReview(storeId, {
        decision: "review_requested",
        actorType: "owner",
        actorPublicId: ownerPublicId,
        fromState: "draft",
        toState: "pending_review",
        stateSequence: 2,
        decidedAt: T0,
      });
      const ledger = await stores.ledger.listStoreReviews(storeId);
      return stores.projection.projectStoreState(storeId, deriveStoreState(ledger));
    });
  }

  it("المتجرُ يُنشَأ مسوّدةً بتسلسلٍ 1 ومُعرّفٍ من القاعدة", async () => {
    const storeId = await createStore();
    const store = await pg.stores.resources.findStoreById(storeId);
    expect(store?.state).toBe("draft");
    expect(store?.stateSequence).toBe(1);
    expect(store?.firstApprovedAt).toBeUndefined();
    expect(storeId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("والإسقاطُ يساوي اشتقاقَ الدفترِ — حرفاً بحرف", async () => {
    const storeId = await createStore();
    await requestReview(storeId);
    // ثلاثةُ قراراتٍ متعاقبةٍ، كلٌّ منها دفترٌ ثمّ إسقاطٌ في معاملةٍ واحدة.
    const decisions = [
      { toState: "approved", stateSequence: 3, at: T1 },
      { toState: "suspended", stateSequence: 4, at: T2 },
    ] as const;

    const uow = new MarketplaceUnitOfWork(pg.db);
    for (const decision of decisions) {
      await uow.write(async ({ stores }) => {
        const ledger = await stores.ledger.listStoreReviews(storeId);
        const previous = ledger[ledger.length - 1];
        await stores.ledger.appendStoreReview(storeId, {
          decision: decision.toState === "approved" ? "approved" : "suspended",
          ...(decision.toState === "approved" ? {} : { reasonCode: "policy_violation" as const }),
          actorType: "moderator",
          actorPublicId: MODERATOR,
          fromState: previous?.toState ?? null,
          toState: decision.toState,
          stateSequence: decision.stateSequence,
          decidedAt: decision.at,
        });
        const full = await stores.ledger.listStoreReviews(storeId);
        return stores.projection.projectStoreState(storeId, deriveStoreState(full));
      });
    }

    const ledger = await pg.stores.ledger.listStoreReviews(storeId);
    const derived = deriveStoreState(ledger);
    const store = await pg.stores.resources.findStoreById(storeId);

    expect(ledger).toHaveLength(3);
    expect(ledger.map((entry) => entry.stateSequence)).toEqual([2, 3, 4]);
    expect(store?.state).toBe(derived.state);
    expect(store?.stateSequence).toBe(derived.stateSequence);
    expect(store?.firstApprovedAt).toBe(derived.firstApprovedAt);
    // اللاحقةُ مُقفَلةٌ بعد أوّلِ اعتمادٍ وإن أُوقِف المتجرُ بعده (القرار 7).
    expect(store?.firstApprovedAt).toBe(T1);
    expect(store?.state).toBe("suspended");
  });

  it("و`first_approved_at` لا تُدهَس بإعادةِ إسقاطٍ لاحق", async () => {
    const storeId = await createStore();
    const uow = new MarketplaceUnitOfWork(pg.db);
    await uow.write(async ({ stores }) =>
      stores.projection.projectStoreState(storeId, {
        state: "approved",
        stateSequence: 5,
        firstApprovedAt: T1,
      }),
    );
    await uow.write(async ({ stores }) =>
      stores.projection.projectStoreState(storeId, {
        state: "approved",
        stateSequence: 6,
        firstApprovedAt: T2,
      }),
    );
    const store = await pg.stores.resources.findStoreById(storeId);
    expect(store?.firstApprovedAt).toBe(T1);
  });

  it("وإسقاطٌ بتسلسلٍ أقدمَ لا يفعل شيئاً ولا يُرجع حالةً", async () => {
    const storeId = await createStore();
    await pg.stores.projection.projectStoreState(storeId, { state: "approved", stateSequence: 4 });
    const stale = await pg.stores.projection.projectStoreState(storeId, {
      state: "pending_review",
      stateSequence: 2,
    });
    expect(stale).toBeUndefined();
    expect((await pg.stores.resources.findStoreById(storeId))?.state).toBe("approved");
  });

  it("واللاحقةُ المكرَّرةُ تُرفَض برمزٍ مُعلَنٍ من القاعدة", async () => {
    await createStore("madinah-oud");
    await expect(createStore("madinah-oud", "WS-1000000009")).rejects.toMatchObject({
      code: "STORE_SLUG_TAKEN",
    });
    expect(await countRows(pg.pool, "stores")).toBe(1);
  });

  it("ولاحقةٌ بحرفٍ كبيرٍ لا تصل الفهرسَ أصلاً: صيغتُها ترفضها في القاعدة", async () => {
    // نتجاوز `draftStore` بقصدٍ: المجالُ يرفضها قبل القاعدة، والمقصودُ إثباتُ حرسِ العقدِ نفسِه.
    await expect(
      pg.stores.resources.insertStore({
        ownerPublicId: OWNER,
        slug: "Madinah-Oud",
        titleAr: "متجرُ عودِ المدينة",
        categoryId,
        state: "draft",
        stateSequence: 1,
      }),
    ).rejects.toThrow();
    expect(await countRows(pg.pool, "stores")).toBe(0);
  });

  it("والبحثُ باللاحقةِ لا يُبالي بحالةِ الأحرف", async () => {
    const storeId = await createStore("uhud-honey");
    expect((await pg.stores.resources.findStoreBySlug("UHUD-HONEY"))?.storeId).toBe(storeId);
  });

  it("والمالكُ لا يملك متجرَين نشطَين — القاعدةُ تمنعُ لا الكود", async () => {
    expect(STORE_ACTIVE_LIMIT_PER_OWNER).toBe(1);
    await createStore("first-store");
    await expect(createStore("second-store")).rejects.toMatchObject({
      code: "STORE_OWNER_LIMIT_REACHED",
    });
    expect(await pg.stores.resources.countActiveStoresForOwner(OWNER)).toBe(1);
  });

  it("وقرارُ رفضٍ بلا سببٍ يسقط على قيدِ العقدِ باسمِه", async () => {
    const storeId = await createStore();
    await requestReview(storeId);
    expect(
      await rejectingConstraint(
        pg.stores.ledger.appendStoreReview(storeId, {
          decision: "rejected",
          actorType: "moderator",
          actorPublicId: MODERATOR,
          fromState: "pending_review",
          toState: "rejected",
          stateSequence: 3,
          decidedAt: T1,
        }),
      ),
    ).toBe("ck_store_reviews_reason_required");
  });

  it("وسباقُ تسلسلٍ يسقط باسمِ الفهرسِ لا بصمت", async () => {
    const storeId = await createStore();
    await requestReview(storeId);
    const entry = {
      decision: "approved",
      actorType: "moderator",
      actorPublicId: MODERATOR,
      fromState: "pending_review",
      toState: "approved",
      stateSequence: 3,
      decidedAt: T1,
    } as const;
    await pg.stores.ledger.appendStoreReview(storeId, entry);
    expect(await rejectingConstraint(pg.stores.ledger.appendStoreReview(storeId, entry))).toBe(
      "ux_store_reviews_sequence",
    );
    expect(await countRows(pg.pool, "store_reviews")).toBe(2);
  });
});

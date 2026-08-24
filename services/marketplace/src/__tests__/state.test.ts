/**
 * حرسُ اشتقاقِ الحالة: الإسقاطُ بلا خسارة، والدفترُ الفاسدُ يُعلَن ولا يُصلَح صامتاً.
 *
 * أهمُّ اختبارٍ هنا: **إعادةُ البناءِ بلا خسارة**. يُبنى دفترُ متجرٍ يمرّ بكلِّ ما يمكن أن يمرّ
 * به (طلبٌ · رفضٌ · طلبٌ · اعتمادٌ · إيقافٌ · إعادةٌ · أرشفة) ثمّ تُقارَن الحالةُ المُشتقّةُ
 * والتسلسلُ و`first_approved_at` بما يجب أن يكون في العمود. لو صار العمودُ يوماً حقيقةً أولى
 * تُكتَب بيدٍ لسقط هذا الاختبار.
 */
import { describe, expect, it } from "vitest";

import { MarketplaceError } from "../domain/errors.js";
import type { ProductReviewEntry, StoreReviewEntry } from "../domain/model.js";
import {
  PRODUCT_INITIAL_MODERATION_SEQUENCE,
  PRODUCT_INITIAL_MODERATION_STATE,
  STORE_INITIAL_SEQUENCE,
  STORE_INITIAL_STATE,
  deriveProductModerationState,
  deriveStoreState,
} from "../domain/state.js";

const MODERATOR = "WS-0000000042";
const OWNER = "WS-0000000007";

function storeEntry(
  sequence: number,
  entry: Omit<StoreReviewEntry, "stateSequence" | "decidedAt" | "actorType" | "actorPublicId"> &
    Partial<Pick<StoreReviewEntry, "actorType" | "actorPublicId" | "decidedAt">>,
): StoreReviewEntry {
  return {
    actorType: entry.actorType ?? "moderator",
    actorPublicId:
      entry.actorType === "system" ? undefined : (entry.actorPublicId ?? MODERATOR),
    decidedAt: entry.decidedAt ?? `2026-03-0${sequence}T10:00:00.000Z`,
    stateSequence: sequence,
    decision: entry.decision,
    fromState: entry.fromState,
    toState: entry.toState,
    ...(entry.reasonCode === undefined ? {} : { reasonCode: entry.reasonCode }),
  };
}

/** الدورةُ الكاملة: مسوّدةٌ ← مراجعةٌ ← رفضٌ ← مراجعةٌ ← اعتمادٌ ← إيقافٌ ← إعادةٌ ← أرشفة. */
function fullStoreLedger(): StoreReviewEntry[] {
  return [
    storeEntry(2, {
      decision: "review_requested",
      fromState: "draft",
      toState: "pending_review",
      actorType: "owner",
      actorPublicId: OWNER,
    }),
    storeEntry(3, {
      decision: "rejected",
      fromState: "pending_review",
      toState: "rejected",
      reasonCode: "incomplete_profile",
    }),
    storeEntry(4, {
      decision: "review_requested",
      fromState: "rejected",
      toState: "pending_review",
      actorType: "owner",
      actorPublicId: OWNER,
    }),
    storeEntry(5, { decision: "approved", fromState: "pending_review", toState: "approved" }),
    storeEntry(6, {
      decision: "suspended",
      fromState: "approved",
      toState: "suspended",
      reasonCode: "policy_violation",
    }),
    storeEntry(7, { decision: "reinstated", fromState: "suspended", toState: "approved" }),
    storeEntry(8, {
      decision: "archived",
      fromState: "approved",
      toState: "archived",
      reasonCode: "owner_request",
      actorType: "owner",
      actorPublicId: OWNER,
    }),
  ];
}

describe("اشتقاقُ حالةِ المتجر", () => {
  it("دفترٌ فارغٌ ⇒ `draft` بتسلسلٍ 1 بلا اعتمادٍ أوّل", () => {
    expect(deriveStoreState([])).toEqual({
      state: STORE_INITIAL_STATE,
      stateSequence: STORE_INITIAL_SEQUENCE,
    });
  });

  it("يُعيد بناءَ الدورةِ الكاملةِ بلا خسارة", () => {
    const derived = deriveStoreState(fullStoreLedger());
    expect(derived.state).toBe("archived");
    expect(derived.stateSequence).toBe(8);
    // أوّلُ اعتمادٍ لا آخرُه: التسلسلُ 5 لا 7، وإن أُعيد المتجرُ بعد إيقافٍ ثمّ أُرشِف.
    expect(derived.firstApprovedAt).toBe("2026-03-05T10:00:00.000Z");
  });

  it("`first_approved_at` يبقى بعد الإيقافِ ولا يُمسَح بالأرشفة", () => {
    const ledger = fullStoreLedger();
    const untilSuspension = deriveStoreState(ledger.slice(0, 5));
    expect(untilSuspension.state).toBe("suspended");
    expect(untilSuspension.firstApprovedAt).toBe("2026-03-05T10:00:00.000Z");
  });

  it("الطيُّ الجزئيُّ لكلّ بادئةٍ من الدفترِ يتّفق مع `to_state` المكتوبِ في آخرِ صفٍّ منها", () => {
    const ledger = fullStoreLedger();
    for (let index = 1; index <= ledger.length; index += 1) {
      const prefix = ledger.slice(0, index);
      const last = prefix[index - 1] as StoreReviewEntry;
      const derived = deriveStoreState(prefix);
      expect(derived.state).toBe(last.toState);
      expect(derived.stateSequence).toBe(last.stateSequence);
    }
  });

  it("يرفض ثغرةً في التسلسل", () => {
    const ledger = [
      storeEntry(3, { decision: "review_requested", fromState: "draft", toState: "pending_review" }),
    ];
    expect(() => deriveStoreState(ledger)).toThrowError(MarketplaceError);
  });

  it("يرفض صفّاً لا تتّفق حالتُه السابقةُ مع ما بلغه الدفتر", () => {
    const ledger = [
      storeEntry(2, { decision: "approved", fromState: "pending_review", toState: "approved" }),
    ];
    expect(() => deriveStoreState(ledger)).toThrowError(MarketplaceError);
  });

  it("يرفض صفّاً يقول قراراً وحالةً لا يتّفقان", () => {
    const ledger = [
      storeEntry(2, { decision: "review_requested", fromState: "draft", toState: "approved" }),
    ];
    expect(() => deriveStoreState(ledger)).toThrowError(MarketplaceError);
  });

  it("يرفض زوجاً ليس في جدولِ العقد وإن اتّفق القرارُ والحالة", () => {
    const ledger = [
      storeEntry(2, { decision: "review_requested", fromState: "draft", toState: "pending_review" }),
      storeEntry(3, { decision: "approved", fromState: "pending_review", toState: "approved" }),
      storeEntry(4, {
        decision: "suspended",
        fromState: "approved",
        toState: "suspended",
        reasonCode: "policy_violation",
      }),
      storeEntry(5, { decision: "archived", fromState: "suspended", toState: "archived" }),
    ];
    expect(() => deriveStoreState(ledger)).toThrowError(MarketplaceError);
  });

  it("يرفض زمناً يسبق زمنَ الصفِّ السابقِ ويقبل التساوي", () => {
    const base: StoreReviewEntry[] = [
      storeEntry(2, {
        decision: "review_requested",
        fromState: "draft",
        toState: "pending_review",
        decidedAt: "2026-03-02T10:00:00.000Z",
      }),
    ];
    const backwards = [
      ...base,
      storeEntry(3, {
        decision: "approved",
        fromState: "pending_review",
        toState: "approved",
        decidedAt: "2026-03-01T10:00:00.000Z",
      }),
    ];
    expect(() => deriveStoreState(backwards)).toThrowError(MarketplaceError);

    const simultaneous = [
      ...base,
      storeEntry(3, {
        decision: "approved",
        fromState: "pending_review",
        toState: "approved",
        decidedAt: "2026-03-02T10:00:00.000Z",
      }),
    ];
    expect(deriveStoreState(simultaneous).state).toBe("approved");
  });

  it("`system` بلا مُعرّفٍ مُسمّى، وكلُّ فاعلٍ سواه يلزمه مُعرّف", () => {
    const systemWithId: StoreReviewEntry = {
      decision: "review_requested",
      fromState: "draft",
      toState: "pending_review",
      actorType: "system",
      actorPublicId: MODERATOR,
      stateSequence: 2,
      decidedAt: "2026-03-02T10:00:00.000Z",
    };
    expect(() => deriveStoreState([systemWithId])).toThrowError(MarketplaceError);

    const moderatorWithoutId: StoreReviewEntry = {
      decision: "review_requested",
      fromState: "draft",
      toState: "pending_review",
      actorType: "moderator",
      stateSequence: 2,
      decidedAt: "2026-03-02T10:00:00.000Z",
    };
    expect(() => deriveStoreState([moderatorWithoutId])).toThrowError(MarketplaceError);
  });
});

describe("اشتقاقُ اعتدالِ المنتج", () => {
  const pendingToApproved: ProductReviewEntry = {
    decision: "approved",
    actorType: "moderator",
    actorPublicId: MODERATOR,
    fromState: "pending",
    toState: "approved",
    moderationSequence: 2,
    decidedAt: "2026-03-05T12:00:00.000Z",
  };

  it("دفترٌ فارغٌ ⇒ `pending` بتسلسلٍ 1: لا منتجَ يُنشَأ معتمَداً", () => {
    expect(deriveProductModerationState([])).toEqual({
      moderationState: PRODUCT_INITIAL_MODERATION_STATE,
      moderationSequence: PRODUCT_INITIAL_MODERATION_SEQUENCE,
    });
  });

  it("يشتقُّ الاعتمادَ والرفضَ من قرارٍ واحد", () => {
    expect(deriveProductModerationState([pendingToApproved])).toEqual({
      moderationState: "approved",
      moderationSequence: 2,
    });
    expect(
      deriveProductModerationState([
        {
          decision: "rejected",
          reasonCode: "misleading_title",
          actorType: "moderator",
          actorPublicId: MODERATOR,
          fromState: "pending",
          toState: "rejected",
          moderationSequence: 2,
          decidedAt: "2026-03-05T12:00:00.000Z",
        },
      ]),
    ).toEqual({ moderationState: "rejected", moderationSequence: 2 });
  });

  it("يرفض قراراً ثانياً على منتجٍ حُكِم فيه", () => {
    expect(() =>
      deriveProductModerationState([
        pendingToApproved,
        {
          decision: "rejected",
          reasonCode: "policy_violation",
          actorType: "moderator",
          actorPublicId: MODERATOR,
          fromState: "approved",
          toState: "rejected",
          moderationSequence: 3,
          decidedAt: "2026-03-06T12:00:00.000Z",
        },
      ]),
    ).toThrowError(MarketplaceError);
  });

  it("يرفض رفضاً بلا سببٍ واعتماداً بسبب", () => {
    expect(() =>
      deriveProductModerationState([
        {
          decision: "rejected",
          actorType: "moderator",
          actorPublicId: MODERATOR,
          fromState: "pending",
          toState: "rejected",
          moderationSequence: 2,
          decidedAt: "2026-03-05T12:00:00.000Z",
        },
      ]),
    ).toThrowError(MarketplaceError);

    expect(() =>
      deriveProductModerationState([{ ...pendingToApproved, reasonCode: "wrong_category" }]),
    ).toThrowError(MarketplaceError);
  });
});

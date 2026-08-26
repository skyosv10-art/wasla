/**
 * خدمةُ المتاجرِ وطاقمِها: كتابةٌ واحدةٌ في معاملةٍ واحدةٍ، والحالةُ إسقاطٌ لا مصدرُ حقيقة.
 *
 * ## الترتيبُ في كلّ كتابة، ولا يُبدَّل
 *
 * 1. حرسُ منعِ التكرار (`replayGuard`) — **أوّلُ** جملةٍ في المعاملة.
 * 2. قراءاتُ الحقائق: المتجرُ · دفترُه · التصنيفُ · الطاقم.
 * 3. حُكمُ المجالِ النقيّ: `assertStoreDecision` · `draftStore` · `assertStaffAddition`.
 * 4. صفُّ الدفتر (`appendStoreReview`) — الحقيقةُ تُكتب أوّلاً.
 * 5. الإسقاطُ (`projectStoreState`) — مُشتَقٌّ من الدفترِ لا من المُدخَل.
 * 6. تثبيتُ الجواب (`rememberOutcome`) — **آخرُ** جملة.
 *
 * ## الحالةُ إسقاطٌ: ما يعنيه ذلك عمليّاً
 *
 * لا مسارَ في هذا الملفّ يكتب `stores.state` من قيمةٍ وصلت في جسمِ طلب. القيمةُ المكتوبةُ
 * دائماً مخرَجُ `deriveStoreState(ledger)` بعد إضافةِ الصفّ — أي دالّةٌ في الدفترِ وحدَه.
 * وكتابةُ العمودِ بلا صفِّ دفترٍ **عيبٌ** لا اختصار: الإسقاطُ يُعاد بناؤه من الدفترِ، وعمودٌ
 * كُتب بلا صفٍّ يُمحى في أوّلِ إعادةِ بناءٍ فتعود الحالةُ إلى ما قبله بلا سببٍ ظاهر.
 *
 * وميراثُ المراجعة 3/6 مقروءٌ هنا: المتجرُ يُنشأ في التسلسلِ **1 بلا صفِّ دفتر**، فأوّلُ صفٍّ
 * في `store_reviews` تسلسلُه **2** و`from_state` فيه `draft`.
 *
 * ## ولا تِكّةَ ولا اعتمادَ تلقائيّ
 *
 * القرار 2: مرورُ الوقتِ لا يُنقل حالةً في هذا الحدّ. كلُّ صفٍّ في الدفترِ له فاعلٌ مُسمّىً
 * (أو `system` صريحاً)، والساعةُ تُسمّي لحظةَ قرارٍ صنعه إنسانٌ ولا تصنع قراراً.
 */

import {
  loadCategoryFacts,
  loadStoreBySlug,
  type MarketplaceServiceDeps,
} from "./context.js";
import { replayGuard, rememberOutcome, type IdempotencyEnvelope } from "./idempotency.js";
import {
  decodeCompositeCursor,
  decodeSequenceCursor,
  encodeCompositeCursor,
  encodeSequenceCursor,
} from "./cursor.js";
import type { Page, StorePageCursor } from "../db/index.js";
import type { StoreRecord, StoreReviewRecord, StoreStaffRecord } from "../db/rows.js";
import { assertOwnerStoreLimit, assertStoreCategory, draftStore } from "../domain/catalog.js";
import type {
  StoreActorType,
  StoreDecision,
  StoreReasonCode,
  StoreState,
} from "../domain/contract-sets.js";
import {
  marketplaceFilterRequired,
  storeReviewAlreadyPending,
  storeStaffNotFound,
  validationFailed,
} from "../domain/errors.js";
import { assertStaffAddition, assertStaffRemoval, sealStaffRemoval } from "../domain/staff.js";
import { deriveStoreState } from "../domain/state.js";
import { assertStoreDecision } from "../domain/transitions.js";

/** مُدخلُ تسجيلِ متجرٍ بعد تحقُّقِ الحدِّ — بلا `state`: الحالةُ إسقاطٌ لا حقلُ إدخال. */
export interface RegisterStoreInput {
  readonly ownerPublicId: string;
  readonly storeSlug: string;
  readonly titleAr: string;
  readonly titleEn?: string;
  readonly titleUr?: string;
  readonly descriptionAr?: string;
  readonly categorySlug: string;
}

export interface StoreDecisionInput {
  readonly decision: StoreDecision;
  readonly actorType: StoreActorType;
  readonly actorPublicId?: string;
  readonly reasonCode?: StoreReasonCode;
}

export interface AddStaffInput {
  readonly memberPublicId: string;
  readonly role: "manager" | "staff";
  readonly addedByPublicId: string;
}

/** قرارٌ استقرّ: صفُّ الدفترِ ومعه المتجرُ بحالته المُسقَطة — كلاهما من نفسِ المعاملة. */
export interface StoreDecisionOutcome {
  readonly review: StoreReviewRecord;
  readonly store: StoreRecord;
}

export interface ListStoresQuery {
  readonly state?: StoreState;
  readonly ownerPublicId?: string;
  readonly categorySlug?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

/** صفحةٌ مُعتِمةُ الموضع — الطبقةُ العليا لا تعرف أعمدةَ الترتيب. */
export interface OpaquePage<TItem> {
  readonly items: ReadonlyArray<TItem>;
  readonly nextCursor?: string;
}

function opaque<TItem>(
  page: Page<TItem, StorePageCursor>,
  toCursor: (cursor: StorePageCursor) => string,
): OpaquePage<TItem> {
  return page.nextCursor === undefined
    ? { items: page.items }
    : { items: page.items, nextCursor: toCursor(page.nextCursor) };
}

export class MarketplaceStoreService {
  constructor(private readonly deps: MarketplaceServiceDeps) {}

  /**
   * يُسجّل متجراً في `draft` بلا صفِّ دفتر — وهذا هو ميراثُ المراجعة 3/6 لا سهوٌ.
   *
   * ولمَ لا صفَّ دفترٍ للإنشاء؟ لأنّ الإنشاءَ ليس قراراً: لا فاعلَ يقرّر ولا انتقالَ من حالة.
   * وصفٌّ بـ`from_state: null` و`decision` مُصطنَعٍ كان سيُدخل قيمةً في `STORE_DECISION`
   * ليست في العقد.
   */
  async registerStore(
    input: RegisterStoreInput,
    envelope: IdempotencyEnvelope<StoreRecord>,
  ): Promise<StoreRecord> {
    const { value } = await this.deps.uow.write(async ({ stores }) => {
      await replayGuard(stores.idempotency, envelope);

      const category = await loadCategoryFacts(stores, input.categorySlug);
      assertStoreCategory(category);
      const activeStoreCount = await stores.resources.countActiveStoresForOwner(
        input.ownerPublicId,
      );
      assertOwnerStoreLimit(activeStoreCount);

      const draft = draftStore({
        ownerPublicId: input.ownerPublicId,
        slug: input.storeSlug,
        titleAr: input.titleAr,
        titleEn: input.titleEn,
        titleUr: input.titleUr,
        descriptionAr: input.descriptionAr,
        categoryId: category.categoryId,
        category,
        activeStoreCount,
      });

      const store = await stores.resources.insertStore(draft);
      return await rememberOutcome(stores.idempotency, envelope, store);
    });
    return value;
  }

  /** قراءةٌ بلا معاملة — و`GET` لا يُحفَظ جوابُه: لقطةٌ محفوظةٌ تُعيد ماضياً بعد قرار. */
  async getStore(storeSlug: string): Promise<StoreRecord> {
    return await this.deps.uow.read(async ({ stores }) => await loadStoreBySlug(stores, storeSlug));
  }

  /**
   * صفحةُ متاجرَ — بمُرشِّحٍ واحدٍ على الأقلّ، والمسحُ الكاملُ مرفوضٌ برمزٍ مُسمّىً.
   *
   * والرفضُ هنا لا في المخزن: `MARKETPLACE_FILTER_REQUIRED` قرارُ عقدٍ يقرؤه المُتَّصلُ، وفحصٌ
   * في المخزنِ وحدَه كان سيسمح لمُنادٍ داخليٍّ بالمسحِ ثمّ يُسقط القاعدةَ عند أوّلِ نموّ.
   */
  async listStores(query: ListStoresQuery): Promise<OpaquePage<StoreRecord>> {
    if (
      query.state === undefined &&
      query.ownerPublicId === undefined &&
      query.categorySlug === undefined
    ) {
      throw marketplaceFilterRequired("one of state, owner_public_id, category_slug");
    }
    return await this.deps.uow.read(async ({ stores }) => {
      const categoryId =
        query.categorySlug === undefined
          ? undefined
          : (await loadCategoryFacts(stores, query.categorySlug)).categoryId;
      const after =
        query.cursor === undefined ? undefined : decodeStoreCursor(query.cursor);
      const page = await stores.resources.listStoresPage({
        ...(query.state === undefined ? {} : { state: query.state }),
        ...(query.ownerPublicId === undefined ? {} : { ownerPublicId: query.ownerPublicId }),
        ...(categoryId === undefined ? {} : { categoryId }),
        ...(after === undefined ? {} : { after }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      });
      return opaque(page, (cursor) =>
        encodeCompositeCursor({ createdAt: cursor.createdAt, id: cursor.storeId }),
      );
    });
  }

  /**
   * يطلب مراجعةً: `draft|rejected → pending_review` بصفِّ دفترٍ وفاعلٍ مُسمّى.
   *
   * وطلبٌ ثانٍ على متجرٍ في `pending_review` يُرفض برمزِه الخاصِّ
   * (`STORE_REVIEW_ALREADY_PENDING`) لا برمزِ الانتقالِ العامّ: المُتَّصلُ الذي أعاد الطلبَ
   * يحتاج أن يقرأ «مراجعتُك قائمةٌ» لا «انتقالٌ غيرُ مسموح».
   */
  async requestStoreReview(
    storeSlug: string,
    requestedByPublicId: string,
    envelope: IdempotencyEnvelope<StoreDecisionOutcome>,
  ): Promise<StoreDecisionOutcome> {
    return await this.decide(
      storeSlug,
      {
        decision: "review_requested",
        actorType: "owner",
        actorPublicId: requestedByPublicId,
      },
      envelope,
      (derived) => {
        if (derived.state === "pending_review") throw storeReviewAlreadyPending(storeSlug);
      },
    );
  }

  /** قرارُ مُعتدِلٍ أو مالكٍ — نفسُ الطريقِ، والفرقُ في القيمِ لا في المسار. */
  async decideStore(
    storeSlug: string,
    input: StoreDecisionInput,
    envelope: IdempotencyEnvelope<StoreDecisionOutcome>,
  ): Promise<StoreDecisionOutcome> {
    return await this.decide(storeSlug, input, envelope);
  }

  private async decide(
    storeSlug: string,
    input: StoreDecisionInput,
    envelope: IdempotencyEnvelope<StoreDecisionOutcome>,
    guard?: (derived: { readonly state: StoreState }) => void,
  ): Promise<StoreDecisionOutcome> {
    const { value } = await this.deps.uow.write(async ({ stores, probe }) => {
      await replayGuard(stores.idempotency, envelope);

      const store = await loadStoreBySlug(stores, storeSlug);
      const ledger = await stores.ledger.listStoreReviews(store.storeId);
      const derived = deriveStoreState(ledger);
      guard?.(derived);

      const toState = assertStoreDecision({
        fromState: derived.state,
        decision: input.decision,
        ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
      });

      const review = await stores.ledger.appendStoreReview(store.storeId, {
        decision: input.decision,
        ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
        actorType: input.actorType,
        ...(input.actorPublicId === undefined ? {} : { actorPublicId: input.actorPublicId }),
        fromState: derived.state,
        toState,
        stateSequence: derived.stateSequence + 1,
        decidedAt: this.deps.clock.now(),
      });
      await probe?.("after-ledger");

      const nextDerived = deriveStoreState([...ledger, review]);
      const projected = await stores.projection.projectStoreState(store.storeId, nextDerived);
      await probe?.("after-projection");
      if (projected === undefined) {
        throw validationFailed("state_sequence", "a projection newer than the stored one");
      }

      return await rememberOutcome(stores.idempotency, envelope, {
        review,
        store: projected,
      });
    });
    return value;
  }

  /** الدفترُ كما كُتب — وهو الدليلُ على أنّ `stores.state` إسقاطٌ يُعاد بناؤه. */
  async listStoreReviews(
    storeSlug: string,
    options: { readonly cursor?: string; readonly limit?: number } = {},
  ): Promise<OpaquePage<StoreReviewRecord>> {
    return await this.deps.uow.read(async ({ stores }) => {
      const store = await loadStoreBySlug(stores, storeSlug);
      const page = await stores.ledger.listStoreReviewsPage(store.storeId, {
        ...(options.cursor === undefined ? {} : { after: decodeSequenceCursor(options.cursor) }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      });
      return page.nextCursor === undefined
        ? { items: page.items }
        : { items: page.items, nextCursor: encodeSequenceCursor(page.nextCursor) };
    });
  }

  /**
   * الطاقمُ كلُّه — النشطُ والمُزال، بلا تصفيح.
   *
   * والعقدُ يُعيد مصفوفةً بلا `next_cursor` قصداً: طاقمُ متجرٍ عشراتٌ لا آلاف، وتصفيحُ قائمةٍ
   * لا تنمو يُعقّد العميلَ بلا مقابل. ولو نمت، فالتغييرُ إضافةُ `next_cursor` لا كسرُ شكل.
   */
  async listStaff(storeSlug: string): Promise<ReadonlyArray<StoreStaffRecord>> {
    return await this.deps.uow.read(async ({ stores }) => {
      const store = await loadStoreBySlug(stores, storeSlug);
      return await stores.staff.listStaff(store.storeId);
    });
  }

  /** يُضيف عضواً — ودورُ `owner` مرفوضٌ من هذا المسار: المالكُ يُنشأ مع المتجرِ لا بطلب. */
  async addStaff(
    storeSlug: string,
    input: AddStaffInput,
    envelope: IdempotencyEnvelope<StoreStaffRecord>,
  ): Promise<StoreStaffRecord> {
    const { value } = await this.deps.uow.write(async ({ stores }) => {
      await replayGuard(stores.idempotency, envelope);

      const store = await loadStoreBySlug(stores, storeSlug);
      const existing = await stores.staff.listStaff(store.storeId);
      const role = assertStaffAddition({
        role: input.role,
        memberPublicId: input.memberPublicId,
        existing,
      });

      const member = await stores.staff.insertMember(store.storeId, {
        memberPublicId: input.memberPublicId,
        role,
        addedByPublicId: input.addedByPublicId,
        addedAt: this.deps.clock.now(),
      });
      return await rememberOutcome(stores.idempotency, envelope, member);
    });
    return value;
  }

  /**
   * يُزيل عضواً بختمِ `removed_at` — لا `DELETE` صلبٍ ولا صفٍّ يُمحى.
   *
   * الفهرسُ الفريدُ جزئيٌّ على `removed_at IS NULL`، فعودةُ مَن أُزيل ليست تعارضاً (القرار 8)،
   * وتاريخُ العضويّةِ يبقى مقروءاً. ومحوُ الصفِّ كان سيجعل «مَن أضاف هذا المنتج؟» بلا جواب.
   */
  async removeStaff(
    storeSlug: string,
    memberPublicId: string,
    removedByPublicId: string,
    envelope: IdempotencyEnvelope<StoreStaffRecord>,
  ): Promise<StoreStaffRecord> {
    const { value } = await this.deps.uow.write(async ({ stores }) => {
      await replayGuard(stores.idempotency, envelope);

      const store = await loadStoreBySlug(stores, storeSlug);
      const member = await stores.staff.findActiveMember(store.storeId, memberPublicId);
      if (member === undefined) throw storeStaffNotFound(memberPublicId);
      assertStaffRemoval(member);

      const sealed = sealStaffRemoval({
        member,
        removedAt: this.deps.clock.now(),
        removedByPublicId,
      });
      const removed = await stores.staff.sealRemoval({
        storeId: store.storeId,
        memberPublicId,
        removedAt: sealed.removedAt as string,
        removedByPublicId,
      });
      if (removed === undefined) throw storeStaffNotFound(memberPublicId);

      return await rememberOutcome(stores.idempotency, envelope, removed);
    });
    return value;
  }
}

/** يفكّ موضعَ متاجرَ مُعتِماً إلى شكلِ المخزن — والفكُّ في موضعٍ واحدٍ لا في كلّ نداء. */
function decodeStoreCursor(cursor: string): StorePageCursor {
  const decoded = decodeCompositeCursor(cursor);
  return { createdAt: decoded.createdAt, storeId: decoded.id };
}

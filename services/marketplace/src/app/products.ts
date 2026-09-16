/**
 * خدمةُ المنتجاتِ ومخزونِها — والظهورُ يُحسَب وقتَ القراءةِ ولا يُخزَّن.
 *
 * ## لماذا لا عمودَ `is_visible`
 *
 * الظهورُ حاصلُ أربعةِ شروطٍ في ثلاثةِ جداول: المتجرُ معتمَدٌ · المنتجُ منشورٌ · اعتدالُه
 * مقبولٌ · الكميّةُ أكبرُ من صفر. وعمودٌ مخزَّنٌ يعني أنّ كلَّ تغييرٍ في أيٍّ من الأربعةِ يجب
 * أن يُحدِّثه — وأوّلُ مسارٍ يُنسى (إيقافُ متجرٍ فيه ألفُ منتج) يترك ألفَ منتجٍ «ظاهرٍ» في
 * متجرٍ مُوقَف. والحسابُ وقتَ القراءةِ لا يمكن أن ينحرف لأنّه لا يُحفَظ.
 *
 * وحارسُ النقاءِ يمنع `is_visible` حقلاً مخزَّناً بالاسم — فهذا القرارُ مفحوصٌ لا موصوفٌ.
 *
 * ## ما يُصفَّر عند الأرشفة، وفي أيّ معاملة
 *
 * أرشفةُ منتجٍ تُصفِّر مخزونَه **بفرقٍ مُسجَّلٍ** سببُه `archive_zeroed` في معاملةِ الأرشفةِ
 * نفسِها. ولمَ فرقٌ لا تصفيرُ العمود؟ لأنّ العمودَ إسقاطٌ: تصفيرُه بلا صفٍّ في الدفترِ يجعل
 * رصيداً يختفي بلا سببٍ مقروء، وإعادةُ بناءِ الرصيدِ من الدفترِ تُعيده. ومعاملةٌ ثانيةٌ كانت
 * ستترك نافذةً يكون فيها المنتجُ مؤرشفاً ومخزونُه قائماً.
 *
 * ## الحسابُ بالهللاتِ عدداً صحيحاً
 *
 * القرار 4: السعرُ `price_minor_units` عددٌ صحيحٌ و`SAR` وحدَها. لا قسمةَ على مئةٍ ولا
 * `toFixed` ولا تنسيقَ في هذه الطبقة — التنسيقُ قرارُ عرضٍ يملكه العميل، وعائمٌ في مسارِ
 * بياناتٍ ماليّةٍ خطأٌ يظهر بعد آلافِ الصفوف. ولا سعرَ في حمولةِ حدثٍ أبداً.
 */

import {
  loadCategoryFacts,
  loadCategorySlugById,
  loadProductById,
  loadStoreById,
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
import type { OpaquePage } from "./stores.js";
import type { ProductVisibilityRow } from "../db/index.js";
import type { InventoryAdjustmentRecord, ProductRecord, ProductReviewRecord } from "../db/rows.js";
import { assertProductCategory, assertProductPublishable, draftProduct } from "../domain/catalog.js";
import type {
  InventoryReasonCode,
  ProductActorType,
  ProductDecision,
  ProductModerationState,
  ProductReasonCode,
  ProductState,
} from "../domain/contract-sets.js";
import { productNotFound, inventoryReservationConflict, validationFailed } from "../domain/errors.js";
import {
  inventoryAdjustedEvent,
  productArchivedEvent,
  productCreatedEvent,
  productModeratedEvent,
  productPublishedEvent,
} from "../domain/events.js";
import {
  INVENTORY_INITIAL_QUANTITY,
  INVENTORY_INITIAL_SEQUENCE,
  applyInventoryAdjustment,
  reconcileInventory,
  type InventoryReconciliation,
} from "../domain/inventory.js";
import { assertActiveMembership } from "../domain/staff.js";
import {
  buildReleaseAdjustments,
  buildReservationAdjustments,
  toReservationResults,
  type ReservationItem,
  type ReservationResult,
} from "../domain/reservation.js";
import { deriveProductModerationState } from "../domain/state.js";
import { assertProductDecision, assertProductTransition } from "../domain/transitions.js";
import { isVisible } from "../domain/visibility.js";

export interface CreateProductInput {
  readonly sku: string;
  readonly titleAr: string;
  readonly titleEn?: string;
  readonly titleUr?: string;
  readonly descriptionAr?: string;
  readonly categorySlug: string;
  readonly priceMinorUnits: number;
  readonly currencyCode: string;
  readonly createdByPublicId: string;
  readonly initialQuantity?: number;
}

export interface ProductDecisionInput {
  readonly decision: ProductDecision;
  readonly actorType: ProductActorType;
  readonly actorPublicId?: string;
  readonly reasonCode?: ProductReasonCode;
}

export interface AdjustInventoryInput {
  readonly quantityDelta: number;
  readonly reasonCode: InventoryReasonCode;
  readonly actorPublicId: string;
}

/** منتجٌ مع حكمِ ظهورِه المحسوبِ الآن — والحكمُ لا يُحفَظ ولا يُعاد إليه لاحقاً. */
export interface ProductView {
  readonly product: ProductRecord;
  readonly storeSlug: string;
  readonly quantityOnHand: number;
  readonly isVisible: boolean;
}

/** قراءةُ مخزونٍ: الرصيدُ الحاضرُ ومعه الدفترُ إن طُلب. */
export interface InventoryView {
  readonly productId: string;
  readonly storeId: string;
  readonly quantityOnHand: number;
  readonly lastAdjustmentSequence: number;
  readonly adjustments: ReadonlyArray<InventoryAdjustmentRecord>;
  readonly nextCursor?: string;
}

/** قرارُ اعتدالٍ ومعه مُعرِّفُ المتجرِ — لأنّ مورِدَ العقدِ يحمل `store_id` ولا يحمله صفُّ الدفتر. */
export interface ProductDecisionOutcome {
  readonly review: ProductReviewRecord;
  readonly storeId: string;
}

/** وفرقُ مخزونٍ ومعه مُعرِّفُ المتجرِ للسببِ نفسِه. */
export interface InventoryAdjustmentOutcome {
  readonly adjustment: InventoryAdjustmentRecord;
  readonly storeId: string;
}

/** طلبُ حجزٍ أو إفراجٍ من خدمةِ التسليم. */
export interface ReservationRequest {
  readonly orderPublicId: string;
  readonly items: ReadonlyArray<ReservationItem>;
}

/** نتيجةُ حجزٍ أو إفراجٍ — الأصنافُ المُطبَّق عليها الفروقُ والرصيدُ بعدها. */
export interface ReservationOutcome {
  readonly orderPublicId: string;
  readonly storeId: string;
  readonly results: ReadonlyArray<ReservationResult>;
}

export interface ListProductsQuery {
  readonly state?: ProductState;
  readonly moderationState?: ProductModerationState;
  readonly visibleOnly?: boolean;
  readonly cursor?: string;
  readonly limit?: number;
}

function toView(row: ProductVisibilityRow): ProductView {
  return {
    product: row.product,
    storeSlug: row.storeSlug,
    quantityOnHand: row.quantityOnHand,
    isVisible: isVisible({
      storeState: row.storeState,
      productState: row.product.state,
      moderationState: row.product.moderationState,
      quantityOnHand: row.quantityOnHand,
    }),
  };
}

export class MarketplaceProductService {
  constructor(private readonly deps: MarketplaceServiceDeps) {}

  /**
   * يُنشئ منتجاً في متجرٍ **معتمَدٍ** — و`draftProduct` هو مَن يرفض غيرَه.
   *
   * والكميّةُ الابتدائيّةُ إن وُجدت تُكتب **فرقاً في الدفتر** سببُه `initial_stock` في نفسِ
   * المعاملة، لا قيمةً ابتدائيّةً في عمود: القيمةُ في العمودِ بلا صفٍّ تجعل رصيداً لا سببَ له،
   * وإعادةُ بناءِ الرصيدِ من الدفترِ تُصفِّره.
   */
  async createProduct(
    storeSlug: string,
    input: CreateProductInput,
    envelope: IdempotencyEnvelope<ProductView>,
    actorPublicId: string,
  ): Promise<ProductView> {
    const { value } = await this.deps.uow.write(async ({ stores, probe }) => {
      await replayGuard(stores.idempotency, envelope);

      const store = await loadStoreBySlug(stores, storeSlug);
      /**
       * عضويّةُ الفاعلِ في المتجرِ داخلَ المعاملةِ نفسِها التي يُكتبُ
       * فيها المنتجُ (`M1-05B` الموجةُ 2) — **لا في قراءةٍ سابقةٍ عندَ
       * الحدِّ**. والفرقُ ليسَ أناقةً: فحصٌ في معاملةٍ وكتابةٌ في
       * أخرى يفتحُ نافذةً يُزالُ فيها العضوُ بينَ الفحصِ والكتابةِ
       * فتمرُّ كتابةُ مَن لم يعدُ عضواً.
       */
      assertActiveMembership({
        storeSlug,
        actorPublicId,
        storeOwnerPublicId: store.ownerPublicId,
        existing: await stores.staff.listStaff(store.storeId),
      });
      const category = await loadCategoryFacts(stores, input.categorySlug);
      assertProductCategory(category);

      const draft = draftProduct({
        storeId: store.storeId,
        storeState: store.state,
        sku: input.sku,
        titleAr: input.titleAr,
        titleEn: input.titleEn,
        titleUr: input.titleUr,
        descriptionAr: input.descriptionAr,
        categoryId: category.categoryId,
        category,
        priceMinorUnits: input.priceMinorUnits,
        currencyCode: input.currencyCode,
        createdByPublicId: input.createdByPublicId,
      });

      const product = await stores.resources.insertProduct(draft);
      await stores.outbox.appendEvent(
        productCreatedEvent({
          productId: product.productId,
          storeId: store.storeId,
          storeSlug: store.slug,
          sku: product.sku,
          categorySlug: category.slug,
          createdByPublicId: product.createdByPublicId,
          occurredFor: product.createdAt,
          occurredAt: this.deps.clock.now(),
        }),
      );

      if (input.initialQuantity !== undefined && input.initialQuantity > 0) {
        const entry = applyInventoryAdjustment({
          quantityOnHand: INVENTORY_INITIAL_QUANTITY,
          quantityDelta: input.initialQuantity,
          reasonCode: "initial_stock",
          actorPublicId: input.createdByPublicId,
          adjustmentSequence: INVENTORY_INITIAL_SEQUENCE + 1,
          occurredAt: this.deps.clock.now(),
        });
        const adjustment = await stores.ledger.appendInventoryAdjustment(product.productId, entry);
        await probe?.("after-ledger");
        await stores.projection.applyInventoryProjection(product.productId, entry);
        await probe?.("after-projection");
        await stores.outbox.appendEvent(
          inventoryAdjustedEvent({
            adjustmentId: adjustment.adjustmentId,
            productId: product.productId,
            storeId: store.storeId,
            quantityDelta: adjustment.quantityDelta,
            quantityAfter: adjustment.quantityAfter,
            reasonCode: adjustment.reasonCode,
            adjustmentSequence: adjustment.adjustmentSequence,
            actorPublicId: adjustment.actorPublicId,
            occurredFor: adjustment.occurredAt,
            occurredAt: this.deps.clock.now(),
          }),
        );
        await probe?.("after-outbox");
      }

      const quantityOnHand =
        input.initialQuantity === undefined ? INVENTORY_INITIAL_QUANTITY : input.initialQuantity;
      const view: ProductView = {
        product,
        storeSlug: store.slug,
        quantityOnHand,
        isVisible: isVisible({
          storeState: store.state,
          productState: product.state,
          moderationState: product.moderationState,
          quantityOnHand,
        }),
      };

      return await rememberOutcome(stores.idempotency, envelope, view);
    });
    return value;
  }

  async getProduct(productId: string): Promise<ProductView> {
    return await this.deps.uow.read(async ({ stores }) => {
      const row = await stores.resources.findProductVisibility(productId);
      if (row === undefined) throw productNotFound(productId);
      return toView(row);
    });
  }

  /**
   * صفحةُ منتجاتِ متجرٍ — و`visible_only` يُرشِّح **بعد** القراءةِ بحكمِ المجال.
   *
   * ولذلك قد تعود صفحةٌ أقصرَ من `limit` وبعدَها المزيد: غيابُ `next_cursor` هو إشارةُ
   * الانتهاءِ الوحيدة، وعددُ الصفوفِ ليس إشارة. والبديلُ — كتابةُ شروطِ الظهورِ الأربعةِ في
   * `WHERE` — كان سيُنشئ نسخةً ثانيةً من الحكمِ تنحرف عن `isVisible` عند أوّلِ تعديل.
   */
  async listProducts(storeSlug: string, query: ListProductsQuery): Promise<OpaquePage<ProductView>> {
    return await this.deps.uow.read(async ({ stores }) => {
      const store = await loadStoreBySlug(stores, storeSlug);
      const after =
        query.cursor === undefined
          ? undefined
          : (() => {
              const decoded = decodeCompositeCursor(query.cursor as string);
              return { createdAt: decoded.createdAt, productId: decoded.id };
            })();

      const page = await stores.resources.listProductsPage(store.storeId, {
        ...(query.state === undefined ? {} : { state: query.state }),
        ...(query.moderationState === undefined ? {} : { moderationState: query.moderationState }),
        ...(after === undefined ? {} : { after }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      });

      const views = page.items.map(toView);
      const items = query.visibleOnly === true ? views.filter((view) => view.isVisible) : views;
      return page.nextCursor === undefined
        ? { items }
        : {
            items,
            nextCursor: encodeCompositeCursor({
              createdAt: page.nextCursor.createdAt,
              id: page.nextCursor.productId,
            }),
          };
    });
  }

  /** نشرٌ: `draft → published` ولا يجوز إلّا باعتدالٍ مقبولٍ (`PRODUCT_NOT_MODERATED`). */
  async publishProduct(
    productId: string,
    actorPublicId: string,
    envelope: IdempotencyEnvelope<ProductView>,
  ): Promise<ProductView> {
    return await this.transitionState(productId, "published", actorPublicId, envelope);
  }

  /** أرشفةٌ: تصفيرُ المخزونِ بفرقٍ مُسجَّلٍ في المعاملةِ نفسِها. */
  async archiveProduct(
    productId: string,
    actorPublicId: string,
    envelope: IdempotencyEnvelope<ProductView>,
  ): Promise<ProductView> {
    return await this.transitionState(productId, "archived", actorPublicId, envelope);
  }

  private async transitionState(
    productId: string,
    toState: ProductState,
    actorPublicId: string,
    envelope: IdempotencyEnvelope<ProductView>,
  ): Promise<ProductView> {
    const { value } = await this.deps.uow.write(async ({ stores, probe }) => {
      await replayGuard(stores.idempotency, envelope);

      const product = await loadProductById(stores, productId);
      /**
       * عضويّةُ الفاعلِ في متجرِ المنتجِ **داخلَ المعاملةِ نفسِها** التي ستكتبُ
       * (`M1-05B` الموجةُ 4 · `RISK-0042` البندُ 3) — لا في قراءةٍ سابقةٍ عندَ
       * الحدِّ، وللسببِ نفسِهِ المكتوبِ في `createProduct`: العضويّةُ تُزالُ بينَ
       * فحصٍ وكتابةٍ، وفحصٌ في معاملةٍ وكتابةٌ في أُخرى يفتحُ النافذةَ.
       *
       * والنشرُ والأرشفةُ فعلُ عضوٍ في متجرِهِ — كالإنشاءِ الذي مُسِكَ بهذا
       * الحرسِ نفسِهِ في الموجةِ الثانيةِ. والبتُّ في اعتدالِ المنتجِ ليسَ هنا:
       * ذاكَ قرارُ منصّةٍ (`decideProduct`) وربطُهُ بالعضويّةِ **عكسُ السياسةِ**
       * — متجرٌ يوافقُ على نفسِهِ.
       */
      const memberStore = await loadStoreById(stores, product.storeId);
      assertActiveMembership({
        storeSlug: memberStore.slug,
        actorPublicId,
        storeOwnerPublicId: memberStore.ownerPublicId,
        existing: await stores.staff.listStaff(memberStore.storeId),
      });
      assertProductTransition(product.state, toState);
      if (toState === "published") {
        assertProductPublishable({
          productState: product.state,
          moderationState: product.moderationState,
        });
      }

      const fromState = product.state;
      const projected = await stores.projection.projectProductState(productId, toState);
      if (projected === undefined) throw productNotFound(productId);
      await probe?.("after-projection");

      if (toState === "archived") {
        const inventory = await stores.projection.findInventory(productId);
        const quantityOnHand = inventory?.quantityOnHand ?? INVENTORY_INITIAL_QUANTITY;
        if (quantityOnHand > 0) {
          const entry = applyInventoryAdjustment({
            quantityOnHand,
            quantityDelta: -quantityOnHand,
            reasonCode: "archive_zeroed",
            actorPublicId,
            adjustmentSequence:
              (inventory?.lastAdjustmentSequence ?? INVENTORY_INITIAL_SEQUENCE) + 1,
            occurredAt: this.deps.clock.now(),
          });
          const adjustment = await stores.ledger.appendInventoryAdjustment(productId, entry);
          await probe?.("after-ledger");
          await stores.projection.applyInventoryProjection(productId, entry);
          await stores.outbox.appendEvent(
            inventoryAdjustedEvent({
              adjustmentId: adjustment.adjustmentId,
              productId,
              storeId: product.storeId,
              quantityDelta: adjustment.quantityDelta,
              quantityAfter: adjustment.quantityAfter,
              reasonCode: adjustment.reasonCode,
              adjustmentSequence: adjustment.adjustmentSequence,
              actorPublicId: adjustment.actorPublicId,
              occurredFor: adjustment.occurredAt,
              occurredAt: this.deps.clock.now(),
            }),
          );
        }
      }

      const row = await stores.resources.findProductVisibility(productId);
      if (row === undefined) throw productNotFound(productId);

      await stores.outbox.appendEvent(
        toState === "archived"
          ? productArchivedEvent({
              productId,
              storeId: product.storeId,
              storeSlug: row.storeSlug,
              fromState,
              actorPublicId,
              occurredFor: row.product.updatedAt,
              occurredAt: this.deps.clock.now(),
            })
          : productPublishedEvent({
              productId,
              storeId: product.storeId,
              storeSlug: row.storeSlug,
              categorySlug: await loadCategorySlugById(stores, row.product.categoryId),
              fromState,
              storeState: row.storeState,
              quantityOnHand: row.quantityOnHand,
              actorPublicId,
              occurredFor: row.product.updatedAt,
              occurredAt: this.deps.clock.now(),
            }),
      );
      await probe?.("after-outbox");

      return await rememberOutcome(stores.idempotency, envelope, toView(row));
    });
    return value;
  }

  /**
   * قرارُ اعتدالٍ: صفٌّ في `product_reviews` ثمّ إسقاطُ `moderation_state`.
   *
   * والتسلسلُ من الدفترِ لا من العمود: `deriveProductModerationState` تفحص الاتّصالَ من
   * `PRODUCT_INITIAL_MODERATION_SEQUENCE`، والاعتمادُ على العمودِ كان سيجعل إسقاطاً قديماً
   * يُنتج صفَّ دفترٍ بتسلسلٍ مأخوذٍ فيسقط على `ux_product_reviews_sequence` — وهو السباقُ الذي
   * تُعيد `MarketplaceUnitOfWork` المحاولةَ فيه.
   */
  async decideProduct(
    productId: string,
    input: ProductDecisionInput,
    envelope: IdempotencyEnvelope<ProductDecisionOutcome>,
  ): Promise<ProductDecisionOutcome> {
    const { value } = await this.deps.uow.write(async ({ stores, probe }) => {
      await replayGuard(stores.idempotency, envelope);

      const product = await loadProductById(stores, productId);
      const ledger = await stores.ledger.listProductReviews(productId);
      const derived = deriveProductModerationState(ledger);

      const toState = assertProductDecision({
        fromState: derived.moderationState,
        decision: input.decision,
        ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
      });

      const review = await stores.ledger.appendProductReview(productId, {
        decision: input.decision,
        ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
        actorType: input.actorType,
        ...(input.actorPublicId === undefined ? {} : { actorPublicId: input.actorPublicId }),
        fromState: derived.moderationState,
        toState,
        moderationSequence: derived.moderationSequence + 1,
        decidedAt: this.deps.clock.now(),
      });
      await probe?.("after-ledger");

      const next = deriveProductModerationState([...ledger, review]);
      const projected = await stores.projection.projectProductModeration(productId, next);
      await probe?.("after-projection");
      if (projected === undefined) {
        throw validationFailed("moderation_sequence", "a projection newer than the stored one");
      }

      const store = await stores.resources.findStoreById(product.storeId);
      if (store === undefined) throw productNotFound(productId);
      await stores.outbox.appendEvent(
        productModeratedEvent({
          productId,
          storeId: product.storeId,
          storeSlug: store.slug,
          fromState: review.fromState,
          toState,
          moderationSequence: review.moderationSequence,
          actorType: input.actorType,
          ...(input.actorPublicId === undefined ? {} : { actorPublicId: input.actorPublicId }),
          ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
          occurredFor: review.decidedAt,
          occurredAt: this.deps.clock.now(),
        }),
      );
      await probe?.("after-outbox");

      return await rememberOutcome(stores.idempotency, envelope, {
        review,
        storeId: product.storeId,
      });
    });
    return value;
  }

  /** رصيدُ مخزونٍ ومعه دفترُه إن طُلب — والرصيدُ من الإسقاطِ لا مجموعُ صفوفٍ في كلّ قراءة. */
  async readInventory(
    productId: string,
    options: {
      readonly includeLedger?: boolean;
      readonly cursor?: string;
      readonly limit?: number;
    } = {},
  ): Promise<InventoryView> {
    return await this.deps.uow.read(async ({ stores }) => {
      const product = await loadProductById(stores, productId);
      const inventory = await stores.projection.findInventory(productId);
      const base = {
        productId,
        storeId: product.storeId,
        quantityOnHand: inventory?.quantityOnHand ?? INVENTORY_INITIAL_QUANTITY,
        lastAdjustmentSequence: inventory?.lastAdjustmentSequence ?? INVENTORY_INITIAL_SEQUENCE,
      };
      if (options.includeLedger !== true) return { ...base, adjustments: [] };

      const page = await stores.ledger.listInventoryAdjustmentsPage(productId, {
        ...(options.cursor === undefined ? {} : { after: decodeSequenceCursor(options.cursor) }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      });
      return page.nextCursor === undefined
        ? { ...base, adjustments: page.items }
        : {
            ...base,
            adjustments: page.items,
            nextCursor: encodeSequenceCursor(page.nextCursor),
          };
    });
  }

  /**
   * فرقُ مخزونٍ: الدفترُ أوّلاً ثمّ الإسقاطُ، والنزولُ تحت الصفرِ مرفوضٌ برمزِه.
   *
   * والرصيدُ المُدخَلُ في الحسابِ من الإسقاطِ داخلَ المعاملةِ نفسِها، فقراءةٌ قبلَها وكتابةٌ
   * بعدَها لا تفتح نافذةً لفرقَين متزامنَين يُنتجان رصيداً واحداً: الفهرسُ
   * `ux_inventory_adjustments_sequence` يُسقط الثاني، ووحدةُ العملِ تُعيد المحاولة.
   */
  async adjustInventory(
    productId: string,
    input: AdjustInventoryInput,
    envelope: IdempotencyEnvelope<InventoryAdjustmentOutcome>,
  ): Promise<InventoryAdjustmentOutcome> {
    const { value } = await this.deps.uow.write(async ({ stores, probe }) => {
      await replayGuard(stores.idempotency, envelope);

      const product = await loadProductById(stores, productId);
      /**
       * تعديلُ المخزونِ فعلُ عضوٍ في متجرِ المنتجِ — والحرسُ داخلَ المعاملةِ
       * نفسِها التي ستكتبُ سطرَ الدفترِ (`M1-05B` الموجةُ 4)، للسببِ عينِهِ
       * المكتوبِ أعلاهُ: لا نافذةَ بينَ فحصِ العضويّةِ وكتابةِ الفرقِ.
       */
      const memberStore = await loadStoreById(stores, product.storeId);
      assertActiveMembership({
        storeSlug: memberStore.slug,
        actorPublicId: input.actorPublicId,
        storeOwnerPublicId: memberStore.ownerPublicId,
        existing: await stores.staff.listStaff(memberStore.storeId),
      });
      const inventory = await stores.projection.findInventory(productId);
      const entry = applyInventoryAdjustment({
        quantityOnHand: inventory?.quantityOnHand ?? INVENTORY_INITIAL_QUANTITY,
        quantityDelta: input.quantityDelta,
        reasonCode: input.reasonCode,
        actorPublicId: input.actorPublicId,
        adjustmentSequence: (inventory?.lastAdjustmentSequence ?? INVENTORY_INITIAL_SEQUENCE) + 1,
        occurredAt: this.deps.clock.now(),
      });

      const adjustment = await stores.ledger.appendInventoryAdjustment(productId, entry);
      await probe?.("after-ledger");
      await stores.projection.applyInventoryProjection(productId, entry);
      await probe?.("after-projection");
      await stores.outbox.appendEvent(
        inventoryAdjustedEvent({
          adjustmentId: adjustment.adjustmentId,
          productId,
          storeId: product.storeId,
          quantityDelta: adjustment.quantityDelta,
          quantityAfter: adjustment.quantityAfter,
          reasonCode: adjustment.reasonCode,
          adjustmentSequence: adjustment.adjustmentSequence,
          actorPublicId: adjustment.actorPublicId,
          occurredFor: adjustment.occurredAt,
          occurredAt: this.deps.clock.now(),
        }),
      );
      await probe?.("after-outbox");

      return await rememberOutcome(stores.idempotency, envelope, {
        adjustment,
        storeId: product.storeId,
      });
    });
    return value;
  }

  /**
   * تدقيقُ مخزونٍ: يُعيد بناءَ الرصيدِ من الدفترِ ويقارنُه بالإسقاطِ — قراءةٌ لا إصلاح.
   *
   * ## ولمَ لا يُصلِح الانحرافَ تلقائيّاً؟
   *
   * لأنّ الإسقاطَ لا يمكن أن ينحرف ما دام كلُّ فرقٍ يُكتب في معاملةِ دفترِه نفسِها؛
   * فانحرافٌ موجودٌ يعني أنّ فرضاً أساسيّاً سقط (معاملةٌ كُسِرت، أو يدٌ كتبت في القاعدة)،
   * وإصلاحٌ صامتٌ يمحو الدليلَ على العطبِ ويجعل السببَ غيرَ قابلٍ للاستدلال. وقرارُ الإصلاحِ
   * ملكُ مالِكٍ لا ملكُ هذه المراجعة.
   *
   * ولا مسارَ HTTP لها في 5/6: عقدُ `contracts/api.openapi.yml` مجمدٌ عند خمسةَ عشرَ مساراً،
   * ومسارٌ سادسَ عشرَ قرارُ عقدٍ يلزمه ADR لا سطراً يُدسّ.
   */
  async auditInventory(productId: string): Promise<InventoryReconciliation> {
    return await this.deps.uow.read(async ({ stores }) => {
      await loadProductById(stores, productId);
      const ledger = await stores.ledger.listInventoryAdjustments(productId);
      const inventory = await stores.projection.findInventory(productId);
      return reconcileInventory({
        ledger,
        projectedQuantity: inventory?.quantityOnHand ?? INVENTORY_INITIAL_QUANTITY,
        projectedSequence: inventory?.lastAdjustmentSequence ?? INVENTORY_INITIAL_SEQUENCE,
      });
    });
  }

  /**
   * حجزُ كميّاتٍ لطلبٍ من خدمةِ التسليم — فروقٌ سالبةٌ بسبَب `reservation`.
   *
   * يُفحَص الرصيدُ قبل الكتابة: إن لم تكفِ الكميّةُ لأيِّ صنفٍ يُعاد `INVENTORY_INSUFFICIENT_QUANTITY`
   * (409) ولا يُكتبُ شيءٌ — لا فرقٌ جزئيٌّ يبقى في الدفترِ لطلبٍ لم يكتمل. وكلُّ فرقٍ يُكتب في
   * الدفترِ ويُسقَط ويُنشَر حدثُه في معاملةٍ واحدة.
   */
  async reserveInventory(
    storeSlug: string,
    request: ReservationRequest,
    envelope: IdempotencyEnvelope<ReservationOutcome>,
  ): Promise<ReservationOutcome> {
    const { value } = await this.deps.uow.write(async ({ stores, probe }) => {
      await replayGuard(stores.idempotency, envelope);

      const store = await loadStoreBySlug(stores, storeSlug);

      // اقرأ أرصدةَ كلِّ صنفٍ من الإسقاط — في معاملةِ الكتابةِ نفسِها فلا نافذةُ فرقَين متزامنَين.
      const inventoryMap = new Map<string, { readonly quantityOnHand: number; readonly lastAdjustmentSequence: number }>();
      for (const item of request.items) {
        const product = await loadProductById(stores, item.productId);
        if (product.storeId !== store.storeId) throw productNotFound(item.productId);
        const inventory = await stores.projection.findInventory(item.productId);
        inventoryMap.set(item.productId, {
          quantityOnHand: inventory?.quantityOnHand ?? INVENTORY_INITIAL_QUANTITY,
          lastAdjustmentSequence: inventory?.lastAdjustmentSequence ?? INVENTORY_INITIAL_SEQUENCE,
        });
      }

      // تحقّق من الكفاية قبل البناء: الحجزُ تعارضُ حالةٍ لا خطأُ إدخال (409 لا 422).
      for (const item of request.items) {
        const inv = inventoryMap.get(item.productId)!;
        if (inv.quantityOnHand < item.quantity) {
          throw inventoryReservationConflict(item.productId, inv.quantityOnHand);
        }
      }

      const entries = buildReservationAdjustments(
        request.items,
        inventoryMap,
        this.deps.clock.now(),
      );
      const writtenAdjustments = [] as Array<{
        readonly productId: string;
        readonly quantityDelta: number;
        readonly quantityAfter: number;
        readonly adjustmentSequence: number;
        readonly reasonCode: InventoryReasonCode;
      }>;
      for (let index = 0; index < request.items.length; index++) {
        const item = request.items[index]!;
        const entry = entries[index]!;
        const adjustment = await stores.ledger.appendInventoryAdjustment(item.productId, entry);
        await probe?.("after-ledger");
        await stores.projection.applyInventoryProjection(item.productId, entry);
        await probe?.("after-projection");
        await stores.outbox.appendEvent(
          inventoryAdjustedEvent({
            adjustmentId: adjustment.adjustmentId,
            productId: item.productId,
            storeId: store.storeId,
            quantityDelta: adjustment.quantityDelta,
            quantityAfter: adjustment.quantityAfter,
            reasonCode: adjustment.reasonCode,
            adjustmentSequence: adjustment.adjustmentSequence,
            actorPublicId: adjustment.actorPublicId,
            occurredFor: adjustment.occurredAt,
            occurredAt: this.deps.clock.now(),
          }),
        );
        await probe?.("after-outbox");
        writtenAdjustments.push({
          productId: item.productId,
          quantityDelta: adjustment.quantityDelta,
          quantityAfter: adjustment.quantityAfter,
          adjustmentSequence: adjustment.adjustmentSequence,
          reasonCode: adjustment.reasonCode,
        });
      }

      const outcome: ReservationOutcome = {
        orderPublicId: request.orderPublicId,
        storeId: store.storeId,
        results: toReservationResults(writtenAdjustments),
      };

      return await rememberOutcome(stores.idempotency, envelope, outcome);
    });
    return value;
  }

  /**
   * إفراجُ كميّاتٍ محجوزةٍ لطلبٍ من خدمةِ التسليم — فروقٌ موجبةٌ بسبَب `reservation_release`.
   *
   * ولا فحصَ للرصيدِ: الإفراجُ زيادةٌ لا سحب. وكلُّ فرقٍ يُكتب ويُسقَط ويُنشَر في معاملةٍ واحدة.
   */
  async releaseInventory(
    storeSlug: string,
    request: ReservationRequest,
    envelope: IdempotencyEnvelope<ReservationOutcome>,
  ): Promise<ReservationOutcome> {
    const { value } = await this.deps.uow.write(async ({ stores, probe }) => {
      await replayGuard(stores.idempotency, envelope);

      const store = await loadStoreBySlug(stores, storeSlug);

      // اقرأ أرصدةَ كلِّ صنفٍ من الإسقاط — في معاملةِ الكتابةِ نفسِها.
      const inventoryMap = new Map<string, { readonly quantityOnHand: number; readonly lastAdjustmentSequence: number }>();
      for (const item of request.items) {
        const product = await loadProductById(stores, item.productId);
        if (product.storeId !== store.storeId) throw productNotFound(item.productId);
        const inventory = await stores.projection.findInventory(item.productId);
        inventoryMap.set(item.productId, {
          quantityOnHand: inventory?.quantityOnHand ?? INVENTORY_INITIAL_QUANTITY,
          lastAdjustmentSequence: inventory?.lastAdjustmentSequence ?? INVENTORY_INITIAL_SEQUENCE,
        });
      }

      const entries = buildReleaseAdjustments(
        request.items,
        inventoryMap,
        this.deps.clock.now(),
      );

      const writtenAdjustments = [] as Array<{
        readonly productId: string;
        readonly quantityDelta: number;
        readonly quantityAfter: number;
        readonly adjustmentSequence: number;
        readonly reasonCode: InventoryReasonCode;
      }>;
      for (let index = 0; index < request.items.length; index++) {
        const item = request.items[index]!;
        const entry = entries[index]!;
        const adjustment = await stores.ledger.appendInventoryAdjustment(item.productId, entry);
        await probe?.("after-ledger");
        await stores.projection.applyInventoryProjection(item.productId, entry);
        await probe?.("after-projection");
        await stores.outbox.appendEvent(
          inventoryAdjustedEvent({
            adjustmentId: adjustment.adjustmentId,
            productId: item.productId,
            storeId: store.storeId,
            quantityDelta: adjustment.quantityDelta,
            quantityAfter: adjustment.quantityAfter,
            reasonCode: adjustment.reasonCode,
            adjustmentSequence: adjustment.adjustmentSequence,
            actorPublicId: adjustment.actorPublicId,
            occurredFor: adjustment.occurredAt,
            occurredAt: this.deps.clock.now(),
          }),
        );
        await probe?.("after-outbox");
        writtenAdjustments.push({
          productId: item.productId,
          quantityDelta: adjustment.quantityDelta,
          quantityAfter: adjustment.quantityAfter,
          adjustmentSequence: adjustment.adjustmentSequence,
          reasonCode: adjustment.reasonCode,
        });
      }

      const outcome: ReservationOutcome = {
        orderPublicId: request.orderPublicId,
        storeId: store.storeId,
        results: toReservationResults(writtenAdjustments),
      };

      return await rememberOutcome(stores.idempotency, envelope, outcome);
    });
    return value;
  }
}

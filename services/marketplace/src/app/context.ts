/**
 * ما تشترك فيه خدماتُ التطبيق: وحدةُ العمل، الساعةُ، مفاتيحُ المسارات، وقراءاتُ التحميل.
 *
 * ## لماذا `uow` لا `db`
 *
 * الخدمةُ لا ترى `db` ولا تفتح معاملةً بنفسها: `MarketplaceUnitOfWork.write` هي الموضعُ
 * الوحيدُ الذي يفتح معاملةً ويُعيد المحاولةَ عند سباقِ تسلسل (`MAX_DECISION_ATTEMPTS`).
 * ومسارٌ يفتح معاملتَه كان سيُعيد بناءَ الإعادةِ خطأً، أو يُدخل حرسَ منعِ التكرارِ في معاملةٍ
 * غيرِ التي تكتب — فيبقى مفتاحٌ محفوظاً لعملٍ تراجع.
 *
 * ## لماذا مفاتيحُ المساراتِ ثوابتُ مُعلَنة
 *
 * `route_key` جزءٌ من المفتاحِ الأوّليِّ لجدولِ منعِ التكرار. ونصٌّ حرفيٌّ يُكتب في كلّ مسارٍ
 * كان سيجعل خطأً مطبعيّاً واحداً (`store.regsiter`) يُنشئ فضاءَ مفاتيحَ ثانياً صامتاً — فتمرّ
 * كتابةٌ مكرّرةٌ بلا حرس. والشكلُ `<aggregate>.<action>` لا `POST /stores`: المسارُ في العقدِ
 * قد يتغيّر، والعمليّةُ لا.
 */

import type { MarketplaceStores, MarketplaceUnitOfWork } from "../db/index.js";
import type { ProductRecord, StoreRecord } from "../db/rows.js";
import { productNotFound, storeCategoryNotFound, storeNotFound } from "../domain/errors.js";
import type { Clock } from "../domain/time.js";

/** حاجاتُ كلّ خدمةٍ في هذه الطبقة — محقونةٌ لا مبنيّةٌ داخلَها. */
export interface MarketplaceServiceDeps {
  readonly uow: MarketplaceUnitOfWork;
  readonly clock: Clock;
}

/**
 * مفاتيحُ المساراتِ للكتابةِ وحدَها.
 *
 * القراءةُ لا تحتاج مفتاحاً: `GET` لا يُغيّر شيئاً، وحفظُ جوابِها كان سيجعل قراءةً ثانيةً
 * تُعيد لقطةً قديمةً بعد قرارٍ وقع بينهما.
 */
export const MARKETPLACE_ROUTE_KEYS = Object.freeze({
  storeRegister: "store.register",
  storeReviewRequest: "store.review_request",
  storeDecide: "store.decide",
  storeStaffAdd: "store.staff_add",
  storeStaffRemove: "store.staff_remove",
  productCreate: "product.create",
  productPublish: "product.publish",
  productArchive: "product.archive",
  productDecide: "product.decide",
  inventoryAdjust: "inventory.adjust",
} as const);

/** يُحمِّل متجراً بلاحقته أو يرفع `STORE_NOT_FOUND` — لا `undefined` يسري في الطبقة. */
export async function loadStoreBySlug(
  stores: MarketplaceStores,
  storeSlug: string,
): Promise<StoreRecord> {
  const store = await stores.resources.findStoreBySlug(storeSlug);
  if (store === undefined) throw storeNotFound(storeSlug);
  return store;
}

/** ومنتجاً بمُعرِّفه كذلك. */
export async function loadProductById(
  stores: MarketplaceStores,
  productId: string,
): Promise<ProductRecord> {
  const product = await stores.resources.findProductById(productId);
  if (product === undefined) throw productNotFound(productId);
  return product;
}

/**
 * يُحمِّل تصنيفاً بلاحقته مع حقائقِه — والحقائقُ لا اللقطةُ كلُّها.
 *
 * `assertStoreCategory` و`assertProductCategory` يقرآن ثلاثةَ حقولٍ فقط (`slug` · `depth` ·
 * `isActive`)، وتمريرُ الصفِّ كلِّه كان سيُغري مسارَ قرارٍ لاحقاً بقراءةِ حقلٍ رابعٍ منه فيصير
 * القرارُ معتمداً على عمودٍ لم يُعلَن في العقد.
 */
export async function loadCategoryFacts(
  stores: MarketplaceStores,
  categorySlug: string,
): Promise<{ readonly categoryId: string; readonly slug: string; readonly depth: number; readonly isActive: boolean }> {
  const category = await stores.categories.findBySlug(categorySlug);
  if (category === undefined) throw storeCategoryNotFound(categorySlug);
  return {
    categoryId: category.categoryId,
    slug: category.slug,
    depth: category.depth,
    isActive: category.isActive,
  };
}

/**
 * لاحقةُ تصنيفٍ بمُعرِّفه — قراءةٌ واحدةٌ تُضاف لحمولةِ الحدثِ لا لقرارٍ.
 *
 * ولمَ تُقرأ ولا تُحمَل من الصفِّ؟ لأنّ `stores.category_id` و`products.category_id`
 * مُعرِّفاتٌ داخليّةٌ، وعقدُ الأحداثِ يحمل `category_slug` وحدَه: مُستهلكٌ خارجَ الخدمةِ لا يعرف
 * جدولَ التصنيفاتِ ولا يجب أن يستعلمه. ولاحقةٌ تُنسخ في المتجرِ أو المنتجِ كانت ستصير عموداً
 * راكداً يخالف التصنيفَ يومَ تُعاد تسميةُ لاحقته.
 *
 * ويُرفع `STORE_CATEGORY_NOT_FOUND` عند الغياب: مفتاحٌ أجنبيٌّ في العقدِ يجعله مستحيلاً، فبلوغُه
 * يعني عطباً في القاعدةِ يجب أن يظهر لا حدثاً بلاحقةٍ فارغة.
 */
export async function loadCategorySlugById(
  stores: MarketplaceStores,
  categoryId: string,
): Promise<string> {
  const category = await stores.categories.findById(categoryId);
  if (category === undefined) throw storeCategoryNotFound(categoryId);
  return category.slug;
}

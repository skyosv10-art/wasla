/**
 * قراءةُ شجرةِ التصنيفاتِ وحالةُ الخدمة — قراءتان لا تكتبان شيئاً.
 *
 * ## لا مسارَ يُنشئ تصنيفاً، وهذا قرارٌ
 *
 * الشجرةُ بيانُ منصّةٍ لا بيانُ مُتَّصل: `POST /categories` كان سيجعل كلَّ تاجرٍ يخترع تصنيفاً
 * فتصير الشجرةُ حقلاً حرّاً، وينهار كلُّ ما يُبنى عليها (الظهورُ · التصفّحُ · حدُّ الورقة).
 * والزراعةُ تنزل في المراجعة 5/6 مُدخَلاً مُدارَاً، و`insertCategory` موجودٌ في المخزنِ لها.
 *
 * ## ولماذا `active_only` يُرشَّح هنا لا في المخزن
 *
 * الشجرةُ عشراتٌ من الصفوفِ لا آلافٌ، وقراءتُها كاملةً ثمّ ترشيحُها في الذاكرةِ أرخصُ من
 * استعلامَين وأصدقُ في اللقطة: مُرشِّحٌ في `WHERE` كان سيُخفي أباً مُعطَّلاً وله أبناءُ نشطون،
 * فتُقرأ شجرةٌ مقطوعةٌ لا يُفهم عمقُها.
 */

import type { MarketplaceServiceDeps } from "./context.js";
import type { CategoryRecord } from "../db/rows.js";

/** حالةُ الخدمةِ كما يُعلِنها العقد — بلا `last_tick_at`: لا تِكّةَ في هذا الحدّ (القرار 2). */
export interface MarketplaceHealth {
  readonly status: "ok" | "degraded" | "unavailable";
  readonly mode: "postgres" | "memory";
}

export class MarketplaceCatalogService {
  constructor(private readonly deps: MarketplaceServiceDeps) {}

  async listCategories(activeOnly = false): Promise<ReadonlyArray<CategoryRecord>> {
    const categories = await this.deps.uow.read(
      async ({ stores }) => await stores.categories.listCategories(),
    );
    return activeOnly ? categories.filter((category) => category.isActive) : categories;
  }

  /**
   * فهرسُ «مُعرِّفُ تصنيفٍ ← لاحقتُه» — لأنّ الصفوفَ تحمل المُعرِّفَ والعقدُ يُعلن اللاحقة.
   *
   * ولمَ فهرسٌ يُقرأ مرّةً لا انضمامٌ في كلّ استعلام؟ لأنّ الشجرةَ عشراتُ صفوفٍ ثابتةٍ عمليّاً،
   * فقراءتُها مرّةً وإسنادُها في الذاكرةِ أقلُّ كلفةً من انضمامٍ يُكرَّر في ستّةِ استعلامات.
   * والمُعرِّفُ لا يعبر الحدَّ أبداً: العقدُ يُعلن `category_slug` وحدَه (القرار 10)، فمُعرِّفٌ
   * داخليٌّ يُسرَّب في جوابٍ يصير عقداً ضمنيّاً يبنى عليه ثمّ يستحيل تغييرُه.
   */
  async categorySlugIndex(): Promise<ReadonlyMap<string, string>> {
    const categories = await this.deps.uow.read(
      async ({ stores }) => await stores.categories.listCategories(),
    );
    return new Map(categories.map((category) => [category.categoryId, category.slug]));
  }

  /**
   * حالةُ الخدمةِ بقراءةٍ حقيقيّةٍ لا بعلمٍ بأنّ الإعدادَ موجود.
   *
   * `ok` تعني أنّ القاعدةَ أجابت الآن. وخدمةٌ تقول `ok` لأنّ `DATABASE_URL` مضبوطٌ تُخدع أوّلَ
   * مرّةٍ تسقط القاعدةُ وحدَها — وهي اللحظةُ التي يُفترَض أن يكشفها هذا المسار.
   */
  async health(): Promise<MarketplaceHealth> {
    try {
      await this.deps.uow.read(async ({ stores }) => await stores.categories.listCategories());
      return { status: "ok", mode: "postgres" };
    } catch {
      return { status: "degraded", mode: "postgres" };
    }
  }
}

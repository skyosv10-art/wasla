/**
 * حدّ المعاملة بين واجهة HTTP ومحولات المطابقة.
 *
 * يبقى قرار فتح معاملة خارج المعالجات لأن نسيانها في كتابة واحدة يفصل صف الترشيح
 * أو مفتاح منع التكرار عن حدثه؛ أما القراءة فلا تحتاج احتجاز اتصال Postgres طوال
 * بناء الرد. لذا تحصل الواجهة على Runner لا على الاعتمادات الخام.
 */

import type { MatchingDependencies } from "./ports.js";
import {
  PostgresMatchingUnitOfWork,
  type MatchingSharedDeps,
} from "./infrastructure/drizzle/transaction.js";

/** عمل حالة استخدام على مجموعة الاعتمادات المناسبة للمعاملة. */
export type MatchingWork<T> = (deps: MatchingDependencies) => Promise<T>;

/** ينفذ الكتابة كوحدة واحدة والقراءة بلا معاملة. */
export interface MatchingRunner {
  write<T>(work: MatchingWork<T>): Promise<T>;
  read<T>(work: MatchingWork<T>): Promise<T>;
}

/**
 * Runner الذاكرة المباشر.
 *
 * لا تملك الذاكرة معاملة لتفتحها، لكن إبقاء السطح مطابقاً للإنتاج يمنع اختلاف
 * سلوك المسارات بين الاختبارات والتشغيل الحقيقي.
 */
export function createDirectRunner(deps: MatchingDependencies): MatchingRunner {
  return {
    async write<T>(work: MatchingWork<T>): Promise<T> {
      return work(deps);
    },
    async read<T>(work: MatchingWork<T>): Promise<T> {
      return work(deps);
    },
  };
}

/**
 * Runner Postgres فوق وحدة العمل القائمة.
 *
 * تمرير الاعتمادات المشتركة هنا يضمن أن المحولات المقيدة بالمعاملة وحدها تتبدل
 * لكل كتابة، بينما تظل الجغرافيا والساعة ومولد المعرفات مشتركة كما صُممت.
 */
export class PostgresMatchingRunner implements MatchingRunner {
  constructor(
    private readonly unitOfWork: PostgresMatchingUnitOfWork,
    private readonly shared: MatchingSharedDeps,
  ) {}

  async write<T>(work: MatchingWork<T>): Promise<T> {
    return this.unitOfWork.run(this.shared, ({ deps }) => work(deps));
  }

  async read<T>(work: MatchingWork<T>): Promise<T> {
    return this.unitOfWork.read(this.shared, work);
  }
}

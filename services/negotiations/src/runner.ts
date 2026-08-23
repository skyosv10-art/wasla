/**
 * المفصل التركيبي بين المحوّل وحالة الاستخدام (Phase 08 · MR 4/6).
 *
 * The composition seam between an adapter and a use case.
 *
 * كل حالة استخدام في `src/use-cases/` تأخذ `NegotiationDependencies` أول وسيطٍ لها ولا
 * تعرف شيئاً غير ذلك. في الذاكرة يكفي كائنٌ واحد يُسلَّم للجميع؛ على Postgres لا يكفي، لأن
 * مجموعة التبعيات يجب أن تُبنى من جديد حول مقبض معاملة في كل عملية
 * (`infrastructure/drizzle/transaction.ts`).
 *
 * `NegotiationRunner` هو الواجهة التي تُخفي هذا الفرق في سطر واحد:
 *
 *     const result = await runner.write((deps) => proposeRound(deps, threadId, input, options));
 *
 * النداء نفسه يعمل على البيئة الذاكرية (`createDirectNegotiationRunner`) وعلى Postgres
 * (`PostgresNegotiationRunner`).
 *
 * ## لماذا هذا الملف هنا لا داخل `src/use-cases/`
 *
 * المعيار المُلزم لهذه المرحلة أن **لا ملف تحت `src/use-cases/` ولا تحت `src/domain/`
 * يتغيّر** كي تعمل طبقة HTTP. مُساعدٌ يُركّب المعاملات شأنٌ بنيوي (infrastructure)، ولو
 * سكن بين حالات الاستخدام لصار المجال على بعد `import` واحد من معرفة أنّ المعاملة موجودة.
 *
 * والنتيجة العمليّة الأهم: طبقة HTTP (`http/app.ts`) تستقبل `NegotiationRunner` **ولا
 * شيء غيره** — لا `Db`، ولا `Pool`، ولا مستودعاً. لذلك **لا معالج مسارٍ يستطيع أن يفتح
 * معاملة أو يلمس جدولاً**: الخطأ غير متاح بدل أن يكون مكروهاً فقط. البديل الذي يمرّر `db`
 * إلى الطبقة يبدو أقصر، ثم يُنتج أول معالجٍ يقرأ صفّاً خارج معاملة الكتابة فيرى نصف قرار.
 */

import type { Db } from "./infrastructure/drizzle/db.js";
import type { NegotiationSharedDeps } from "./infrastructure/drizzle/transaction.js";
import { PostgresNegotiationUnitOfWork } from "./infrastructure/drizzle/transaction.js";
import type { NegotiationDependencies } from "./ports.js";

/** وحدة عملٍ تطبيقيّة مُعبَّر عنها بالمنافذ وحدها. */
export type NegotiationWork<T> = (deps: NegotiationDependencies) => Promise<T>;

export interface NegotiationRunner {
  /** يُشغّل عملاً يكتب — ذرّياً حين يدعم المحوّل ذلك. */
  write<T>(work: NegotiationWork<T>): Promise<T>;
  /** يُشغّل عملاً يقرأ فقط. لا معاملة تُفتَح. */
  read<T>(work: NegotiationWork<T>): Promise<T>;
}

/**
 * مُشغّل على مجموعة تبعيات واحدة ثابتة — البيئة الذاكرية أو أي بديل اختبار.
 *
 * `write` و`read` نداءٌ واحد هنا، وذاك صدقٌ لا تهاون: المخازن الذاكرية لا معاملة لها
 * تُفتح، والتظاهر بغير ذلك يُخفي بعينه الفرق الذي وُجدت مجموعة اختبارات التكافؤ لقياسه.
 */
export function createDirectNegotiationRunner(deps: NegotiationDependencies): NegotiationRunner {
  return {
    async write<T>(work: NegotiationWork<T>): Promise<T> {
      return work(deps);
    },
    async read<T>(work: NegotiationWork<T>): Promise<T> {
      return work(deps);
    },
  };
}

/** مُشغّل يفتح معاملة Postgres واحدة لكل كتابة. */
export class PostgresNegotiationRunner implements NegotiationRunner {
  private readonly unitOfWork: PostgresNegotiationUnitOfWork;

  constructor(
    db: Db,
    private readonly shared: NegotiationSharedDeps,
  ) {
    this.unitOfWork = new PostgresNegotiationUnitOfWork(db);
  }

  async write<T>(work: NegotiationWork<T>): Promise<T> {
    return this.unitOfWork.run(this.shared, async ({ deps }) => work(deps));
  }

  async read<T>(work: NegotiationWork<T>): Promise<T> {
    return this.unitOfWork.read(this.shared, async ({ deps }) => work(deps));
  }
}

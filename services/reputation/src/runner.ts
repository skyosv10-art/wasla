/**
 * المفصلُ التركيبيّ بين المُهيئ وحالة الاستخدام (الطور 09 · المراجعة 3/6).
 *
 * كلُّ حالةِ استخدامٍ في `src/use-cases/` تأخذ `ReputationDependencies` أوّلَ وسيطٍ لها
 * ولا تعرف شيئاً غير ذلك. في الذاكرة يكفي كائنٌ واحد يُسلَّم للجميع؛ على Postgres لا
 * يكفي، لأنّ مجموعةَ التبعيات يجب أن تُبنى من جديدٍ حول مقبض معاملةٍ في كل عملية
 * (`infrastructure/drizzle/transaction.ts`).
 *
 * و`ReputationRunner` هو الواجهةُ التي تُخفي هذا الفرق في سطرٍ واحد:
 *
 *     const result = await runner.write((deps) => recordFact(deps, input));
 *
 * نفسُ النداء يعمل على الذاكرة (`createDirectReputationRunner`) وعلى Postgres
 * (`PostgresReputationRunner`) — وهو بعينه ما يجعل حزمةَ المطابقة في
 * `__tests__/port-conformance.integration.test.ts` **نفسَ** السيناريوهات لا نسختين.
 *
 * ## لماذا هذا الملفُّ هنا لا داخل `use-cases/`
 *
 * المعيارُ المُلزِم للطور أن **لا ملفَّ تحت `src/use-cases/` ولا `src/domain/` يعرف أنّ
 * معاملةً موجودة**. ومُساعدٌ يُركّب المعاملات شأنٌ بنيويّ، ولو سكن بين حالات الاستخدام
 * لصار المجالُ على بعد `import` واحدٍ من معرفة القاعدة.
 *
 * والنتيجةُ العمليّة الأهمّ تظهر في المراجعة 4/6: طبقةُ HTTP تستقبل `ReputationRunner`
 * **ولا شيءَ غيره** — لا `Db` ولا `Pool` ولا مستودعاً. فلا معالجَ مسارٍ يستطيع أن يفتح
 * معاملةً أو يلمس جدولاً: الخطأُ غيرُ متاحٍ بدل أن يكون مكروهاً فقط.
 */

import type { Db } from "./infrastructure/drizzle/db.js";
import type { ReputationSharedDeps } from "./infrastructure/drizzle/transaction.js";
import { PostgresReputationUnitOfWork } from "./infrastructure/drizzle/transaction.js";
import type { ReputationDependencies } from "./ports.js";

/** وحدةُ عملٍ تطبيقيّة مُعبَّرٌ عنها بالمنافذ وحدها. */
export type ReputationWork<T> = (deps: ReputationDependencies) => Promise<T>;

export interface ReputationRunner {
  /** يُشغّل عملاً يكتب — ذرّياً حين يدعم المُهيئ ذلك. */
  write<T>(work: ReputationWork<T>): Promise<T>;
  /** يُشغّل عملاً يقرأ فقط. لا معاملةَ تُفتَح. */
  read<T>(work: ReputationWork<T>): Promise<T>;
}

/**
 * مُشغّلٌ على مجموعةِ تبعيّاتٍ واحدةٍ ثابتة — الذاكرةُ أو أيُّ بديلِ اختبار.
 *
 * `write` و`read` نداءٌ واحدٌ هنا، وذاك صدقٌ لا تهاون: مخازنُ الذاكرة لا معاملةَ لها
 * تُفتَح، والتظاهرُ بغير ذلك يُخفي بعينه الفرقَ الذي وُجدت حزمةُ المطابقة لقياسه.
 */
export function createDirectReputationRunner(deps: ReputationDependencies): ReputationRunner {
  return {
    async write<T>(work: ReputationWork<T>): Promise<T> {
      return work(deps);
    },
    async read<T>(work: ReputationWork<T>): Promise<T> {
      return work(deps);
    },
  };
}

/** مُشغّلٌ يفتح معاملة Postgres واحدةً لكل كتابة. */
export class PostgresReputationRunner implements ReputationRunner {
  private readonly unitOfWork: PostgresReputationUnitOfWork;

  constructor(
    db: Db,
    private readonly shared: ReputationSharedDeps,
  ) {
    this.unitOfWork = new PostgresReputationUnitOfWork(db);
  }

  async write<T>(work: ReputationWork<T>): Promise<T> {
    return this.unitOfWork.run(this.shared, async ({ deps }) => work(deps));
  }

  async read<T>(work: ReputationWork<T>): Promise<T> {
    return this.unitOfWork.read(this.shared, async ({ deps }) => work(deps));
  }
}

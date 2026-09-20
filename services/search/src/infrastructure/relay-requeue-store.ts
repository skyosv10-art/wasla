/**
 * PostgresSearchRequeueStore — إعادةُ صفٍّ مسمومٍ إلى طابورِ البحثِ في **معاملةٍ
 * واحدةٍ** (فجوةُ `G5` · موجةُ اليدِ · ADR-026 §4.24 · `CLM-0248`).
 *
 * ## حركتانِ أو لا شيءَ
 *
 * رفعُ نهائيّةِ الصفِّ (`poisoned` → `pending`) وإرجاعُ نقطةِ تقدُّمِ المُستهلِكِ
 * يقعانِ في معاملةٍ واحدةٍ على اتّصالٍ واحدٍ. والسببُ مقيسٌ لا ذوقٌ: لو رُفِعَ
 * الصفُّ وحدَهُ لسقطَ من **مقياسِ موجةِ العينِ** (لأنَّهُ لم يعُدْ `poisoned`)
 * ولم يُقرأْ أبداً (لأنَّ النقطةَ تجاوزَتْهُ) — فيصيرُ الفقدُ **أخفى ممّا كانَ**.
 * ولو أُرجِعَت النقطةُ وحدَها لَمُسِحَ التاريخُ كلُّهُ بلا فائدةٍ، لأنَّ الصفَّ
 * النهائيَّ يُقصَّرُ في الخطوةِ 1 من `relay.ts`.
 *
 * ## و`FOR UPDATE` على صفِّ الدفترِ
 *
 * يُقفَلُ كي لا يقرأَ حالتَهُ نداءانِ متزامنانِ فيرفعاهُ مرّتَينِ ويُجيبَ كلاهُما
 * `requeued` على عملٍ وقعَ مرّةً. ولا قفلَ تشغيليّاً (`pg_advisory_xact_lock`)
 * هنا خلافاً لمُرحِّلِ التوصيلِ: مُرحِّلُ البحثِ **لا يملكُ قفلَ جلسةٍ أصلاً**
 * (لا `relay-advisory-lock` في هذهِ الخدمةِ)، واختراعُ مفتاحٍ هنا كانَ سيُنتِجُ
 * قفلاً **ديكوراً** لا يحوزُهُ الطرفُ الآخرُ — يُطمئنُ ولا يمنعُ، وهوَ أخفُّ من
 * لا قفلٍ أصلاً لأنَّهُ يُوهِمُ الحمايةَ. فما يُحمى يُحمى بقفلِ صفٍّ حقيقيٍّ،
 * والتزامُنُ معَ دورةِ مُرحِّلٍ جاريةٍ حدٌّ **مُعلَنٌ** في §10.6 من الجردِ لا
 * مُدَّعىً مُغلَقاً.
 *
 * ## والإرجاعُ **بحذفِ صفِّ النقطةِ** لا بكتابةِ صفرٍ
 *
 * `getCheckpoint` يُعيدُ `null` حينَ لا صفَّ، و`readAfter(null)` يقرأُ من أوّلِ
 * الصندوقِ الصادرِ (`ZERO_CHECKPOINT` داخلَ `marketplace-event-source.ts`). فحذفُ
 * الصفِّ هوَ **نفسُهُ** الإرجاعُ إلى الصفرِ، وبمصدرِ حقيقةٍ واحدٍ: كتابةُ صفرٍ
 * هنا كانت ستُكرِّرَ ثابتَ الصفرِ في موضعٍ ثانٍ (`00000000-…` و`epoch`) فينحرفَ
 * أحدُهُما عن الآخرِ بلا أن يُسقِطَ اختباراً.
 *
 * والثمنُ **مُعلَنٌ لا مخفيٌّ**: مسحٌ من أوّلِ الصندوقِ الصادرِ على دفعاتٍ حتّى
 * تعودَ النقطةُ إلى ما كانت. وهوَ قراءةٌ لا كتابةٌ — التماثُليّةُ تجعلُ كلَّ صفٍّ
 * نهائيٍّ لا عملاً (`relay.ts` الخطوةُ 1) — ويقعُ في فعلِ مُشغِّلٍ نادرٍ لا في
 * مسارٍ ساخنٍ. **ومكتوبٌ في الجوابِ نفسِهِ** (`rewind_cost`) كي لا يُفاجَأَ بهِ
 * مَن يقرأُ رسماً بيانيّاً ثمَّ يُصعِّدُ حادثةً لأنَّ الصفَّ لم يُطبَّقْ في ثانيةٍ.
 */

import type { Pool, PoolClient } from "pg";
import type { SearchRelayRequeuePort } from "../ports.js";
import {
  SEARCH_DEAD_LETTER_LEDGERS,
  SEARCH_POISONED_STATUS,
  type SearchDeadLetterLedger,
} from "../domain/relay-dead-letters.js";
import {
  SEARCH_REQUEUE_TARGET_STATUS,
  decideSearchRequeue,
  type SearchRequeueDecision,
} from "../domain/relay-requeue.js";
import { DEFAULT_RELAY_CONFIG } from "../relay.js";

/* ════════════════════════════════════════════════════════════════════════
 * الربطُ بينَ الدفترِ وجدولَيهِ — **ثوابتُ حرفيّةٌ، وموضعٌ واحدٌ**
 *
 * أسماءُ الجداولِ تُركَّبُ في نصِّ الاستعلامِ (لا تُمرَّرُ مُعامِلاً في
 * Postgres)، وأمانُ ذلكَ ليسَ في التهذيبِ بل في أنَّ **لا مُدخَلَ يصلُ النصَّ**:
 * المفتاحُ نوعُهُ `SearchDeadLetterLedger` لا `string`، والحدُّ HTTP يرفضُ ما
 * سِواهُ قبلَ الوصولِ. و`Record<SearchDeadLetterLedger, …>` يجعلُ دفتراً يُضافُ
 * إلى القائمةِ المُصرَّحةِ **بلا جدولٍ هنا** خطأَ ترجمةٍ لا نقصاً صامتاً.
 * ════════════════════════════════════════════════════════════════════════ */

interface LedgerTables {
  /** دفترُ الأحكامِ الذي فيهِ الصفُّ المسمومُ. */
  readonly consumed: string;
  /** جدولُ نقطةِ التقدُّمِ الذي يُرجَعُ معَهُ. */
  readonly checkpoint: string;
  /** مُعرِّفُ المُستهلِكِ — من ضبطِ المُرحِّلِ نفسِهِ لا نسخةً ثانيةً منهُ. */
  readonly consumerId: string;
}

const LEDGER_TABLES: Record<SearchDeadLetterLedger, LedgerTables> = {
  marketplace: {
    consumed: "search_relay_consumed_events",
    checkpoint: "search_relay_checkpoint",
    consumerId: DEFAULT_RELAY_CONFIG.consumerId,
  },
};

/**
 * ما يُنشَرُ للمُنادي فوقَ القرارِ: **هل حُذِفَ صفُّ النقطةِ فعلاً**. ومُشغِّلٌ
 * يقرأُ `requeued` ولا يعرِفُ أنَّ مسحاً من الصفرِ بدأَ يظنُّ الإعادةَ فوريّةً.
 */
export interface SearchRequeueEffect {
  readonly decision: SearchRequeueDecision;
  readonly consumerId: string;
  /**
   * `true` حينَ كانَ للمُستهلِكِ صفُّ نقطةٍ فحُذِفَ؛ و`false` حينَ لا صفَّ لهُ
   * أصلاً (مُرحِّلٌ لم يُشغَّلْ قطُّ أو أُرجِعَ قبلَ قليلٍ) — وهيَ حالةٌ
   * **مقروءةٌ لا مستحيلةٌ**، والقراءةُ من الصفرِ قائمةٌ فيها أصلاً.
   */
  readonly checkpointRowDeleted: boolean;
}

/**
 * حرسُ انحرافٍ: كلُّ دفترٍ مُصرَّحٍ لهُ مدخلٌ هنا. ويُنادى في البانيةِ كي يقعَ
 * الانفجارُ عندَ التركيبِ لا عندَ أوّلِ حادثةٍ.
 */
function assertEveryLedgerMapped(): void {
  for (const ledger of SEARCH_DEAD_LETTER_LEDGERS) {
    if (LEDGER_TABLES[ledger] === undefined) {
      throw new Error(`دفترٌ مُصرَّحٌ بلا جدولٍ في مُحوِّلِ الإعادةِ: ${ledger}`);
    }
  }
}

export class PostgresSearchRequeueStore implements SearchRelayRequeuePort {
  constructor(private readonly pool: Pool) {
    assertEveryLedgerMapped();
  }

  async requeuePoisonedEvent(cmd: {
    readonly ledger: SearchDeadLetterLedger;
    readonly outboxId: string;
  }): Promise<SearchRequeueDecision> {
    return (await this.requeuePoisonedEventWithEffect(cmd)).decision;
  }

  /**
   * النسخةُ التي يستعملُها الحدُّ HTTP: القرارُ **معَ** أثرِهِ. والفصلُ مقصودٌ:
   * المنفذُ في `ports.ts` يعِدُ بالقرارِ وحدَهُ كي لا يُقيَّدَ كلُّ مُنفِّذٍ
   * بنشرِ تفصيلِ نقطةِ تقدُّمٍ قد لا يملكُهُ.
   */
  async requeuePoisonedEventWithEffect(cmd: {
    readonly ledger: SearchDeadLetterLedger;
    readonly outboxId: string;
  }): Promise<SearchRequeueEffect> {
    const tables = LEDGER_TABLES[cmd.ledger];
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const found = await client.query<{ status: string }>(
        `SELECT status FROM ${tables.consumed} WHERE outbox_id = $1::uuid FOR UPDATE`,
        [cmd.outboxId],
      );
      const observed = found.rowCount === 0 ? null : found.rows[0]!.status;
      const decision = decideSearchRequeue(observed);

      if (decision.outcome === "rejected") {
        /*
         * `ROLLBACK` لا `COMMIT`: لم يُكتَبْ شيءٌ، والإقفالُ يُرفَعُ. و`COMMIT`
         * على معاملةٍ فارغةٍ كانَ يعملُ أيضاً — لكنَّ `ROLLBACK` يقولُ للقارئِ
         * إنَّ **لا أثرَ** مقصودٌ، ولا يُغري بإضافةِ كتابةٍ قبلَهُ لاحقاً.
         */
        await client.query("ROLLBACK");
        return { decision, consumerId: tables.consumerId, checkpointRowDeleted: false };
      }

      /*
       * الحركةُ الأولى — **رفعُ النهائيّةِ وحدَها**.
       *
       * ولا `attempt_count = 0` ولا `last_error = NULL`: هُما الدليلُ الوحيدُ
       * على لِمَ سُمَّ الصفُّ، والدفترُ لا يحفظُ تاريخاً (التعليلُ كاملاً في
       * `domain/relay-requeue.ts`). ولا `consumed_at = now()` أيضاً: هوَ طابعُ
       * **أوّلِ** استهلاكٍ، وهوَ عينُ ما تقيسُ بهِ موجةُ العينِ عمرَ الفقدِ —
       * فتحديثُهُ هنا كانَ **يُصفِّرُ عمرَ فقدٍ قائمٍ** عندَ كلِّ محاولةِ إنقاذٍ،
       * فيُخرِجُ صفّاً معطوباً منذُ أسبوعٍ من عتبةِ العمرِ الحرجةِ بلا أن يُعالَجَ.
       *
       * والشرطُ `status = $3` مُكرَّرٌ فوقَ القرارِ عمداً: حزامٌ ثانٍ لو تسرَّبَ
       * نداءٌ لا يمرُّ بالقرارِ. والقرارُ يبقى مصدرَ **الجوابِ** كي يُفرَّقَ «لا
       * صفَّ» من «صفٌّ ليسَ مسموماً» — وهوَ ما لا يستطيعُهُ عددُ الصفوفِ
       * المُعدَّلةِ وحدَهُ.
       */
      const updated = await client.query(
        `UPDATE ${tables.consumed}
            SET status = $2
          WHERE outbox_id = $1::uuid AND status = $3`,
        [cmd.outboxId, SEARCH_REQUEUE_TARGET_STATUS, SEARCH_POISONED_STATUS],
      );
      if (updated.rowCount !== 1) {
        /*
         * لا يقعُ ما دامَ الإقفالُ قائماً؛ ووجودُهُ لأنَّ صمتاً هنا كانَ سيعني
         * جواباً `requeued` على صفٍّ لم يتغيَّرْ — وهوَ **كذبٌ في الجوابِ**.
         */
        throw new Error(
          `إعادةٌ لم تُصِبْ صفّاً واحداً (${updated.rowCount}) رغمَ إقفالٍ — عطبُ تماسُكٍ لا يُبتلَعُ`,
        );
      }

      /*
       * الحركةُ الثانيةُ — إرجاعُ النقطةِ بحذفِ صفِّها.
       *
       * و`DELETE` هنا **ليسَ** محوَ دليلٍ: نقطةُ التقدُّمِ مؤشِّرُ موضعٍ لا
       * سجلُّ حدثٍ، وغيابُها معناهُ المُعرَّفُ في `readAfter` «اقرأْ من الأوّلِ».
       * والدليلُ على أنَّ إعادةً وقعَت يُكتَبُ حيثُ يُقرأُ: في سجلِّ التنفيذِ
       * وفي جوابِ النداءِ، لا في مؤشِّرٍ يُكتَبُ فوقَهُ المُرحِّلُ بعدَ دورةٍ.
       */
      const rewound = await client.query(
        `DELETE FROM ${tables.checkpoint} WHERE consumer_id = $1`,
        [tables.consumerId],
      );

      await client.query("COMMIT");

      return {
        decision,
        consumerId: tables.consumerId,
        checkpointRowDeleted: (rewound.rowCount ?? 0) > 0,
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
        /* الخطأُ الأصليُّ أولى بالرفعِ من فشلِ التراجُعِ — ولا يُبتلَعُ ذاكَ صمتاً بل يُترَكُ للسجلِّ. */
      });
      throw err;
    } finally {
      client.release();
    }
  }
}

/**
 * PostgresRelayRequeueStore — إعادةُ صفٍّ مسمومٍ إلى الطابورِ في **معاملةٍ
 * واحدةٍ** (المراجعةُ 22/N · `M5-13R` · ADR-026 §4.24).
 *
 * ## حركتانِ أو لا شيءَ
 *
 * رفعُ نهائيّةِ الصفِّ (`poisoned` → `pending`) وإرجاعُ نقطةِ تقدُّمِ دفترِهِ
 * يقعانِ في معاملةٍ واحدةٍ على اتّصالٍ واحدٍ. والسببُ مُقاسٌ لا ذوقٌ: لو رُفِعَ
 * الصفُّ وحدَهُ لسقطَ من **مقياسِ** §4.23 (لأنَّهُ لم يعُدْ `poisoned`) ولم
 * يُقرأْ أبداً (لأنَّ نقطةَ التقدُّمِ تجاوزَتْهُ) — فيصيرُ الفقدُ **أخفى ممّا
 * كانَ**، وهذا أسوأُ من عدمِ الإعادةِ أصلاً.
 *
 * ## و`FOR UPDATE` على الصفَّينِ
 *
 * الصفُّ يُقفَلُ كي لا يُقرأَ حالتَهُ نداءانِ متزامنانِ فيرفعاهُ مرّتَينِ
 * ويُجيبَ كلاهُما `requeued` على عملٍ وقعَ مرّةً. وصفُّ نقطةِ التقدُّمِ يُقفَلُ
 * كي لا تُكتَبَ فوقَ إرجاعِنا كتابةٌ أقدمُ.
 *
 * ## والإرجاعُ إلى **الصفرِ** — كلفةٌ مُعلَنةٌ لا مخفيّةٌ
 *
 * الدفترُ لا يحفظُ `occurred_at`، فلا سبيلَ إلى إرجاعٍ **دقيقٍ** إلى ما قبلَ
 * الحدثِ بعينِهِ بلا نسخِ حقلٍ ثالثٍ يصيرُ مصدرَ حقيقةٍ مُكرَّراً. فالإرجاعُ إلى
 * الصفرِ، والتماثُليّةُ تجعلُ كلَّ صفٍّ نهائيٍّ يُقرأُ ثانيةً **لا عملاً**
 * (`relay.ts` الخطوةُ 1). والثمنُ: مسحٌ من أوّلِ الصندوقِ الصادرِ على دفعاتٍ
 * حتّى تعودَ النقطةُ إلى ما كانت — وهوَ قراءةٌ لا كتابةٌ، ويقعُ في فعلِ مُشغِّلٍ
 * نادرٍ لا في مسارٍ ساخنٍ. **والثمنُ مكتوبٌ هنا وفي الجوابِ نفسِهِ
 * (`rewound_to`) كي لا يُفاجَأَ بهِ قارئُ رسمٍ بيانيٍّ.**
 */

import type { Pool, PoolClient } from "pg";
import type { RelayRequeuePort } from "../ports.js";
import {
  RELAY_DEAD_LETTER_LEDGERS,
  type RelayDeadLetterLedger,
} from "../domain/relay-dead-letters.js";
import {
  RELAY_REQUEUE_TARGET_STATUS,
  decideRelayRequeue,
  type RelayRequeueDecision,
} from "../domain/relay-reprocess.js";
import { ZERO_CHECKPOINT } from "../domain/consumed-events.js";

/* ════════════════════════════════════════════════════════════════════════
 * الربطُ بينَ اسمِ المُشغِّلِ وجدولَيهِ — **ثوابتُ حرفيّةٌ، وموضعٌ واحدٌ**
 *
 * أسماءُ الجداولِ تُركَّبُ في نصِّ الاستعلامِ (لا تُمرَّرُ مُعامِلاً في
 * Postgres)، وأمانُ ذلكَ ليسَ في التهذيبِ بل في أنَّ **لا مُدخَلَ يصلُ النصَّ**:
 * المفتاحُ نوعُهُ `RelayDeadLetterLedger` لا `string`، والحدُّ HTTP يرفضُ ما
 * سِواهُ قبلَ الوصولِ. والنوعُ `Record<RelayDeadLetterLedger, …>` يجعلُ دفتراً
 * يُضافُ إلى القائمةِ المُصرَّحةِ **بلا جدولٍ هنا** خطأَ ترجمةٍ لا نقصاً صامتاً.
 * ════════════════════════════════════════════════════════════════════════ */

interface LedgerTables {
  /** دفترُ الأحكامِ الذي فيهِ الصفُّ المسمومُ. */
  readonly consumed: string;
  /** جدولُ نقطةِ التقدُّمِ الذي يُرجَعُ معَهُ. */
  readonly checkpoint: string;
  /** مُعرِّفُ المُستهلِكِ — نفسُ الثابتِ الذي يكتبُهُ المُرحِّلُ. */
  readonly consumerId: string;
}

const LEDGER_TABLES: Record<RelayDeadLetterLedger, LedgerTables> = {
  dispatch: {
    consumed: "delivery_relay_consumed_events",
    checkpoint: "delivery_relay_checkpoint",
    consumerId: "delivery-dispatch-relay-v1",
  },
  marketplace_inventory: {
    consumed: "delivery_inventory_relay_consumed_events",
    checkpoint: "delivery_inventory_relay_checkpoint",
    consumerId: "delivery-marketplace-inventory-relay-v1",
  },
};

/**
 * ما يُنشَرُ للمُنادي فوقَ القرارِ نفسِهِ: **إلى أينَ أُرجِعَت النقطةُ**.
 * ونشرُهُ ليسَ حشواً — مُشغِّلٌ يقرأُ `requeued` ولا يعرِفُ أنَّ مسحاً من الصفرِ
 * بدأَ يظنُّ الإعادةَ فوريّةً، ثمَّ يُصعِّدُ حادثةً لأنَّ الصفَّ لم يُطبَّقْ في
 * ثانيةٍ.
 */
export interface RelayRequeueEffect {
  readonly decision: RelayRequeueDecision;
  readonly consumerId: string;
  readonly rewoundTo: { readonly lastOccurredAt: string; readonly lastEventId: string } | null;
}

/**
 * حرسُ انحرافٍ: كلُّ دفترٍ مُصرَّحٍ لهُ مدخلٌ هنا. ويُنادى في البانيةِ كي يقعَ
 * الانفجارُ عندَ التركيبِ لا عندَ أوّلِ حادثةٍ.
 */
function assertEveryLedgerMapped(): void {
  for (const ledger of RELAY_DEAD_LETTER_LEDGERS) {
    if (LEDGER_TABLES[ledger] === undefined) {
      throw new Error(`دفترٌ مُصرَّحٌ بلا جدولٍ في مُحوِّلِ الإعادةِ: ${ledger}`);
    }
  }
}

export class PostgresRelayRequeueStore implements RelayRequeuePort {
  constructor(private readonly pool: Pool) {
    assertEveryLedgerMapped();
  }

  async requeuePoisonedEvent(cmd: {
    readonly ledger: RelayDeadLetterLedger;
    readonly eventId: string;
  }): Promise<RelayRequeueDecision> {
    return (await this.requeuePoisonedEventWithEffect(cmd)).decision;
  }

  /**
   * النسخةُ التي يستعملُها الحدُّ HTTP: القرارُ **معَ** أثرِهِ. والفصلُ بينَها
   * وبينَ `requeuePoisonedEvent` مقصودٌ: المنفذُ في `ports.ts` يعِدُ بالقرارِ
   * وحدَهُ كي لا يُقيَّدَ كلُّ مُنفِّذٍ بنشرِ تفصيلِ نقطةِ تقدُّمٍ قد لا يملكُهُ.
   */
  async requeuePoisonedEventWithEffect(cmd: {
    readonly ledger: RelayDeadLetterLedger;
    readonly eventId: string;
  }): Promise<RelayRequeueEffect> {
    const tables = LEDGER_TABLES[cmd.ledger];
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const found = await client.query<{ consumed_status: string }>(
        `SELECT consumed_status FROM ${tables.consumed} WHERE event_id = $1 FOR UPDATE`,
        [cmd.eventId],
      );
      const observed = found.rowCount === 0 ? null : found.rows[0]!.consumed_status;
      const decision = decideRelayRequeue(observed);

      if (decision.outcome === "rejected") {
        /*
         * `ROLLBACK` لا `COMMIT`: لم يُكتَبْ شيءٌ، والإقفالُ يُرفَعُ. و`COMMIT`
         * على معاملةٍ فارغةٍ كانَ يعملُ أيضاً — لكنَّ `ROLLBACK` يقولُ للقارئِ
         * إنَّ **لا أثرَ** مقصودٌ، ولا يُغري بإضافةِ كتابةٍ قبلَهُ لاحقاً.
         */
        await client.query("ROLLBACK");
        return { decision, consumerId: tables.consumerId, rewoundTo: null };
      }

      /*
       * الحركةُ الأولى — **رفعُ النهائيّةِ وحدَها**.
       *
       * ولا `attempt_count = 1` ولا `last_error = NULL`: هُما الدليلُ الوحيدُ
       * على لِمَ سُمَّ الصفُّ، والدفترُ لا يحفظُ تاريخاً. ومحوُهُما عندَ الإعادةِ
       * كانَ يجعلُ كلَّ محاولةِ إنقاذٍ **تمحو سببَ العطبِ** (التعليلُ كاملاً في
       * `domain/relay-reprocess.ts`). و`updated_at` وحدَهُ يتقدَّمُ لأنَّهُ
       * مقياسُ §4.23 لعمرِ الفقدِ.
       *
       * والشرطُ `consumed_status = 'poisoned'` مُكرَّرٌ هنا فوقَ القرارِ عمداً:
       * حزامٌ ثانٍ لو تسرَّبَ نداءٌ لا يمرُّ بالقرارِ. والقرارُ يبقى مصدرَ
       * **الجوابِ** كي يُفرَّقَ «لا صفَّ» من «صفٌّ ليسَ مسموماً» — وهوَ ما لا
       * يستطيعُهُ عددُ الصفوفِ المُعدَّلةِ وحدَهُ.
       */
      const updated = await client.query(
        `UPDATE ${tables.consumed}
            SET consumed_status = $2, updated_at = now()
          WHERE event_id = $1 AND consumed_status = 'poisoned'`,
        [cmd.eventId, RELAY_REQUEUE_TARGET_STATUS],
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
       * الحركةُ الثانيةُ — إرجاعُ نقطةِ التقدُّمِ إلى الصفرِ.
       *
       * و`ON CONFLICT … DO UPDATE` لا `UPDATE` وحدَهُ: مُرحِّلٌ لم يُشغَّلْ قطُّ
       * لا صفَّ لهُ، وإعادةٌ قبلَ أوّلِ تشغيلٍ ليست حالةً مستحيلةً — وصمتُها
       * كانَ سيُنتِجُ «أُعيدَ» بلا إرجاعٍ.
       */
      const rewound = await client.query<{ last_occurred_at: Date; last_event_id: string }>(
        `INSERT INTO ${tables.checkpoint} (consumer_id, last_occurred_at, last_event_id, updated_at)
              VALUES ($1, $2, $3, now())
         ON CONFLICT (consumer_id) DO UPDATE
              SET last_occurred_at = EXCLUDED.last_occurred_at,
                  last_event_id = EXCLUDED.last_event_id,
                  updated_at = now()
           RETURNING last_occurred_at, last_event_id`,
        [tables.consumerId, ZERO_CHECKPOINT.last_occurred_at, ZERO_CHECKPOINT.last_event_id],
      );

      await client.query("COMMIT");

      const row = rewound.rows[0]!;
      return {
        decision,
        consumerId: tables.consumerId,
        rewoundTo: {
          lastOccurredAt: row.last_occurred_at.toISOString(),
          lastEventId: row.last_event_id,
        },
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

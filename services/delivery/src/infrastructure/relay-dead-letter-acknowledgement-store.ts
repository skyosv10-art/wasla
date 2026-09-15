/**
 * PostgresRelayAcknowledgementStore — كتابةُ إقرارِ صفٍّ مسمومٍ في **معاملةٍ
 * واحدةٍ** (المراجعةُ 24/N · M5-13 · ADR-026 §4.27).
 *
 * ## قراءةٌ تحتَ قفلِ صفٍّ ثمَّ كتابةٌ — لا كتابةٌ شرطيّةٌ عمياءُ
 *
 * سابقةُ `PostgresRelayRequeueStore` حرفاً: الحالةُ تُقرأُ بـ`FOR UPDATE`،
 * والقرارُ يُتَّخَذُ في الميدانِ النقيِّ (`domain/relay-acknowledgement.ts`)،
 * ثمَّ تُكتَبُ الكتابةُ. و`UPDATE … WHERE consumed_status='poisoned' AND
 * acknowledged_at IS NULL` وحدَهُ كانَ سيُعطي **صفراً من الصفوفِ** لثلاثِ
 * حالاتٍ مختلفةٍ (لا صفَّ · ليسَ مسموماً · أُقِرَّ سلفاً) — وهيَ ثلاثةُ أجوبةٍ
 * لا جوابٌ واحدٌ لمُشغِّلٍ في حادثةٍ.
 *
 * ## ولا قفلَ تشغيليًّا (`advisory`) هنا — وهذا فرقٌ مقصودٌ عن الإعادةِ
 *
 * الإعادةُ تحجزُ قفلَ المُستهلِكِ لأنَّها تمسُّ **نقطةَ تقدُّمِ الدفترِ** التي
 * يكتبُها المُرحِّلُ في دورتِهِ. والإقرارُ لا يمسُّ نقطةً ولا نهائيّةً ولا
 * `attempt_count`: يُضيفُ ثلاثيَّ شهادةٍ على صفٍّ **نهائيٍّ لا يقرؤُهُ
 * المُرحِّلُ أصلاً**. فحجزُ قفلِ المُستهلِكِ كانَ سيُعطِّلَ دورةَ ترحيلٍ حقيقيّةً
 * مقابلَ لا شيءٍ — وقفلُ الصفِّ وحدَهُ يكفي لتسلسُلِ نداءَينِ متزامنَينِ على
 * الصفِّ نفسِهِ، ويتسلسَلُ كذلكَ معَ إعادةٍ جاريةٍ لأنَّها تُقفِلُ الصفَّ نفسَهُ.
 *
 * وترتيبُ الأقفالِ لا يُنتِجُ جُموداً: الإعادةُ تأخذُ (تشغيليٌّ ← صفٌّ)
 * والإقرارُ يأخذُ (صفٌّ) وحدَهُ — لا دورةَ انتظارٍ.
 */

import type { Pool, PoolClient } from "pg";
import type { RelayDeadLetterAcknowledgementPort } from "../ports.js";
import {
  RELAY_DEAD_LETTER_LEDGERS,
  type RelayDeadLetterLedger,
} from "../domain/relay-dead-letters.js";
import {
  decideRelayAcknowledgement,
  type RelayAcknowledgementDecision,
} from "../domain/relay-acknowledgement.js";

/**
 * اسمُ جدولِ كلِّ دفترٍ — نفسُ سابقةِ مُحوِّلِ الإعادةِ: `Record` على النوعِ
 * المُصرَّحِ كي يصيرَ دفترٌ يُضافُ بلا جدولٍ **خطأَ ترجمةٍ** لا نقصاً صامتاً،
 * والاسمُ يُركَّبُ في النصِّ لأنَّ Postgres لا يُمَعْلِمُ أسماءَ الجداولِ —
 * وأمانُهُ في أنَّ المفتاحَ نوعُهُ `RelayDeadLetterLedger` لا `string`.
 */
const LEDGER_CONSUMED_TABLES: Record<RelayDeadLetterLedger, string> = {
  dispatch: "delivery_relay_consumed_events",
  marketplace_inventory: "delivery_inventory_relay_consumed_events",
};

function assertEveryLedgerMapped(): void {
  for (const ledger of RELAY_DEAD_LETTER_LEDGERS) {
    if (LEDGER_CONSUMED_TABLES[ledger] === undefined) {
      throw new Error(`دفترٌ مُصرَّحٌ بلا جدولٍ في مُحوِّلِ الإقرارِ: ${ledger}`);
    }
  }
}

interface ObservedRow {
  readonly consumed_status: string;
  readonly acknowledged_at: Date | null;
  readonly acknowledged_by: string | null;
  readonly acknowledgement_reason: string | null;
}

export class PostgresRelayAcknowledgementStore implements RelayDeadLetterAcknowledgementPort {
  constructor(private readonly pool: Pool) {
    assertEveryLedgerMapped();
  }

  async acknowledgePoisonedEvent(cmd: {
    readonly ledger: RelayDeadLetterLedger;
    readonly eventId: string;
    readonly acknowledgedBy: string;
    readonly reason: string;
    readonly acknowledgedAt: string;
  }): Promise<RelayAcknowledgementDecision> {
    const table = LEDGER_CONSUMED_TABLES[cmd.ledger];
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const found = await client.query<ObservedRow>(
        `SELECT consumed_status, acknowledged_at, acknowledged_by, acknowledgement_reason
           FROM ${table}
          WHERE event_id = $1
            FOR UPDATE`,
        [cmd.eventId],
      );

      const row = found.rowCount === 0 ? null : found.rows[0]!;
      const decision = decideRelayAcknowledgement({
        status: row === null ? null : row.consumed_status,
        /*
         * `toISOString()` هنا لا في الحدِّ HTTP: القاعدةُ تُرجِعُ `Date`،
         * والميدانُ النقيُّ يتعامَلُ بالنصِّ ISO وحدَهُ (سابقةُ مقياسِ §4.23).
         * والتحويلُ في المُحوِّلِ يُبقي الميدانَ خالياً من `pg`.
         */
        acknowledgedAt: row?.acknowledged_at?.toISOString() ?? null,
        acknowledgedBy: row?.acknowledged_by ?? null,
        acknowledgementReason: row?.acknowledgement_reason ?? null,
      });

      if (decision.outcome !== "acknowledged") {
        /*
         * `ROLLBACK` لا `COMMIT`: لا أثرَ **مقصودٌ** — في الرفضِ وفي
         * `already_acknowledged` معاً. والثانيةُ أهمُّ: الكتابةُ فوقَ إقرارِ
         * الأوّلِ كانت ستمحو شاهداً لأجلِ نداءٍ مُكرَّرٍ (§4.20 حرفاً).
         */
        await client.query("ROLLBACK");
        return decision;
      }

      /*
       * الثلاثيُّ يُكتَبُ **معاً أو لا يُكتَبُ** — والقيدُ
       * `ck_…_ack_triple` في القاعدةِ يُنفِّذُ ذلكَ لا هذهِ الأسطرُ.
       *
       * و`consumed_status` **لا يُمَسُّ**: الصفُّ يبقى `poisoned` في الدفترِ
       * وفي `total_poisoned`؛ المُستثنى من **الحكمِ** وحدَهُ (§4.23 المُعدَّلُ).
       * وتحويلُ حالتِهِ إلى `acknowledged` كانَ سيُخرِجَهُ من المقياسِ ويجعلَ
       * «صفرَ مسمومٍ» دعوى كاذبةً — وهوَ عينُ محوِ الدليلِ الذي يمنعُهُ العقدُ.
       *
       * و`updated_at` **لا يتقدَّمُ**: هوَ مقياسُ **عمرِ الفقدِ** في §4.23،
       * وتقديمُهُ بالإقرارِ كانَ سيُصغِّرَ عمرَ صفٍّ لم يُعالَجْ — أي تحسينُ
       * رقمٍ بلا تحسينِ واقعٍ. وعمرُ الإقرارِ نفسِهِ محفوظٌ في
       * `acknowledged_at`.
       *
       * والشرطانِ في `WHERE` فوقَ القرارِ حزامٌ ثانٍ لو تسرَّبَ نداءٌ لا يمرُّ
       * بالقرارِ.
       */
      const updated = await client.query<{ acknowledged_at: Date }>(
        `UPDATE ${table}
            SET acknowledged_at = $2,
                acknowledged_by = $3,
                acknowledgement_reason = $4
          WHERE event_id = $1
            AND consumed_status = 'poisoned'
            AND acknowledged_at IS NULL
      RETURNING acknowledged_at`,
        [cmd.eventId, cmd.acknowledgedAt, cmd.acknowledgedBy, cmd.reason],
      );

      if (updated.rowCount !== 1) {
        throw new Error(
          `إقرارٌ لم يُصِبْ صفّاً واحداً (${updated.rowCount}) رغمَ إقفالٍ — عطبُ تماسُكٍ لا يُبتلَعُ`,
        );
      }

      await client.query("COMMIT");
      return decision;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
        /* الخطأُ الأصليُّ أولى بالرفعِ من فشلِ التراجُعِ. */
      });
      throw err;
    } finally {
      client.release();
    }
  }
}

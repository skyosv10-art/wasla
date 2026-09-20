/**
 * PostgresSearchAcknowledgementStore — كتابةُ إقرارِ صفٍّ مسمومٍ في **معاملةٍ
 * واحدةٍ** (فجوةُ `G5` · موجةُ المحضرِ · `CLM-0249` · سابقةُ ADR-026 §4.27).
 *
 * ## قراءةٌ بإقفالٍ ثمَّ قرارٌ نقيٌّ ثمَّ كتابةٌ واحدةٌ
 *
 * `SELECT … FOR UPDATE` على صفِّ الدفترِ، ثمَّ `decideSearchAcknowledgement`
 * على ما قُرِئَ، ثمَّ `UPDATE` واحدٌ. والإقفالُ هوَ ما يجعلُ نداءَينِ متزامنَينِ
 * لا يكتبانِ ثلاثيَّينِ فيُجيبُ كلاهُما `acknowledged` على واقعةٍ وقعَت مرّةً —
 * والثاني يقرأُ إقرارَ الأوّلِ بعدَ أن يُرفَعَ القفلُ فيُجيبُ
 * `already_acknowledged` بالحقيقةِ.
 *
 * ## ولا قفلَ تشغيليّاً — بقصدٍ مقيسٍ
 *
 * الإقرارُ لا يمسُّ نقطةَ تقدُّمٍ ولا حالةً ولا عدّادَ محاولاتٍ، فهوَ لا يتقاطعُ
 * معَ دورةِ مُرحِّلٍ جاريةٍ في شيءٍ. وقفلٌ تشغيليٌّ هنا كانَ سيُوقِفُ دورةً
 * حقيقيّةً لأجلِ كتابةِ ملاحظةٍ. وترتيبُ الأقفالِ لا يُنتِجُ جموداً: الإعادةُ
 * تأخذُ قفلَ صفٍّ وحدَهُ أيضاً في هذهِ الخدمةِ، والاثنانِ يتنافسانِ على **نفسِ
 * الصفِّ** فيتسلسلانِ لا يتعارَضانِ.
 *
 * ## و`ROLLBACK` في الرفضِ **وفي الإقرارِ الثاني** معاً
 *
 * الرفضُ بيّنٌ: لا أثرَ. والإقرارُ الثاني كذلكَ: **لا يُكتَبُ فوقَ أوّلِ شاهدٍ**.
 * وتراجُعٌ صريحٌ بدلَ `COMMIT` على معاملةٍ فارغةٍ يقولُ للقارئِ إنَّ انعدامَ
 * الأثرِ مقصودٌ، ولا يُغري بإضافةِ كتابةٍ قبلَهُ لاحقاً.
 *
 * ## وما لا يُلمَسُ
 *
 * `status` و`attempt_count` و`last_error` و`consumed_at`. والأخيرُ خاصّةً هوَ
 * **مقياسُ عمرِ الفقدِ** في هذا الدفترِ (لا `updated_at` فيهِ)، فتحريكُهُ عندَ
 * الإقرارِ كانَ سيُقصِّرُ عمرَ فقدٍ لم يُحَلَّ — أي يُخفِّفُ حكماً بفعلٍ إداريٍّ.
 */

import type { Pool, PoolClient } from "pg";
import type { SearchRelayAcknowledgementPort } from "../ports.js";
import {
  SEARCH_DEAD_LETTER_LEDGERS,
  SEARCH_POISONED_STATUS,
  type SearchDeadLetterLedger,
} from "../domain/relay-dead-letters.js";
import {
  decideSearchAcknowledgement,
  type SearchAcknowledgementDecision,
} from "../domain/relay-acknowledgement.js";

/* ════════════════════════════════════════════════════════════════════════
 * الربطُ بينَ الدفترِ وجدولِهِ — **ثوابتُ حرفيّةٌ، وموضعٌ واحدٌ**
 *
 * لا مُدخَلَ يصلُ نصَّ الاستعلامِ: المفتاحُ نوعُهُ `SearchDeadLetterLedger` لا
 * `string`، والحدُّ HTTP يرفضُ ما سِواهُ قبلَ الوصولِ. و`Record<…>` يجعلُ دفتراً
 * يُضافُ إلى القائمةِ المُصرَّحةِ بلا جدولٍ هنا **خطأَ ترجمةٍ**.
 * ════════════════════════════════════════════════════════════════════════ */

const LEDGER_TABLES: Record<SearchDeadLetterLedger, string> = {
  marketplace: "search_relay_consumed_events",
};

function assertEveryLedgerMapped(): void {
  for (const ledger of SEARCH_DEAD_LETTER_LEDGERS) {
    if (LEDGER_TABLES[ledger] === undefined) {
      throw new Error(`دفترٌ مُصرَّحٌ بلا جدولٍ في مُحوِّلِ الإقرارِ: ${ledger}`);
    }
  }
}

interface ObservedRow {
  status: string;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  acknowledgement_reason: string | null;
}

export class PostgresSearchAcknowledgementStore implements SearchRelayAcknowledgementPort {
  constructor(private readonly pool: Pool) {
    assertEveryLedgerMapped();
  }

  async acknowledgePoisonedEvent(cmd: {
    readonly ledger: SearchDeadLetterLedger;
    readonly outboxId: string;
    readonly acknowledgedBy: string;
    readonly reason: string;
    readonly acknowledgedAt: Date;
  }): Promise<SearchAcknowledgementDecision> {
    const table = LEDGER_TABLES[cmd.ledger];
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const found = await client.query<ObservedRow>(
        `SELECT status, acknowledged_at, acknowledged_by, acknowledgement_reason
           FROM ${table}
          WHERE outbox_id = $1::uuid
          FOR UPDATE`,
        [cmd.outboxId],
      );

      const row = found.rowCount === 0 ? null : found.rows[0]!;
      const decision = decideSearchAcknowledgement({
        status: row === null ? null : row.status,
        /*
         * الطابعُ يُحوَّلُ إلى ISO **هنا** لا في المجالِ: `pg` يُسلِّمُ
         * `timestamptz` عموداً في صفٍّ كائنَ `Date`، والمجالُ نقيٌّ يتعامَلُ معَ
         * نصٍّ. وشكلُ الحرفِ مُقرَّرٌ عندَنا (`toISOString`) لا متروكاً لطبقةِ
         * سائقٍ — سابقةُ متجرِ العينِ حرفاً.
         */
        acknowledgedAt: row?.acknowledged_at?.toISOString() ?? null,
        acknowledgedBy: row?.acknowledged_by ?? null,
        acknowledgementReason: row?.acknowledgement_reason ?? null,
      });

      if (decision.outcome !== "acknowledged") {
        await client.query("ROLLBACK");
        return decision;
      }

      /*
       * والشرطُ في `WHERE` مُكرَّرٌ فوقَ القرارِ عمداً — حزامٌ ثانٍ لو تسرَّبَ
       * نداءٌ لا يمرُّ بالقرارِ: `status = 'poisoned'` (القيدُ في القاعدةِ يمنعُ
       * غيرَهُ أصلاً) و`acknowledged_at IS NULL` (فلا يُكتَبُ فوقَ شاهدٍ).
       */
      const updated = await client.query(
        `UPDATE ${table}
            SET acknowledged_at = $2,
                acknowledged_by = $3,
                acknowledgement_reason = $4
          WHERE outbox_id = $1::uuid
            AND status = $5
            AND acknowledged_at IS NULL`,
        [
          cmd.outboxId,
          cmd.acknowledgedAt,
          cmd.acknowledgedBy,
          cmd.reason,
          SEARCH_POISONED_STATUS,
        ],
      );

      if (updated.rowCount !== 1) {
        /*
         * لا يقعُ ما دامَ الإقفالُ قائماً؛ ووجودُهُ لأنَّ صمتاً هنا كانَ سيعني
         * جواباً `acknowledged` على صفٍّ لم يُكتَبْ فيهِ شيءٌ — كذبٌ في الجوابِ،
         * وأسوأُ ما يكونُ في دفترِ مسؤوليّةٍ.
         */
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

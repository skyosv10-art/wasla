/**
 * PostgresRelayDeadLetterStore — قياسُ المسمومِ من **الدفترَينِ** في لقطةٍ واحدةٍ
 * (المراجعةُ 21/N · ADR-026 §4.23).
 *
 * ## الحقيقةُ في الجدولِ ولا مكانَ آخرَ
 *
 * لا عدّادَ في العمليّةِ ولا لقطةٌ مُخزَّنةٌ: كلُّ نداءٍ يسألُ الجدولَ. ونداءٌ
 * يُجيبُ من ذاكرةٍ كانَ سيُصفَّرُ بإعادةِ نشرٍ ويتضاعفُ بعددِ النُّسَخِ — والصفرُ
 * الكاذبُ يُقرأُ نظافةً (التعليلُ كاملاً في `domain/relay-dead-letters.ts`).
 *
 * ## واستعلامٌ **واحدٌ** لا اثنانِ
 *
 * الدفترانِ يُسألانِ في عبارةٍ واحدةٍ بـ`UNION ALL` داخلَ `WITH`. والسببُ ليسَ
 * اقتصادَ رحلةٍ: استعلامانِ متتاليانِ يُقرآنِ لقطتَينِ مختلفتَينِ، فالمجموعُ
 * المنشورُ لا يوافقُ أيَّ لحظةٍ وُجِدَت فعلاً — ومراقبٌ يُنبِّهُ على مجموعٍ لم
 * يكن قطُّ هوَ عينُ ما يجعلُ التنبيهَ لا يُصدَّقُ فيُصمَّتُ.
 *
 * ## قراءةٌ محضةٌ
 *
 * لا `INSERT` ولا `UPDATE` ولا `DELETE` في هذا الملفِّ — وهذا مُثبَتٌ باختبارِ
 * تكامُلٍ يُقارِنُ بصمةَ الجدولَينِ قبلَ النداءِ وبعدَهُ، لا مُدَّعىً في تعليقٍ.
 */

import type { Pool } from "pg";
import type { RelayDeadLetterReadPort } from "../ports.js";
import {
  RELAY_DEAD_LETTER_LEDGERS,
  RELAY_POISONED_STATUS,
  type RelayDeadLetterEventTypeCount,
  type RelayDeadLetterLedger,
  type RelayDeadLetterLedgerMetric,
  type RelayDeadLetterMetric,
} from "../domain/relay-dead-letters.js";

/* ════════════════════════════════════════════════════════════════════════
 * الربطُ بينَ اسمِ المُشغِّلِ واسمِ الجدولِ — **موضعٌ واحدٌ، ونصٌّ ثابتٌ**
 *
 * الأسماءُ تُركَّبُ في نصِّ الاستعلامِ (لا يجوزُ تمريرُ اسمِ جدولٍ مُعامِلاً في
 * Postgres)، فوجودُها هنا **ثوابتَ حرفيّةً** لا مُشتقّةً من مُدخَلٍ هوَ ما يجعلُ
 * ذلكَ آمِناً: لا سطحَ حَقنٍ لأنَّ لا مُدخَلَ يصلُ النصَّ أصلاً. والحدُّ مُثبَتٌ
 * بالنوعِ: `Record<RelayDeadLetterLedger, string>` يجعلُ دفتراً يُضافُ إلى
 * القائمةِ المُصرَّحةِ **بلا جدولٍ هنا** خطأَ ترجمةٍ لا نقصاً صامتاً في الجوابِ.
 * ════════════════════════════════════════════════════════════════════════ */

const LEDGER_TABLES: Record<RelayDeadLetterLedger, string> = {
  dispatch: "delivery_relay_consumed_events",
  marketplace_inventory: "delivery_inventory_relay_consumed_events",
};

interface LedgerAggregateRow {
  ledger: string;
  poisoned: string;
  /**
   * **نصٌّ لا `Date`** — وهذا فرقٌ دفعَ ثمنَهُ اختبارُ التكامُلِ لا المراجعةُ:
   * `pg` يُحوِّلُ `timestamptz` إلى `Date` حينَ يكونُ عموداً في صفٍّ، أمّا هنا
   * فالصفوفُ مُغلَّفةٌ بـ`json_agg` فتصلُ **نصّاً في JSON** بلا تحويلٍ. ومحاولةُ
   * `toISOString()` عليهِ كانَت تُسقِطُ كلَّ قراءةٍ فيها مسمومٌ واحدٌ — أي
   * المسارَ الذي يُقرأُ في الحادثةِ وحدَهُ، وتمرُّ الحالةُ الخاليةُ سليمةً.
   * فالطابعُ يُنسَّقُ في SQL نفسِهِ (`to_char` بـ UTC) كي يكونَ شكلُ الحرفِ
   * مُقرَّراً عندَنا لا مُتروكاً لاختلافِ طبقةِ سائقٍ.
   */
  oldest_poisoned_at: string | null;
  newest_poisoned_at: string | null;
  /** عدّادا الإقرارِ وأقدمُ غيرِ مُقَرٍّ بهِ (§4.27) — من **اللقطةِ نفسِها**. */
  acknowledged_poisoned: string;
  oldest_unacknowledged_poisoned_at: string | null;
}

interface EventTypeRow {
  ledger: string;
  event_type: string;
  poisoned: string;
}

/**
 * `count(*)` في Postgres نوعُهُ `bigint`، ويُسلِّمُهُ `pg` **نصّاً** كي لا يفقدَ
 * دقّةً فوقَ 2^53. والتحويلُ صريحٌ هنا: نصٌّ يمرُّ إلى JSON كانَ سيجعلَ
 * `poisoned: "3"` في جوابِ مسارٍ، ومراقبٌ يُقارِنُهُ بعتبةٍ عدديّةً يقرأُ
 * `"3" >= 10` فيُجيبُ خطأً بلا أن يُسقِطَ اختباراً.
 */
function toCount(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * الطابعُ يأتي مُنسَّقاً من SQL؛ وهذا حرسُ عقدٍ لا تحويلٌ: طابعٌ لا يُقرأُ
 * يُرفَعُ خطأً ولا يُبتلَعُ `null` — و`null` هنا معناهُ «لا صفَّ مسموماً»،
 * فابتلاعُ عطبٍ فيهِ كانَ سيُقرأُ خلوّاً.
 */
function toIso(value: string | null): string | null {
  if (value === null) return null;
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`طابعُ زمنٍ غيرُ مقروءٍ من دفترِ المسمومِ: ${value}`);
  }
  return value;
}

export class PostgresRelayDeadLetterStore implements RelayDeadLetterReadPort {
  constructor(private readonly pool: Pool) {}

  async readRelayDeadLetters(query: {
    readonly eventTypeLimit: number;
  }): Promise<RelayDeadLetterMetric> {
    if (!Number.isInteger(query.eventTypeLimit) || query.eventTypeLimit < 1) {
      // عيبُ تركيبٍ عندَنا لا خطأُ منادٍ: الحدُّ يُحقَّقُ في الحدِّ HTTP قبلَ
      // الوصولِ، وهذا حرسُ عقدٍ للنداءِ المباشرِ من مُنادٍ داخليٍّ.
      throw new RangeError("eventTypeLimit يجبُ أن يكونَ عدداً صحيحاً ≥ 1");
    }

    /*
     * لقطةٌ واحدةٌ لثلاثةِ أسئلةٍ: المجموعُ لكلِّ دفترٍ، وأقدمُ/أحدثُ طابعٍ،
     * وتفصيلُ النوعِ المسقوفُ. و`updated_at` هوَ المقيسُ لا `consumed_at`:
     * الصفُّ يُنشَأُ `pending` عندَ أوّلِ محاولةٍ ثمَّ يصيرُ `poisoned` بعدَ
     * استنفادِها، فـ`consumed_at` عمرُ **أوّلِ محاولةٍ** لا عمرُ الفقدِ.
     */
    const aggregateSql = RELAY_DEAD_LETTER_LEDGERS.map(
      (ledger) => `
        SELECT '${ledger}'::text AS ledger,
               count(*)::text AS poisoned,
               to_char(min(updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS oldest_poisoned_at,
               to_char(max(updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS newest_poisoned_at,
               count(*) FILTER (WHERE acknowledged_at IS NOT NULL)::text AS acknowledged_poisoned,
               to_char(min(updated_at) FILTER (WHERE acknowledged_at IS NULL) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS oldest_unacknowledged_poisoned_at
          FROM ${LEDGER_TABLES[ledger]}
         WHERE consumed_status = $1`,
    ).join("\n        UNION ALL\n");

    const eventTypeSql = RELAY_DEAD_LETTER_LEDGERS.map(
      (ledger) => `
        (SELECT '${ledger}'::text AS ledger, event_type, count(*)::text AS poisoned
           FROM ${LEDGER_TABLES[ledger]}
          WHERE consumed_status = $1
          GROUP BY event_type
          ORDER BY count(*) DESC, event_type ASC
          LIMIT $2)`,
    ).join("\n        UNION ALL\n");

    /*
     * استعلامانِ في نداءَينِ كانا سيكسرانِ اللقطةَ الواحدةَ، فالاثنانِ في عبارةٍ
     * واحدةٍ: `json_agg` يُغلِّفُ كلَّ نتيجةٍ في صفٍّ واحدٍ فيُعادانِ معاً.
     * والمجموعةُ الفارغةُ تُعطي `NULL` لا `[]`، فـ`coalesce` تُصحِّحُها.
     */
    const result = await this.pool.query<{
      aggregates: LedgerAggregateRow[];
      event_types: EventTypeRow[];
      measured_at: Date;
    }>(
      `WITH aggregates AS (${aggregateSql}
      ), event_types AS (${eventTypeSql}
      )
      SELECT coalesce((SELECT json_agg(a) FROM aggregates a), '[]'::json) AS aggregates,
             coalesce((SELECT json_agg(e) FROM event_types e), '[]'::json) AS event_types,
             now() AS measured_at`,
      [RELAY_POISONED_STATUS, query.eventTypeLimit],
    );

    const row = result.rows[0];
    if (row === undefined) {
      // مستحيلٌ بالبناءِ (`SELECT` بلا `FROM` يُعيدُ صفّاً دائماً)، ولا يُبتلعُ
      // بصفرٍ: صفرٌ مُصطنَعٌ هنا يُقرأُ «لا مسمومَ» والحقيقةُ «لم أَقِسْ».
      throw new Error("قياسُ المسمومِ لم يُعِدْ صفّاً — لا يُدَّعى خلوٌّ لم يُقَسْ");
    }

    const measuredAt = row.measured_at.toISOString();
    const aggregates = new Map(row.aggregates.map((a) => [a.ledger, a]));
    const eventTypes = new Map<string, RelayDeadLetterEventTypeCount[]>();
    for (const entry of row.event_types) {
      const bucket = eventTypes.get(entry.ledger) ?? [];
      bucket.push({ eventType: entry.event_type, poisoned: toCount(entry.poisoned) });
      eventTypes.set(entry.ledger, bucket);
    }

    /*
     * الترتيبُ من القائمةِ المُصرَّحةِ لا من ترتيبِ صفوفِ القاعدةِ، و**كلُّ دفترٍ
     * يُذكَرُ وإن خلا**: دفترٌ يغيبُ عن الجوابِ لا يُفرَّقُ عن دفترٍ نُسِيَ من
     * الاستعلامِ (التعليلُ في شكلِ `RelayDeadLetterMetric`).
     */
    const ledgers: readonly RelayDeadLetterLedgerMetric[] = RELAY_DEAD_LETTER_LEDGERS.map(
      (ledger) => {
        const aggregate = aggregates.get(ledger);
        const poisoned = aggregate === undefined ? 0 : toCount(aggregate.poisoned);
        const acknowledgedPoisoned =
          aggregate === undefined ? 0 : toCount(aggregate.acknowledged_poisoned);
        return {
          ledger,
          poisoned,
          acknowledgedPoisoned,
          // الطرحُ من **نفسِ اللقطةِ** لا بعدٍّ ثالثٍ: عدّانِ مستقلّانِ
          // قد لا يجمعانِ إلى `poisoned` فيقرأُ المُشغِّلُ ثلاثةَ أرقامٍ لا تتّسقُ.
          unacknowledgedPoisoned: poisoned - acknowledgedPoisoned,
          oldestPoisonedAt: aggregate === undefined ? null : toIso(aggregate.oldest_poisoned_at),
          newestPoisonedAt: aggregate === undefined ? null : toIso(aggregate.newest_poisoned_at),
          oldestUnacknowledgedPoisonedAt:
            aggregate === undefined ? null : toIso(aggregate.oldest_unacknowledged_poisoned_at),
          byEventType: eventTypes.get(ledger) ?? [],
        };
      },
    );

    return {
      measuredAt,
      // المجموعُ **مُشتَقٌّ من نفسِ اللقطةِ** لا مقيسٌ باستعلامٍ ثالثٍ: مجموعٌ
      // يُسألُ وحدَهُ قد لا يوافقُ الجمعَ المنشورَ، فيقرأُ المُشغِّلُ رقمَينِ.
      totalPoisoned: ledgers.reduce((sum, ledger) => sum + ledger.poisoned, 0),
      totalAcknowledgedPoisoned: ledgers.reduce(
        (sum, ledger) => sum + ledger.acknowledgedPoisoned,
        0,
      ),
      totalUnacknowledgedPoisoned: ledgers.reduce(
        (sum, ledger) => sum + ledger.unacknowledgedPoisoned,
        0,
      ),
      ledgers,
    };
  }
}

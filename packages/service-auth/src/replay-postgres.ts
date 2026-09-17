/**
 * منعُ إعادةِ رمزِ الخدمةِ — **المخزنُ المشترَكُ** فوقَ PostgreSQL
 * (M1-03 · إغلاقُ `RISK-0015` · [ADR-035](../../../docs/15-decisions/ADR-035-distributed-service-token-replay-store.md)).
 *
 * ── العطبُ الذي أنشأَ هذا الملفَّ ─────────────────────────────────────────
 * `InMemoryServiceTokenReplayGuard` يحفظُ الآثارَ في `Map` داخلَ العمليّةِ. فنسختانِ
 * من الخدمةِ نفسِها وراءَ موازِنِ حِمْلٍ لهما مخزنانِ لا يتشاركانِ حرفاً: رمزٌ
 * التُقِطَ من الشبكةِ يُقبَلُ **مرّةً لكلِّ نسخةٍ**. فالحارسُ الذي يُقاسُ في
 * الاختبارِ بعمليّةٍ واحدةٍ يصيرُ في النشرةِ الحقيقيّةِ **عَدّاداً لا حارساً**.
 * وهذا كانَ مُسجَّلاً خطراً عالياً (`RISK-0015`) لا مُفترَضاً محلولاً.
 *
 * ── لماذا PostgreSQL ولا Redis ────────────────────────────────────────────
 * السجلُّ كانَ يُسمّي Redis سدّاً، ولا Redis في المستودعِ ولا في التبعيّاتِ ولا في
 * طبقةِ النشرِ. وإدخالُ مخزنٍ جديدٍ يُنشئُ **مصدرَ حقيقةٍ ثانياً** يجبُ نشرُهُ
 * ورصدُهُ ونسخُهُ احتياطيّاً قبلَ أن يحرسَ شيئاً. وPostgreSQL **قائمٌ فعلاً** في كلِّ
 * خدمةٍ مفروضةٍ (`DATABASE_URL`)، ويُعطي الذَّرِّيّةَ المطلوبةَ في **عبارةٍ واحدةٍ**
 * (`INSERT … ON CONFLICT DO UPDATE … WHERE`) بقُفلِ صفٍّ من الفهرسِ الفريدِ نفسِهِ.
 * فالاختيارُ يُقلِّلُ مصادرَ الحقيقةِ ولا يزيدُها، ويُبقي الاعتمادَ على ما يُنشَرُ
 * ويُنسَخُ أصلاً.
 *
 * ── الشروطُ الثلاثةُ التي يُقاسُ بها أيُّ تنفيذٍ (`replay.ts`) وكيفَ تُحقَّقُ هنا ─
 * 1. **الذَّرِّيّةُ**: عبارةٌ واحدةٌ لا «اقرأ ثمَّ اكتب». المُنادِيانِ المتوازيانِ
 *    يتسلسلانِ على قُفلِ المفتاحِ الأوّليِّ `(kid, jti)`، فالثاني يرى صفَّ الأوّلِ
 *    ويُرَدُّ `replayed` — ولا نافذةَ بينَ السؤالِ والجواب.
 * 2. **مدّةُ الحفظِ ≥ `exp` + هامشِ الانحرافِ**: `retain_until` تُحسَبُ من
 *    `expiresAtMs` مضافاً إليها الهامشُ نفسُهُ الذي يستعملُهُ تنفيذُ الذاكرةِ.
 *    والصفُّ المنتهي **يُستعادُ** لا يُعادُ قبولُهُ بصمتٍ: شرطُ `WHERE` في
 *    `DO UPDATE` يسمحُ بالكتابةِ فوقَهُ حينَ انتهت مدّتُهُ وحدَها.
 * 3. **الإخفاقُ يُغلِقُ**: كلُّ خطأٍ من المخزنِ — وكذلكَ عددُ صفوفٍ غيرُ معروفٍ —
 *    يُترجَمُ إلى `ServiceTokenReplayStoreUnavailableError`، ونقطةُ الفرضِ تردُّها
 *    `503` (ADR-021 §5). ولا مسارَ واحدٌ في هذا الملفِّ يُنتِجُ `accepted` عن شكٍّ.
 *
 * ── والحزمةُ تبقى بلا تبعيّةِ قاعدةِ بياناتٍ ───────────────────────────────
 * المنفذُ `ReplaySqlExecutor` أصغرُ ما يكفي (`query(sql, params)`)، فـ`pg` ليست
 * تبعيّةً لهذا الملفِّ ولا لجذرِ الحزمةِ — من يملكُ بِركةَ اتّصالٍ يُمرِّرُها.
 * والمِغلافُ الذي يبنيها من البيئةِ في التصديرِ الفرعيِّ `./replay-store` وحدَهُ،
 * كما فُعِلَ بـFastify: القلبُ جاهلٌ والطرفُ يعرفُ.
 */

import {
  ServiceTokenReplayStoreUnavailableError,
  type ServiceTokenReplayDecision,
  type ServiceTokenReplayGuard,
  type ServiceTokenReplayRecord,
} from "./replay.js";

/**
 * أصغرُ منفذٍ يكفي للحارسِ: عبارةٌ ومُعامِلاتٌ وعددُ صفوفٍ متأثّرةٍ. `pg.Pool`
 * و`pg.Client` يُطابِقانِهِ بلا مِغلافٍ، وكذلكَ أيُّ مُنفِّذٍ زائفٍ في اختبارٍ —
 * وهذا مقصودٌ: منفذٌ أوسعُ (معامَلاتٌ · تدفّقٌ · أنواعٌ) كانَ سيجعلُ الاختبارَ
 * يُزيِّفُ ما لا يستعملُهُ الحارسُ.
 */
export interface ReplaySqlExecutor {
  query(
    sql: string,
    params: readonly unknown[],
  ): Promise<{ readonly rowCount: number | null }>;
}

/** اسمُ الجدولِ. مملوكٌ لطبقةِ الهويّةِ لا لنطاقِ الخدمةِ، فسابقتُهُ `wasla_`. */
export const SERVICE_TOKEN_REPLAY_TABLE = "wasla_service_token_replay";

/**
 * تعريفُ الجدولِ — **مصدرُ حقيقةٍ واحدٌ** يُطبَّقُ حرفيّاً في كلِّ قاعدةٍ.
 *
 * ولمَ `IF NOT EXISTS` عندَ الإقلاعِ ولا ترحيلٌ في كلِّ خدمةٍ؟ لأنَّ الجدولَ
 * **ليس من مخطَّطِ نطاقِ أيِّ خدمةٍ**: لا يُقرأُ في استعلامٍ ولا يُهجَّرُ ولا
 * يُصدَّرُ، وعمرُ صفِّهِ دقائقُ. فنسخُ تعريفِهِ في أربعةَ عشرَ ترحيلاً مولَّداً كانَ
 * سيُنشئُ أربعةَ عشرَ مصدرَ حقيقةٍ لشيءٍ واحدٍ — وهوَ عينُ ما تمنعُهُ قاعدةُ
 * «أقلِّ المصادرِ». والسابقةُ قائمةٌ في المستودعِ لا مُبتدَعةٌ هنا:
 * `ensurePublicIdSequence(db)` يُنفَّذُ عندَ إقلاعِ خدمةِ الهويّةِ بالمنطقِ نفسِهِ.
 * والتعريفُ **مُتوافِقٌ مع التكرارِ** (`IF NOT EXISTS`)، فتشغيلُهُ ألفَ مرّةٍ
 * كتشغيلِهِ مرّةً، ولا يلمسُ صفّاً قائماً.
 */
export const SERVICE_TOKEN_REPLAY_DDL = [
  `CREATE TABLE IF NOT EXISTS ${SERVICE_TOKEN_REPLAY_TABLE} (
  kid text NOT NULL,
  jti text NOT NULL,
  retain_until timestamptz NOT NULL,
  PRIMARY KEY (kid, jti)
)`,
  `CREATE INDEX IF NOT EXISTS ${SERVICE_TOKEN_REPLAY_TABLE}_retain_until_idx
  ON ${SERVICE_TOKEN_REPLAY_TABLE} (retain_until)`,
] as const;

/**
 * يُنشئُ الجدولَ إن لم يكنْ موجوداً. **يُلقي عندَ الإخفاقِ ولا يتجاوزُهُ**: خدمةٌ
 * تُقلِعُ بلا مخزنِ آثارٍ هيَ خدمةٌ بلا حارسِ إعادةٍ، وسقوطُها عندَ الإقلاعِ برسالةٍ
 * تُسمّي السببَ أرخصُ من حدٍّ مفتوحٍ لا أحدَ يراهُ.
 */
export async function ensureServiceTokenReplaySchema(
  executor: ReplaySqlExecutor,
): Promise<void> {
  for (const statement of SERVICE_TOKEN_REPLAY_DDL) {
    await executor.query(statement, []);
  }
}

export interface PostgresReplayGuardOptions {
  /** هامشٌ يُضاف إلى مدّةِ الحفظِ فوقَ `exp` — بانحرافِ الساعاتِ نفسِه. */
  readonly retentionSkewSeconds?: number;
  /**
   * اللحظةُ الحاضرةُ. **تُمرَّرُ ولا تُقرأُ من ساعةٍ ضمنيّةٍ** — القاعدةُ نفسُها في
   * `InMemoryServiceTokenReplayGuard`، ولأنَّ القرارَ يُقارِنُ مدّةَ حفظٍ بلحظةٍ
   * فوجودُ ساعةٍ ضمنيّةٍ يجعلُ الاختبارَ يُثبِتُ المؤقِّتَ لا الحارسَ.
   */
  readonly now?: () => Date;
  /**
   * أدنى مُدّةٍ بينَ مسحتَينِ للصفوفِ المنتهيةِ (ملّي). المسحُ **كسولٌ** مع
   * النداءِ لا بمؤقِّتٍ في الخلفيّةِ: مؤقِّتٌ يُبقي العمليّةَ حيّةً ويُصعِّبُ
   * الإيقافَ النظيفَ. صِفرٌ = مع كلِّ نداءٍ (للاختبارِ).
   */
  readonly sweepIntervalMs?: number;
  /**
   * يُنادى عندَ إخفاقِ مسحةٍ. المسحُ **لا يُغيِّرُ قراراً** — يجري بعدَ صدورِهِ —
   * فإخفاقُهُ يُبلَّغُ ولا يُسقِطُ نداءً صحيحاً، ولا يُكتَمُ فلا يُرى.
   */
  readonly onSweepError?: (error: unknown) => void;
}

/** أدنى مُدّةٍ بينَ مسحتَينِ حينَ لا تُمرَّرُ: دقيقةٌ. */
export const DEFAULT_REPLAY_SWEEP_INTERVAL_MS = 60_000;

/**
 * حارسُ إعادةٍ **مشترَكٌ بينَ النسخِ**: الحقيقةُ في القاعدةِ لا في الذاكرةِ، فما
 * قَبِلَتْهُ نسخةٌ تراهُ الأخرى في العبارةِ نفسِها.
 */
export class PostgresServiceTokenReplayGuard
  implements ServiceTokenReplayGuard
{
  private readonly executor: ReplaySqlExecutor;
  private readonly retentionSkewMs: number;
  private readonly now: () => Date;
  private readonly sweepIntervalMs: number;
  private readonly onSweepError: (error: unknown) => void;
  private lastSweepMs = Number.NEGATIVE_INFINITY;

  constructor(
    executor: ReplaySqlExecutor,
    options: PostgresReplayGuardOptions = {},
  ) {
    this.executor = executor;
    this.now = options.now ?? (() => new Date());
    this.retentionSkewMs = (options.retentionSkewSeconds ?? 60) * 1000;
    if (!Number.isFinite(this.retentionSkewMs) || this.retentionSkewMs < 0) {
      throw new TypeError("هامشُ مدّةِ الحفظِ يجبُ أن يكونَ عدداً غيرَ سالبٍ.");
    }
    this.sweepIntervalMs =
      options.sweepIntervalMs ?? DEFAULT_REPLAY_SWEEP_INTERVAL_MS;
    if (!Number.isFinite(this.sweepIntervalMs) || this.sweepIntervalMs < 0) {
      throw new TypeError("مُدّةُ المسحِ يجبُ أن تكونَ عدداً غيرَ سالبٍ.");
    }
    this.onSweepError = options.onSweepError ?? (() => {});
  }

  /**
   * يحفظُ الأثرَ إن لم يكنْ محفوظاً حيّاً. **عبارةٌ واحدةٌ** تُقرِّرُ:
   * صفٌّ متأثّرٌ = `accepted` (أوّلُ مرّةٍ، أو صفٌّ منتهيةٌ مدّتُهُ استُعيدَ)،
   * وصِفرُ صفوفٍ = `replayed` (صفٌّ حيٌّ منعَ الكتابةَ).
   */
  async remember(
    record: ServiceTokenReplayRecord,
  ): Promise<ServiceTokenReplayDecision> {
    const nowMs = this.now().getTime();
    const retainUntil = new Date(record.expiresAtMs + this.retentionSkewMs);
    const now = new Date(nowMs);

    let rowCount: number | null;
    try {
      const result = await this.executor.query(
        `INSERT INTO ${SERVICE_TOKEN_REPLAY_TABLE} (kid, jti, retain_until)
     VALUES ($1, $2, $3)
ON CONFLICT (kid, jti) DO UPDATE
    SET retain_until = EXCLUDED.retain_until
  WHERE ${SERVICE_TOKEN_REPLAY_TABLE}.retain_until <= $4`,
        [record.kid, record.jti, retainUntil, now],
      );
      rowCount = result.rowCount;
    } catch (cause) {
      // لا تُترجَمُ إلى «مقبول» ولا إلى 401: المخزنُ لم يقلْ «جديدٌ» ولم يقلْ
      // «مُعادٌ» — قالَ «لا أعرفُ»، ومن لا يعرفُ لا يسمحُ (ADR-021 §5).
      throw new ServiceTokenReplayStoreUnavailableError(
        "مخزنُ آثارِ الرموزِ في Postgres لم يُجِبْ، فلا يُثبَتُ أنَّ الرمزَ لم يُعَدْ.",
        { cause },
      );
    }

    // `rowCount === null` يعني «لا عددَ» لا «صِفرَ صفوفٍ». وقراءتُهُ صِفراً كانت
    // ستُحوِّلَ جهلاً إلى رفضٍ يُربِكُ المُنادي الشريفَ، وقراءتُهُ واحداً كانت
    // ستُحوِّلَهُ إلى قبولٍ يفتحُ البابَ. فالجهلُ يُعلَنُ جهلاً.
    if (rowCount === null || !Number.isFinite(rowCount)) {
      throw new ServiceTokenReplayStoreUnavailableError(
        "مخزنُ آثارِ الرموزِ أجابَ بلا عددِ صفوفٍ، فالقرارُ غيرُ مُثبَتٍ.",
      );
    }

    const decision: ServiceTokenReplayDecision =
      rowCount > 0 ? "accepted" : "replayed";

    // بعدَ القرارِ لا قبلَهُ: مسحةٌ فاشلةٌ لا يجوزُ أن تمنعَ نداءً صحيحاً، ومسحةٌ
    // ناجحةٌ لا يجوزُ أن تحذفَ أثراً قبلَ أن يُقرَأَ.
    await this.sweep(nowMs, now);

    return decision;
  }

  /**
   * يحذفُ الصفوفَ التي انتهت مدّةُ حفظِها. **إخفاقُهُ لا يُلقى**: القرارُ صدرَ
   * قبلَهُ، وتحويلُ إخفاقِ صيانةٍ إلى `503` كانَ سيُسقِطَ حدّاً سليماً.
   */
  private async sweep(nowMs: number, now: Date): Promise<void> {
    if (nowMs - this.lastSweepMs < this.sweepIntervalMs) return;
    this.lastSweepMs = nowMs;
    try {
      await this.executor.query(
        `DELETE FROM ${SERVICE_TOKEN_REPLAY_TABLE} WHERE retain_until <= $1`,
        [now],
      );
    } catch (error) {
      this.onSweepError(error);
    }
  }
}

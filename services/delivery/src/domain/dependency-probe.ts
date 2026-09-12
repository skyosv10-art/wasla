/**
 * رصدُ تبعيّةٍ خارجيّةٍ للجاهزيّةِ — منطقٌ خالصٌ (المراجعةُ 15/N · ADR-026 §4.17).
 *
 * ## الدَّينُ الذي يُرفَعُ هنا، وحدُّهُ
 *
 * `GET /delivery/ready` كانَ يقولُ `marketplace_catalog_not_probed`: الكتالوجُ
 * موصولٌ (§4.11) ولم تسألْهُ الجاهزيّةُ. والقرارُ الذي رفضَ سبرَهُ في المراجعةِ
 * 8/N **صحيحٌ ولم يُنقَضْ**، وحُجّتاهُ منصوصتانِ في `http/readiness.ts`:
 *
 *   1. سبرُ حدٍّ خارجيٍّ في **كلِّ** نبضةِ جاهزيّةٍ يُحوِّلُ مِجَسَّ المنظِّمِ حِمْلاً
 *      على خدمةٍ أخرى — نُسَخٌ × نبضاتٌ في الدقيقةِ، بلا سقفٍ.
 *   2. وعطلُ السوقِ كانَ سيُخرِجُ هذه الخدمةَ من الدورةِ كلَّها، بينما القراءةُ
 *      والإلغاءُ وانتقالاتُ التنفيذِ **لا تحتاجُ سوقاً**؛ الإنشاءُ وحدَهُ يحتاجُهُ.
 *
 * فلم يكنِ الحلُّ سبراً في كلِّ نبضةٍ ولا سكوتاً أبديّاً، بل **رصدٌ**:
 *
 *   - **مُعلِمٌ لا حاكمٌ:** الرصدُ يُنشَرُ في الجوابِ ولا يُغيّرُ `status` قطعاً.
 *     فمن يقرأُ 503 على الإنشاءِ يعرفُ من الجاهزيّةِ **هل السوقُ هوَ السببُ**،
 *     ولا يُخرِجُ المنظِّمُ الخدمةَ من الدورةِ لأنَّ خدمةً أخرى تعطَّلَت.
 *   - **مُخزَّنٌ بمهلةِ صلاحيّةٍ:** نبضاتٌ متلاحقةٌ تُقرأُ من رصدٍ واحدٍ، فالحِمْلُ
 *     مسقوفٌ بنداءٍ واحدٍ لكلِّ `ttlMs` لكلِّ نُسخةٍ لا بعددِ النبضاتِ.
 *   - **والإخفاقُ يُخزَّنُ كالنجاحِ:** لو خُزِّنَ النجاحُ وحدَهُ لكانَ عطلُ السوقِ
 *     أقصى ما يُكلِّفُ — مَهَلٌ كاملٌ في **كلِّ** نبضةٍ، أي أنَّ الحمايةَ تختفي
 *     في اللحظةِ التي وُضِعت لها.
 *   - **ونداءٌ واحدٌ في الطريقِ:** نبضاتٌ متزامنةٌ على رصدٍ منتهيةٍ صلاحيّتُهُ
 *     تنتظرُ **النداءَ نفسَهُ** لا نداءً لكلِّ واحدةٍ (تكتُّلٌ) — وبغيرِهِ يُنتِجُ
 *     مِجَسٌّ متوازٍ من عشرِ نُسَخٍ عشرَ نداءاتٍ في الجزءِ من الثانيةِ.
 *
 * ## لماذا مَهَلٌ واحدٌ هنا ومَهَلانِ في مسبارِ القاعدةِ
 *
 * `infrastructure/readiness-probe.ts` يُنفِّذُ مَهَلَهُ مرّتَينِ لأنَّ مَهَلَ الخادمِ
 * (`statement_timeout`) لا يعملُ إن لم يُنشَأِ الاتّصالُ أصلاً، فلزمَ سباقٌ عندَ
 * العميلِ. وهنا المَهَلُ **عندَ العميلِ ابتداءً** (`AbortSignal` على `fetch`)
 * فيغطّي التعليقَ قبلَ الاتّصالِ وبعدَهُ؛ ومؤقِّتٌ ثانٍ في هذه الطبقةِ كانَ
 * سيُنتِجُ نداءً معلَّقاً بلا مالكٍ ورصداً يُخزَّنُ ثمَّ يُكتَبُ فوقَهُ.
 *
 * ## لا `process` ولا `fetch` ولا ساعةَ نظامٍ في هذا الملفِّ
 *
 * الساعةُ مُحقونةٌ لأنَّ صلاحيّةَ الرصدِ **هيَ** ما يُختبَرُ، واختبارٌ ينتظرُ
 * ثانيةً حقيقيّةً ليُثبِتَ انتهاءَ صلاحيّةٍ اختبارٌ يُحذَفُ عندَ أوّلِ تباطؤٍ.
 */

/** التبعيّاتُ التي تُرصَدُ — قائمةٌ مغلقةٌ تظهرُ على السلكِ. */
export const DEPENDENCY_NAMES = ["marketplace_catalog"] as const;
export type DependencyName = (typeof DEPENDENCY_NAMES)[number];

/** جوابُ نداءٍ واحدٍ على حدِّ التبعيّةِ. لا يرمي أبداً — العطلُ هوَ الجوابُ. */
export interface DependencyProbeResult {
  readonly ok: boolean;
  /** سببٌ من مِعجمٍ مغلقٍ — لا نصَّ استثناءٍ ولا عنوانَ ولا سرَّ. */
  readonly detail?: string;
}

export interface DependencyProbePort {
  probe(): Promise<DependencyProbeResult>;
}

/** رصدٌ بعمرِهِ — ما يُنشَرُ في جسمِ الجاهزيّةِ بعدَ التصييرِ. */
export interface DependencyObservation {
  readonly name: DependencyName;
  readonly ok: boolean;
  readonly detail?: string;
  readonly observedAt: Date;
  readonly ageMs: number;
}

export interface DependencyObservationPort {
  /** لا يرمي: عطلُ التبعيّةِ رصدٌ `ok: false` لا استثناءٌ. */
  observe(): Promise<DependencyObservation>;
}

export interface CachedDependencyProbeOptions {
  readonly name: DependencyName;
  /** عمرُ الرصدِ المقبولُ بالمللي ثانية. `0` يعني سبراً في كلِّ نبضةٍ. */
  readonly ttlMs: number;
  readonly now?: () => Date;
}

/**
 * السببُ الذي يُخزَّنُ عندَ إخفاقٍ لم يُصنَّفْ في المحوّلِ: منفذُ سبرٍ **يجبُ**
 * ألّا يرمي، فإن رمى فالعلّةُ عيبٌ في المحوّلِ لا عطلٌ في السوقِ — ويجبُ أن
 * يُقرأَ كذلكَ في الجوابِ بدلَ أن يصعدَ إلى مُعالجِ أخطاءِ HTTP فيُجيبَ
 * `ErrorResponse` على مسارٍ عقدُهُ `ReadinessResponse` (errors.md قاعدةُ 6).
 */
export const PROBE_THREW_DETAIL = "probe_threw";

export class CachedDependencyProbe implements DependencyObservationPort {
  private readonly name: DependencyName;
  private readonly ttlMs: number;
  private readonly now: () => Date;
  private cached: { ok: boolean; detail?: string; observedAt: Date } | undefined;
  private inFlight: Promise<{ ok: boolean; detail?: string; observedAt: Date }> | undefined;

  constructor(
    private readonly port: DependencyProbePort,
    options: CachedDependencyProbeOptions,
  ) {
    this.name = options.name;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? (() => new Date());
  }

  async observe(): Promise<DependencyObservation> {
    const cached = this.cached;
    if (cached !== undefined && this.ageMs(cached.observedAt) < this.ttlMs) {
      return this.toObservation(cached);
    }
    // تكتُّلٌ: أوّلُ من وجدَ الصلاحيّةَ منتهيةً يُنشئُ النداءَ، والبقيّةُ تنتظرُهُ.
    this.inFlight ??= this.runProbe();
    const fresh = await this.inFlight;
    return this.toObservation(fresh);
  }

  private async runProbe(): Promise<{ ok: boolean; detail?: string; observedAt: Date }> {
    try {
      const result = await this.port.probe();
      return this.remember(result);
    } catch {
      return this.remember({ ok: false, detail: PROBE_THREW_DETAIL });
    } finally {
      this.inFlight = undefined;
    }
  }

  private remember(result: DependencyProbeResult): {
    ok: boolean;
    detail?: string;
    observedAt: Date;
  } {
    const stored = {
      ok: result.ok,
      ...(result.detail === undefined ? {} : { detail: result.detail }),
      observedAt: this.now(),
    };
    this.cached = stored;
    return stored;
  }

  /**
   * عمرٌ لا يكونُ سالباً أبداً: ساعةُ الحاوياتِ تُضبَطُ بـNTP وقد ترجعُ إلى
   * الوراءِ، و`age_ms: -400` في جوابٍ عامٍّ يُقرأُ عيباً في الخدمةِ لا في الساعةِ.
   */
  private ageMs(observedAt: Date): number {
    return Math.max(0, this.now().getTime() - observedAt.getTime());
  }

  private toObservation(stored: {
    ok: boolean;
    detail?: string;
    observedAt: Date;
  }): DependencyObservation {
    return {
      name: this.name,
      ok: stored.ok,
      ...(stored.detail === undefined ? {} : { detail: stored.detail }),
      observedAt: stored.observedAt,
      ageMs: this.ageMs(stored.observedAt),
    };
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * إعدادُ المسبارِ من البيئةِ
 *
 * يُحَلُّ في **جِذعِ التركيبِ** لا في المحوّلِ: قيمةٌ خاطئةٌ تُوقِفُ الإقلاعَ برسالةٍ
 * تُسمّي المتغيّرَ وقيمتَهُ، ولا تُكتشَفُ بعدَ أسبوعٍ من مسبارٍ يعملُ بغيرِ ما
 * كُتِبَ في الجَدوَلِ.
 *
 * والأرقامُ **عشريّةٌ صريحةٌ** وحدَها. `Number.isInteger(Number(raw))` لا يكفي —
 * وهذا مقيسٌ لا مُتوقَّعٌ: قيسَ في المراجعةِ 14/N أنَّ `Number("0x10")` ستّةَ عشرَ
 * و`Number("1e3")` ألفٌ، فمن كتبَ `0x10` في جَدوَلِهِ يأخذُ ستّةَ عشرَ صامتاً.
 *
 * ولمَ `ttlMs = 0` **مُجازٌ** وهوَ سبرٌ في كلِّ نبضةٍ؟ لأنَّ المنعَ كانَ سيُخفي
 * قراراً تشغيليّاً مشروعاً (بيئةُ اختبارٍ تريدُ الجوابَ الآنيَّ)، والسقفُ ليسَ
 * غايةً في ذاتِهِ بل حمايةٌ للحدِّ الآخرِ — ومن يُعطّلُها يُعطّلُها بقصدٍ مكتوبٍ
 * في إعدادِهِ. أمّا المَهَلُ فلا يُقبَلُ صفراً: مسبارٌ بمَهَلِ صفرٍ لا يسبرُ.
 * ───────────────────────────────────────────────────────────────────────── */

/** صلاحيّةُ الرصدِ الافتراضيّةُ: نداءٌ واحدٌ لكلِّ نُسخةٍ في كلِّ خمسةَ عشرَ ثانيةً. */
export const DEFAULT_MARKETPLACE_PROBE_TTL_MS = 15_000;

export interface MarketplaceProbeConfig {
  readonly ttlMs: number;
  readonly timeoutMs: number;
}

export function resolveMarketplaceProbeConfig(
  env: Readonly<Record<string, string | undefined>>,
  defaults: MarketplaceProbeConfig,
): MarketplaceProbeConfig {
  return {
    ttlMs: readMilliseconds(env, "MARKETPLACE_PROBE_TTL_MS", defaults.ttlMs, 0),
    timeoutMs: readMilliseconds(env, "MARKETPLACE_PROBE_TIMEOUT_MS", defaults.timeoutMs, 1),
  };
}

function readMilliseconds(
  env: Readonly<Record<string, string | undefined>>,
  variable: string,
  fallback: number,
  minimum: number,
): number {
  const raw = env[variable];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^[0-9]+$/.test(raw.trim())) {
    throw new Error(
      `${variable} يجبُ أن يكونَ عدداً صحيحاً من المللي ثانية بأرقامٍ عشريّةٍ (القيمةُ: ${raw})`,
    );
  }
  const value = Number(raw.trim());
  if (value < minimum) {
    throw new Error(`${variable}=${value} أقلُّ من الحدِّ الأدنى ${minimum} مللي ثانية`);
  }
  return value;
}

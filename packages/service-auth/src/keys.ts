/**
 * سجلُّ مفاتيحِ هويّةِ الخدمة (M1-03) — «machine credentials» في المرحلة B1.
 *
 * القرارُ الحاكم: [ADR-020](../../../docs/15-decisions/ADR-020-service-to-service-identity.md).
 *
 * ثلاثُ خصائصَ لهذا السجلِّ مقصودةٌ ولها سببٌ مكتوبٌ:
 *
 * 1. **يُبنى مرّةً عندَ الإقلاعِ ويرفض المفتاحَ الضعيفَ فوراً.** فمفتاحٌ قصيرٌ
 *    ليس خطأَ طلبٍ يُرَدُّ بـ401؛ هو خطأُ نشرٍ يجب أن يُسقِط العمليّةَ قبلَ أن
 *    تستقبلَ طلباً واحداً. والفشلُ المتأخِّرُ هنا يعني خدمةً «تعمل» بمفتاحٍ
 *    قابلٍ للتخمين.
 * 2. **`kid` صريحٌ ومتعدِّدٌ.** التدويرُ بلا معرِّفِ مفتاحٍ يعني نافذةَ انقطاعٍ:
 *    إمّا تُقبَل المفاتيحُ كلُّها بالتجربةِ (وهو ما يُخفي مفتاحاً مسروقاً)،
 *    وإمّا يُوقَف كلُّ نداءٍ داخليٍّ لحظةَ التبديل. فالمُتحقِّقُ يعرف مفاتيحَ
 *    عدّةً، والمِنتاجُ يُوقِّع بالمفتاحِ النشطِ وحدَه.
 * 3. **لا يُطبَع سرٌّ ولا يُخرَج.** `describeKeys` يُظهِر المعرِّفاتَ والأطوالَ
 *    فقط، كي يكون في السجلِّ ما يُشخِّص «أيُّ مفتاحٍ استُخدم» بلا أن يكون فيه
 *    ما يُنتحَل به.
 */

/** الحدُّ الأدنى لطولِ سرِّ المفتاح. 32 بايتاً = مساحةُ HMAC-SHA256 الكاملة. */
export const MIN_SECRET_BYTES = 32;

/** صيغةُ معرِّفِ المفتاح: حروفٌ وأرقامٌ وشرطتانِ، 1..64 — لا فراغَ ولا نقطة. */
const KID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface ServiceAuthKey {
  /** معرِّفُ المفتاحِ كما يظهر في حِمْلِ الرمز. */
  readonly kid: string;
  /** السرُّ المشترك. لا يُسجَّل ولا يُخرَج. */
  readonly secret: string;
}

export interface ServiceAuthKeyRegistryOptions {
  /** المفاتيحُ المعروفةُ. لا يُقبَل تكرارُ `kid`. */
  readonly keys: readonly ServiceAuthKey[];
  /** معرِّفُ المفتاحِ الذي يُوقَّع به. يجب أن يكون من `keys`. */
  readonly activeKid: string;
}

/** وصفٌ آمنٌ للسجلِّ — بلا أسرارٍ. */
export interface ServiceAuthKeyDescription {
  readonly kid: string;
  readonly secretBytes: number;
  readonly active: boolean;
}

export class ServiceAuthKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceAuthKeyError";
  }
}

/**
 * سجلُّ مفاتيحَ مُتحقَّقٌ منه عندَ البناء. **يُفشِل الإقلاعَ لا الطلبَ.**
 */
export class ServiceAuthKeyRegistry {
  private readonly byKid: Map<string, string>;
  readonly activeKid: string;

  constructor(options: ServiceAuthKeyRegistryOptions) {
    const { keys, activeKid } = options;

    if (keys.length === 0) {
      throw new ServiceAuthKeyError("سجلُّ مفاتيحِ هويّةِ الخدمةِ فارغٌ.");
    }

    const byKid = new Map<string, string>();
    for (const key of keys) {
      if (!KID_PATTERN.test(key.kid)) {
        throw new ServiceAuthKeyError(
          `معرِّفُ المفتاحِ «${key.kid}» لا يطابق الصيغةَ المسموحة.`,
        );
      }
      if (byKid.has(key.kid)) {
        throw new ServiceAuthKeyError(
          `معرِّفُ المفتاحِ «${key.kid}» مكرَّرٌ في السجلّ.`,
        );
      }
      const bytes = Buffer.byteLength(key.secret, "utf8");
      if (bytes < MIN_SECRET_BYTES) {
        // لا يُطبَع السرُّ ولا جزءٌ منه — الطولُ وحدَه يكفي للتشخيص.
        throw new ServiceAuthKeyError(
          `سرُّ المفتاحِ «${key.kid}» أقصرُ من الحدِّ الأدنى: ${bytes} بايتاً < ${MIN_SECRET_BYTES}.`,
        );
      }
      byKid.set(key.kid, key.secret);
    }

    if (!byKid.has(activeKid)) {
      throw new ServiceAuthKeyError(
        `المفتاحُ النشطُ «${activeKid}» غيرُ موجودٍ في المفاتيحِ المعروفة.`,
      );
    }

    this.byKid = byKid;
    this.activeKid = activeKid;
  }

  /** سرُّ المفتاحِ النشطِ — للمِنتاجِ وحدَه. */
  activeSecret(): string {
    // موجودٌ بالضرورةِ: تحقَّق البناءُ منه.
    return this.byKid.get(this.activeKid) as string;
  }

  /**
   * سرُّ مفتاحٍ بمعرِّفِه، أو `undefined` إن كان مجهولاً.
   *
   * **حدٌّ مُعلَنٌ:** يُقرأ `kid` من حِمْلٍ **لم يُتحقَّق من توقيعِه بعدُ** —
   * وهذا لا مَهرَبَ منه في أيِّ نظامٍ يدوِّر مفاتيحَه. وهو غيرُ مؤثِّرٍ لأنّ
   * `kid` لا يفعل شيئاً غيرَ **اختيارِ** مفتاحٍ؛ فمُهاجمٌ يختار أيَّ معرِّفٍ
   * يقع على مفتاحٍ لا يملكه، فيُخفِق التوقيعُ. ولا يُشتَقُّ من `kid` أيُّ قرارِ
   * تفويضٍ ولا هويّةٍ.
   */
  secretFor(kid: string): string | undefined {
    return this.byKid.get(kid);
  }

  /** وصفٌ آمنٌ للتسجيلِ عندَ الإقلاع. */
  describeKeys(): readonly ServiceAuthKeyDescription[] {
    return [...this.byKid.entries()].map(([kid, secret]) => ({
      kid,
      secretBytes: Buffer.byteLength(secret, "utf8"),
      active: kid === this.activeKid,
    }));
  }
}

/**
 * يقرأ السجلَّ من متغيّرِ بيئةٍ بصيغةِ `kid:secret` مفصولةً بفاصلة، والمفتاحُ
 * النشطُ من متغيّرٍ ثانٍ. صيغةٌ نصّيّةٌ بسيطةٌ بقصدٍ: JSON في متغيّرِ بيئةٍ
 * يُفسَد بالاقتباسِ في أدواتِ النشرِ، والفسادُ الصامتُ في مفتاحٍ أسوأُ من صيغةٍ فقيرة.
 */
export function keyRegistryFromEnv(
  env: Record<string, string | undefined>,
  options?: { keysVar?: string; activeVar?: string },
): ServiceAuthKeyRegistry {
  const keysVar = options?.keysVar ?? "WASLA_SERVICE_AUTH_KEYS";
  const activeVar = options?.activeVar ?? "WASLA_SERVICE_AUTH_ACTIVE_KID";

  const raw = env[keysVar];
  if (raw === undefined || raw.trim() === "") {
    throw new ServiceAuthKeyError(`المتغيّرُ ${keysVar} مفقودٌ أو فارغٌ.`);
  }

  const keys: ServiceAuthKey[] = [];
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const separator = trimmed.indexOf(":");
    if (separator <= 0 || separator === trimmed.length - 1) {
      throw new ServiceAuthKeyError(
        `مدخلٌ في ${keysVar} لا يطابق الصيغةَ «kid:secret».`,
      );
    }
    keys.push({
      kid: trimmed.slice(0, separator),
      secret: trimmed.slice(separator + 1),
    });
  }

  const activeKid = env[activeVar]?.trim();
  if (activeKid === undefined || activeKid === "") {
    throw new ServiceAuthKeyError(`المتغيّرُ ${activeVar} مفقودٌ أو فارغٌ.`);
  }

  return new ServiceAuthKeyRegistry({ keys, activeKid });
}

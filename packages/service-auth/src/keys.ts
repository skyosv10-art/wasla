/**
 * سجلُّ مفاتيحِ هويّةِ الخدمة (M1-03) — «machine credentials» في المرحلة B1.
 *
 * القراراتُ الحاكمة: [ADR-020](../../../docs/15-decisions/ADR-020-service-to-service-identity.md)
 * (الاختيار)، و[ADR-022](../../../docs/15-decisions/ADR-022-service-auth-key-lifecycle.md)
 * (دورةُ حياةِ المفتاحِ)، والإجراءُ التنفيذيُّ في
 * [دليلِ التدوير](../../../docs/14-runbooks/SERVICE_AUTH_KEY_ROTATION.md).
 *
 * أربعُ خصائصَ لهذا السجلِّ مقصودةٌ ولها سببٌ مكتوبٌ:
 *
 * 1. **يُبنى مرّةً عندَ الإقلاعِ ويرفض المفتاحَ الضعيفَ فوراً.** فمفتاحٌ قصيرٌ
 *    ليس خطأَ طلبٍ يُرَدُّ بـ401؛ هو خطأُ نشرٍ يجب أن يُسقِط العمليّةَ قبلَ أن
 *    تستقبلَ طلباً واحداً. والفشلُ المتأخِّرُ هنا يعني خدمةً «تعمل» بمفتاحٍ
 *    قابلٍ للتخمين.
 * 2. **`kid` صريحٌ ومتعدِّدٌ.** التدويرُ بلا معرِّفِ مفتاحٍ يعني نافذةَ انقطاعٍ:
 *    إمّا تُقبَل المفاتيحُ كلُّها بالتجربةِ (وهو ما يُخفي مفتاحاً مسروقاً)،
 *    وإمّا يُوقَف كلُّ نداءٍ داخليٍّ لحظةَ التبديل. فالمُتحقِّقُ يعرف مفاتيحَ
 *    عدّةً، والمِنتاجُ يُوقِّع بالمفتاحِ النشطِ وحدَه.
 * 3. **لكلِّ مفتاحٍ حالٌ مُعلَنٌ، والحالُ إلزاميٌّ لا افتراضيٌّ.** والحالاتُ ثلاثٌ:
 *    `active` (يُوقِّع ويتحقَّق) · `verify_only` (يتحقَّق ولا يُوقِّع) · `revoked`
 *    (يُرفَض باسمِه). والإلزامُ مقصودٌ: لو كان الحالُ افتراضيّاً لبقيَ مفتاحٌ
 *    قديمٌ صالحاً للتوقيعِ سنةً بعدَ تدويرِه بلا أن يقولَ أحدٌ ذلك.
 * 4. **لا يُطبَع سرٌّ ولا يُخرَج.** `describeKeys` يُظهِر المعرِّفاتَ والأطوالَ
 *    والحالاتِ فقط، كي يكون في السجلِّ ما يُشخِّص «أيُّ مفتاحٍ استُخدم» بلا أن
 *    يكون فيه ما يُنتحَل به.
 *
 * ── ولماذا `revoked` حالٌ لا حَذفٌ ─────────────────────────────────────────
 * حذفُ المفتاحِ المسروقِ من الإعدادِ كان سيجعل رفضَه يبدو في السجلِّ **كخطأٍ
 * مطبعيٍّ** (`unknown_key`) لا كاستخدامِ مفتاحٍ مسحوبٍ. والفرقُ هو الفرقُ بينَ
 * «مُنادٍ أخطأ في إعدادِه» و«أحدٌ يستعمل مفتاحاً سرقناه منه» — وهو أوّلُ سؤالٍ
 * يُسأل في تحقيقِ حادثةٍ. فيبقى المعرِّفُ مُعلَناً مسحوباً، **ويُحذَف سرُّه**:
 * المفتاحُ المسحوبُ لا يحتاج سرَّه في الإعدادِ ولا يجوز أن يبقى فيه.
 */

/** الحدُّ الأدنى لطولِ سرِّ المفتاح. 32 بايتاً = مساحةُ HMAC-SHA256 الكاملة. */
export const MIN_SECRET_BYTES = 32;

/** صيغةُ معرِّفِ المفتاح: حروفٌ وأرقامٌ وشرطتانِ، 1..64 — لا فراغَ ولا نقطة. */
const KID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * حالُ المفتاحِ في دورةِ حياتِه (ADR-022 §3):
 * - `active`: يُوقَّع به ويُتحقَّق منه. **واحدٌ لا أكثر.**
 * - `verify_only`: يُتحقَّق منه ولا يُوقَّع — نافذةُ التحقُّقِ المزدوجِ أثناءَ التدوير.
 * - `revoked`: يُرفَض باسمِه (`revoked_key`) ولا يُقبَل توقيعُه.
 */
export type ServiceAuthKeyStatus = "active" | "verify_only" | "revoked";

/** الحالاتُ المقبولةُ نصّاً — تُستعمل في تحليلِ متغيّرِ البيئة. */
export const SERVICE_AUTH_KEY_STATUSES: readonly ServiceAuthKeyStatus[] = [
  "active",
  "verify_only",
  "revoked",
];

export interface ServiceAuthKey {
  /** معرِّفُ المفتاحِ كما يظهر في حِمْلِ الرمز. */
  readonly kid: string;
  /**
   * السرُّ المشترك. لا يُسجَّل ولا يُخرَج. ويجوز أن يكون فارغاً **للمسحوبِ
   * وحدَه** — بل هو المطلوبُ فيه.
   */
  readonly secret: string;
  /** الحالُ. **إلزاميٌّ**: لا حالَ افتراضيٌّ لمفتاحِ توقيعٍ. */
  readonly status: ServiceAuthKeyStatus;
}

export interface ServiceAuthKeyRegistryOptions {
  /** المفاتيحُ المعروفةُ. لا يُقبَل تكرارُ `kid`. */
  readonly keys: readonly ServiceAuthKey[];
  /** معرِّفُ المفتاحِ الذي يُوقَّع به. يجب أن يكون في `keys` وحالُه `active`. */
  readonly activeKid: string;
}

/** وصفٌ آمنٌ للسجلِّ — بلا أسرارٍ. */
export interface ServiceAuthKeyDescription {
  readonly kid: string;
  readonly secretBytes: number;
  readonly status: ServiceAuthKeyStatus;
  readonly active: boolean;
}

/**
 * نتيجةُ البحثِ عن مفتاحِ تحقُّقٍ. **ثلاثُ حالاتٍ لا اثنتانِ**: الفرقُ بينَ
 * «لا أعرفه» و«أعرفه وسحبتُه» فرقٌ تشخيصيٌّ لا تجميليٌّ (ADR-022 §5).
 */
export type ServiceAuthKeyResolution =
  | { readonly status: "usable"; readonly secret: string }
  | { readonly status: "revoked" }
  | { readonly status: "unknown" };

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
  private readonly byKid: Map<string, { secret: string; status: ServiceAuthKeyStatus }>;
  readonly activeKid: string;

  constructor(options: ServiceAuthKeyRegistryOptions) {
    const { keys, activeKid } = options;

    if (keys.length === 0) {
      throw new ServiceAuthKeyError("سجلُّ مفاتيحِ هويّةِ الخدمةِ فارغٌ.");
    }

    const byKid = new Map<string, { secret: string; status: ServiceAuthKeyStatus }>();
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
      if (!SERVICE_AUTH_KEY_STATUSES.includes(key.status)) {
        throw new ServiceAuthKeyError(
          `حالُ المفتاحِ «${key.kid}» غيرُ معروفٍ: «${String(key.status)}».`,
        );
      }
      if (key.status === "revoked") {
        // السرُّ لا يُقرأ للمسحوبِ أصلاً، فلا يُشترَط طولُه — ويُطرَح من الذاكرةِ
        // كي لا يبقى سرٌّ مسحوبٌ في مساحةِ العمليّةِ بلا أيِّ استعمالٍ له.
        byKid.set(key.kid, { secret: "", status: "revoked" });
        continue;
      }
      const bytes = Buffer.byteLength(key.secret, "utf8");
      if (bytes < MIN_SECRET_BYTES) {
        // لا يُطبَع السرُّ ولا جزءٌ منه — الطولُ وحدَه يكفي للتشخيص.
        throw new ServiceAuthKeyError(
          `سرُّ المفتاحِ «${key.kid}» أقصرُ من الحدِّ الأدنى: ${bytes} بايتاً < ${MIN_SECRET_BYTES}.`,
        );
      }
      byKid.set(key.kid, { secret: key.secret, status: key.status });
    }

    const activeKids = [...byKid.entries()].filter(
      ([, value]) => value.status === "active",
    );
    if (activeKids.length === 0) {
      throw new ServiceAuthKeyError(
        "لا مفتاحَ حالُه active — فلا يستطيع المِنتاجُ أن يُوقِّع.",
      );
    }
    if (activeKids.length > 1) {
      // مفتاحانِ نشطانِ ليسا «مرونةً»: هما غموضٌ في أيِّهما وُقِّع به، وهو ما
      // يُفسِد التحقيقَ عندَ الحادثةِ ويُطيل عمرَ مفتاحٍ كان يجب أن يُتقاعَد.
      throw new ServiceAuthKeyError(
        `أكثرُ من مفتاحٍ حالُه active: ${activeKids.map(([kid]) => kid).join(" · ")}.`,
      );
    }

    const activeEntry = byKid.get(activeKid);
    if (activeEntry === undefined) {
      throw new ServiceAuthKeyError(
        `المفتاحُ النشطُ «${activeKid}» غيرُ موجودٍ في المفاتيحِ المعروفة.`,
      );
    }
    if (activeEntry.status !== "active") {
      throw new ServiceAuthKeyError(
        `المفتاحُ النشطُ «${activeKid}» حالُه «${activeEntry.status}» لا «active».`,
      );
    }

    this.byKid = byKid;
    this.activeKid = activeKid;
  }

  /** سرُّ المفتاحِ النشطِ — للمِنتاجِ وحدَه. */
  activeSecret(): string {
    // موجودٌ بالضرورةِ: تحقَّق البناءُ منه.
    return (this.byKid.get(this.activeKid) as { secret: string }).secret;
  }

  /**
   * يبحث عن مفتاحِ تحقُّقٍ بمعرِّفِه ويُخبِر بحالِه.
   *
   * **حدٌّ مُعلَنٌ:** يُقرأ `kid` من حِمْلٍ **لم يُتحقَّق من توقيعِه بعدُ** —
   * وهذا لا مَهرَبَ منه في أيِّ نظامٍ يدوِّر مفاتيحَه. وهو غيرُ مؤثِّرٍ لأنّ
   * `kid` لا يفعل شيئاً غيرَ **اختيارِ** مفتاحٍ؛ فمُهاجمٌ يختار أيَّ معرِّفٍ
   * يقع على مفتاحٍ لا يملكه، فيُخفِق التوقيعُ. ولا يُشتَقُّ من `kid` أيُّ قرارِ
   * تفويضٍ ولا هويّةٍ.
   */
  resolveVerificationKey(kid: string): ServiceAuthKeyResolution {
    const entry = this.byKid.get(kid);
    if (entry === undefined) return { status: "unknown" };
    if (entry.status === "revoked") return { status: "revoked" };
    return { status: "usable", secret: entry.secret };
  }

  /** المفاتيحُ التي يُقبَل التحقُّقُ بها الآنَ — للتشخيصِ لا للقرار. */
  verifiableKids(): readonly string[] {
    return [...this.byKid.entries()]
      .filter(([, value]) => value.status !== "revoked")
      .map(([kid]) => kid);
  }

  /** وصفٌ آمنٌ للتسجيلِ عندَ الإقلاع. */
  describeKeys(): readonly ServiceAuthKeyDescription[] {
    return [...this.byKid.entries()].map(([kid, value]) => ({
      kid,
      secretBytes: Buffer.byteLength(value.secret, "utf8"),
      status: value.status,
      active: kid === this.activeKid,
    }));
  }
}

/**
 * يقرأ السجلَّ من متغيّرِ بيئةٍ بصيغةِ **`kid:status:secret`** مفصولةً بفاصلةٍ،
 * والمفتاحُ النشطُ من متغيّرٍ ثانٍ. صيغةٌ نصّيّةٌ بسيطةٌ بقصدٍ: JSON في متغيّرِ
 * بيئةٍ يُفسَد بالاقتباسِ في أدواتِ النشرِ، والفسادُ الصامتُ في مفتاحٍ أسوأُ من
 * صيغةٍ فقيرة.
 *
 * والحالُ في **وسطِ** المدخلِ لا في آخرِه كي لا يُخلَط بالسرِّ الذي قد يحتوي
 * `:`؛ فأوّلُ فاصلَتَينِ حدودٌ، وما بعدَهما سرٌّ حرفيٌّ كما هو.
 *
 * والصيغةُ القديمةُ `kid:secret` **تُرفَض برسالةٍ تُسمّي التغييرَ** لا برسالةٍ
 * غامضةٍ: المُشغِّلُ الذي يُحدِّث نشرَه يجب أن يقرأ سببَ الرفضِ في السطرِ الأوّل.
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

    const firstSeparator = trimmed.indexOf(":");
    if (firstSeparator <= 0) {
      throw new ServiceAuthKeyError(
        `مدخلٌ في ${keysVar} لا يطابق الصيغةَ «kid:status:secret».`,
      );
    }
    const secondSeparator = trimmed.indexOf(":", firstSeparator + 1);
    if (secondSeparator < 0) {
      throw new ServiceAuthKeyError(
        `مدخلٌ في ${keysVar} بلا حالٍ. الصيغةُ صارت «kid:status:secret» ` +
          `(${SERVICE_AUTH_KEY_STATUSES.join(" · ")}) — راجع دليلَ التدوير.`,
      );
    }

    const kid = trimmed.slice(0, firstSeparator);
    const statusText = trimmed.slice(firstSeparator + 1, secondSeparator);
    const secret = trimmed.slice(secondSeparator + 1);

    if (!isKeyStatus(statusText)) {
      throw new ServiceAuthKeyError(
        `حالُ المفتاحِ «${kid}» غيرُ معروفٍ: «${statusText}». ` +
          `المسموحُ: ${SERVICE_AUTH_KEY_STATUSES.join(" · ")}.`,
      );
    }
    if (statusText !== "revoked" && secret === "") {
      throw new ServiceAuthKeyError(`سرُّ المفتاحِ «${kid}» فارغٌ.`);
    }

    keys.push({ kid, status: statusText, secret });
  }

  const activeKid = env[activeVar]?.trim();
  if (activeKid === undefined || activeKid === "") {
    throw new ServiceAuthKeyError(`المتغيّرُ ${activeVar} مفقودٌ أو فارغٌ.`);
  }

  return new ServiceAuthKeyRegistry({ keys, activeKid });
}

function isKeyStatus(value: string): value is ServiceAuthKeyStatus {
  return (SERVICE_AUTH_KEY_STATUSES as readonly string[]).includes(value);
}

/**
 * `@wasla/config` — القراءةُ الواحدةُ للبيئةِ: تُسمّي المتغيّرَ وتُلقي، ولا تُخرِجُ `NaN`. (M2-04)
 *
 * ── لماذا توجد هذه الحزمة ─────────────────────────────────────────────
 * قِيسَ على `main` قبلَ العملِ: `services/dispatch/src/http/server.ts` كانَ يقرأُ
 * قواعدَ الإرسالِ الأربعَ بـ`Number(process.env.X ?? n)`. و`Number` **لا يُلقي**:
 *
 *   Number("ثلاثة") ⇒ NaN     Number("") ⇒ 0     Number("0x10") ⇒ 16
 *   Number(" 12 ") ⇒ 12       Number("1e3") ⇒ 1000
 *
 * فـ`DISPATCH_WAVE_SIZE=٣` (بأرقامٍ عربيّةٍ-هنديّةٍ) يُنتِجُ `waveSize = NaN`،
 * و`waveSize = NaN` يُنتِجُ موجةً بلا سائقٍ **والخدمةُ حيّةٌ تُجيبُ 200 على
 * صحّتِها**. لا `tsc` يراهُ (`NaN` نوعُهُ `number`)، ولا اختبارٌ يراهُ (كلُّ اختبارٍ
 * يبني قواعدَهُ بنفسِهِ)، ولا مُشغِّلٌ يراهُ (لا سجلَّ ولا صياحَ). وهذا هوَ
 * `RISK-0046` بحرفِهِ.
 *
 * وكانَ في المستودعِ **أربعُ نسخٍ** من القارئِ الصارمِ (`delivery/ops` ·
 * `delivery/domain` · `marketplace/http` · `bot-runtime`) بأربعِ صيغِ رسائلَ ولا
 * واحدةَ مرجعٌ — فالصرامةُ كانت صدفةَ ملفٍّ لا قاعدةَ مستودعٍ. وهذهِ الحزمةُ
 * **القاعدةُ**: أرقامٌ عشريّةٌ صريحةٌ وحدَها، وحدودٌ مفروضةٌ، ورسالةٌ تسمّي
 * المتغيّرَ والقيمةَ المقروءةَ — فالإخفاقُ عندَ الإقلاعِ لا بعدَ أوّلِ نداءٍ.
 *
 * ── الحدُّ المُعلَن ────────────────────────────────────────────────────
 * هذهِ الحزمةُ تقرأُ **حُقنةً** لا `process.env` مباشرةً: الجذورُ تُمرِّرُ البيئةَ،
 * فالاختبارُ يقيسُ بلا تلويثِ عمليّةٍ. ولا تعرفُ أيَّ متغيّرٍ **يجبُ** أن يوجدَ —
 * ذاكَ سجلُّ `packages/config/env-registry.json` والفحصُ 18.
 *
 * المرجع: docs/08-infrastructure/CONFIG_SCHEMA.md · ADR-032 · RISK-0046
 */

export * from "./registry.generated.js";

/** ما تحتاجُهُ القراءةُ من البيئةِ — قابلٌ للحقنِ في الاختبارِ. */
export type EnvBag = Readonly<Record<string, string | undefined>>;

/**
 * خطأُ إعدادٍ يحملُ **اسمَ المتغيّرِ** لا نصّاً عامّاً.
 *
 * والاسمُ في الحقلِ لا في الرسالةِ وحدَها: مُشغِّلٌ يقرأُ سجلّاً منظَّماً يُرشِّحُ
 * بالحقلِ، ورسالةٌ وحدَها تُجبِرُهُ على التعبيرِ النمطيِّ.
 */
export class ConfigError extends Error {
  readonly variable: string;
  readonly rawValue: string | undefined;

  constructor(variable: string, message: string, rawValue?: string) {
    super(`${variable}: ${message}`);
    this.name = "ConfigError";
    this.variable = variable;
    this.rawValue = rawValue;
  }
}

/** القيمةُ الخامُّ بعدَ تشذيبٍ: الفراغُ يُقرأُ «غائباً» لا «نصّاً فارغاً». */
export function readRawEnv(env: EnvBag, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** متغيّرٌ إلزاميٌّ: غيابُهُ إخفاقٌ باسمِهِ عندَ الإقلاعِ. */
export function requireEnv(env: EnvBag, name: string): string {
  const value = readRawEnv(env, name);
  if (value === undefined) {
    throw new ConfigError(name, "متغيّرٌ إلزاميٌّ مفقودٌ أو فارغٌ");
  }
  return value;
}

/** نصٌّ اختياريٌّ بقيمةٍ افتراضيّةٍ مُعلَنةٍ. */
export function readStringEnv(env: EnvBag, name: string, fallback: string): string {
  return readRawEnv(env, name) ?? fallback;
}

export interface IntEnvOptions {
  /** الحدُّ الأدنى المقبولُ (شاملٌ). الافتراضيُّ 0. */
  readonly min?: number;
  /** الحدُّ الأعلى المقبولُ (شاملٌ). */
  readonly max?: number;
  /** القيمةُ عندَ الغيابِ. غيابُها يجعلُ المتغيّرَ إلزاميّاً. */
  readonly fallback?: number;
}

/**
 * عددٌ صحيحٌ من أرقامٍ عشريّةٍ صريحةٍ وحدَها.
 *
 * و`Number.isInteger(Number(raw))` **لا يكفي**: يقبلُ `"0x10"` (⇒ 16) و`"1e3"`
 * (⇒ 1000). ومن كتبَ `0x10` في جَدوَلِهِ يقصدُ عشرةً غالباً — فيأخذُ ستّةَ عشرَ
 * صامتاً. ولذلكَ التعبيرُ النمطيُّ لا الدالّةُ المُدمَجةُ.
 */
export function readIntEnv(
  env: EnvBag,
  name: string,
  options: IntEnvOptions = {},
): number {
  const { min = 0, max, fallback } = options;
  const raw = readRawEnv(env, name);
  if (raw === undefined) {
    if (fallback === undefined) {
      throw new ConfigError(name, "متغيّرٌ رقميٌّ إلزاميٌّ مفقودٌ أو فارغٌ");
    }
    return fallback;
  }
  if (!/^[0-9]+$/.test(raw)) {
    throw new ConfigError(
      name,
      `يجبُ أن يكونَ عدداً صحيحاً بأرقامٍ عشريّةٍ (القيمةُ المقروءةُ: ${JSON.stringify(raw)})`,
      raw,
    );
  }
  const value = Number(raw);
  if (value < min) {
    throw new ConfigError(name, `القيمةُ ${value} أقلُّ من الحدِّ الأدنى ${min}`, raw);
  }
  if (max !== undefined && value > max) {
    throw new ConfigError(name, `القيمةُ ${value} أكبرُ من الحدِّ الأعلى ${max}`, raw);
  }
  return value;
}

/**
 * عددٌ صحيحٌ **متسامحٌ**: قيمةٌ غيرُ مقروءةٍ تُهمَلُ إلى `undefined`.
 *
 * ولِمَ يوجدُ متسامحٌ ولا يُنقِضُ ذلكَ صرامةَ الحزمةِ: قرارانِ مكتوبانِ في
 * جذرَي `customers` و`delivery` يقولانِ إنَّ **مهلةً ثانويّةً** غيرَ مقروءةٍ
 * تسقطُ إلى الافتراضِ بدلَ إسقاطِ الإقلاعِ على حقلٍ لا يمسُّ الصوابَ. فالفرقُ
 * بينَ هذا و`Number(...)` العاري ليسَ في النتيجةِ بل في **مَن يقرِّرُ**: هنا
 * التسامحُ **مُسمّىً في اسمِ الدالّةِ ومُعلَنٌ في السجلِّ**، وهناكَ كانَ صمتاً
 * لا يُقرأُ. ولا تُستعملُ لعددٍ يمسُّ قراراً (حجمُ موجةٍ · منفذٌ · مهلةُ مسبارٍ).
 */
export function readLenientIntEnv(
  env: EnvBag,
  name: string,
  options: { readonly min?: number } = {},
): number | undefined {
  const { min = 1 } = options;
  const raw = readRawEnv(env, name);
  if (raw === undefined || !/^[0-9]+$/.test(raw)) return undefined;
  const value = Number(raw);
  return value >= min ? value : undefined;
}

/**
 * منفذٌ صالحٌ (1..65535).
 *
 * ومنفذٌ غيرُ صالحٍ يُسقِطُ الإقلاعَ: الاستماعُ على منفذٍ آخرَ بصمتٍ يجعلُ بوّابةً
 * تقولُ «الخدمةُ ساقطةٌ» والخدمةُ حيّةٌ على عنوانٍ لا يعرفُهُ أحدٌ.
 */
export function readPortEnv(env: EnvBag, name: string, fallback?: number): number {
  return readIntEnv(env, name, { min: 1, max: 65535, fallback });
}

export interface UrlEnvOptions {
  /** البروتوكولاتُ المقبولةُ بنقطتَيها، مثلُ `["https:"]`. */
  readonly protocols?: readonly string[];
  readonly fallback?: string;
}

/** عنوانٌ صالحٌ ببروتوكولٍ مُعلَنٍ — لا نصٌّ يُشبِهُ العنوانَ. */
export function readUrlEnv(env: EnvBag, name: string, options: UrlEnvOptions = {}): string {
  const { protocols = ["http:", "https:"], fallback } = options;
  const raw = readRawEnv(env, name);
  if (raw === undefined) {
    if (fallback === undefined) {
      throw new ConfigError(name, "عنوانٌ إلزاميٌّ مفقودٌ أو فارغٌ");
    }
    return fallback;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(name, `ليسَ عنواناً صالحاً (${JSON.stringify(raw)})`, raw);
  }
  if (!protocols.includes(url.protocol)) {
    throw new ConfigError(
      name,
      `البروتوكولُ ${url.protocol} غيرُ مقبولٍ — المقبولُ: ${protocols.join(" · ")}`,
      raw,
    );
  }
  return raw;
}

/** وصلةُ Postgres: بروتوكولٌ مُلزَمٌ، ولا تُطبَعُ القيمةُ في أيِّ رسالةٍ. */
export function readPostgresUrlEnv(env: EnvBag, name: string): string | undefined {
  const raw = readRawEnv(env, name);
  if (raw === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // لا تُطبَعُ القيمةُ: قد تحملُ كلمةَ مرورٍ، والسجلُّ يُقرأُ في مواضعَ كثيرةٍ.
    throw new ConfigError(name, "ليسَ وصلةَ Postgres صالحةً (القيمةُ محجوبةٌ)");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new ConfigError(name, `البروتوكولُ ${url.protocol} ليسَ postgres/postgresql`);
  }
  return raw;
}

/** قائمةٌ بفواصلَ بلا فراغاتٍ ولا مُكرَّرٍ ولا عنصرٍ فارغٍ. */
export function readCsvEnv(env: EnvBag, name: string): readonly string[] {
  const raw = readRawEnv(env, name);
  if (raw === undefined) return [];
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.some((part) => part === "")) {
    throw new ConfigError(name, "قائمةٌ فيها عنصرٌ فارغٌ — فاصلةٌ زائدةٌ أو مُكرَّرةٌ", raw);
  }
  return Array.from(new Set(parts));
}

/** رايةٌ: `1` حرفاً وحدَهُ يُفعِّلُ — فلا خلافَ في تفسيرِ `"false"`. */
export function readFlagEnv(env: EnvBag, name: string): boolean {
  return readRawEnv(env, name) === "1";
}

/**
 * @wasla/auth-sdk — نموذجُ `Principal` الموحَّدُ لكلِّ حدودِ WASLA.
 *
 * المرجعُ الحاكم: docs/15-decisions/ADR-018-unified-principal-model-and-user-service-boundary.md
 * عنصرُ العمل: M1-01.
 *
 * القاعدةُ البنيويّة: **كلُّ طلبٍ يعبر حدَّ خدمةٍ يحمل `Principal` واحداً لا أكثر.**
 * لا يوجد «طلبٌ بلا هوية»: غيابُ الإثباتِ يُمثَّل صراحةً بـ`AnonymousPrincipal`
 * كي لا يكون `undefined` بابَ تجاوزٍ صامتاً (وهو أصلُ ثغرةِ الحدودِ AUD-004).
 *
 * ولا يُبنى هذا الملفُّ على مُصدِرِ رموزٍ بعينه: التحقُّقُ من التوقيعِ والانتهاءِ
 * مسؤوليّةُ المُتحقِّق (M1-02 للجلساتِ البشريّة، M1-03 لهويّةِ الخدمة)، وهذا
 * النموذجُ هو **الشكلُ الذي يُسلَّم بعدَ التحقُّق** — لا وسيلةَ التحقُّق نفسها.
 */

/** جنسُ صاحبِ الطلب. ثلاثةٌ حصراً، ولا رابعَ بلا ADR. */
export type PrincipalKind = "user" | "service" | "anonymous";

/**
 * أنواعُ الفاعلِ البشريِّ (roadmap §7 B2). لا تُضاف قيمةٌ هنا بلا سطرٍ في
 * مصفوفةِ التفويض (M1-05)، وإلّا صار للفاعلِ وجودٌ بلا صلاحيّاتٍ معروفة.
 */
export type UserActorType =
  | "customer"
  | "driver"
  | "partner"
  | "admin"
  | "support";

/** القناةُ التي وصل منها الفاعلُ البشريّ. تُستخدَم في قيودِ القناةِ لا في التفويض. */
export type PrincipalChannel = "telegram" | "web" | "mobile" | "admin_web";

/** الحقولُ المشتركةُ بين كلِّ الأجناس. */
interface PrincipalBase {
  readonly kind: PrincipalKind;
  /**
   * لحظةُ إصدارِ الإثباتِ (ISO-8601 UTC). موجودةٌ للتدقيقِ لا للتفويض.
   * غيرُ موجودةٍ في المجهولِ لأنّه لا إثباتَ له.
   */
  readonly issuedAt?: string;
  /** لحظةُ انتهاءِ الإثبات (ISO-8601 UTC). غيابُها في غيرِ المجهولِ خطأُ تحقُّق. */
  readonly expiresAt?: string;
}

/**
 * طلبٌ بلا إثباتِ هويّةٍ مقبولٍ. يُبنى صراحةً ولا يُستنتَج من `null`.
 * لا يحمل صلاحيّاتٍ إطلاقاً: `hasScope` عليه `false` دائماً.
 */
export interface AnonymousPrincipal extends PrincipalBase {
  readonly kind: "anonymous";
  /** سببُ كونِه مجهولاً — للتشخيصِ لا للتفويض. */
  readonly reason: "no_credentials" | "unverified_credentials";
}

/** فاعلٌ بشريٌّ أثبتَ جلسةً صالحة. */
export interface UserPrincipal extends PrincipalBase {
  readonly kind: "user";
  /**
   * المعرِّفُ العامُّ الثابتُ للمستخدم (`identity_users.wasla_public_id`).
   * هو المعرِّفُ الوحيدُ الذي يُسمح بتسجيلِه أو إظهارِه.
   */
  readonly waslaPublicId: string;
  /**
   * المعرِّفُ الداخليُّ (UUID). **يُمنع تسجيلُه أو إخراجُه في أيِّ استجابة** —
   * `describePrincipal` يحجبه، والقاعدةُ في docs/00-rules/SECURITY_RULES.md §11.
   */
  readonly internalUuid: string;
  readonly actor: UserActorType;
  readonly channel: PrincipalChannel;
  /** معرِّفُ الجلسةِ الذي يُبطَل عندَ السحب (M1-02). */
  readonly sessionId: string;
  /** الأدوارُ المُصرَّحُ بها. تُقرأ ولا تُشتَق داخلَ الخدمات. */
  readonly roles: readonly string[];
  /** الصلاحيّاتُ الفعليّةُ بصيغةِ `<service>:<resource>:<action>`. */
  readonly scopes: readonly string[];
  /** المستأجرُ (متجرٌ أو شريك) عندَ الفاعلِ المرتبطِ بجهةٍ واحدة. */
  readonly tenantId?: string;
}

/** خدمةٌ داخليّةٌ تتحدَّث إلى خدمةٍ أخرى (workload identity). */
export interface ServicePrincipal extends PrincipalBase {
  readonly kind: "service";
  /**
   * اسمُ الخدمةِ المُصدِرةِ للطلبِ كما هو في `services/<name>` — لا اسمٌ حرٌّ.
   */
  readonly serviceName: string;
  /** الخدمةُ المقصودةُ بالطلب. يمنع إعادةَ استخدامِ الرمزِ على حدٍّ آخر. */
  readonly audience: string;
  readonly scopes: readonly string[];
  /**
   * فاعلٌ بشريٌّ يُنفَّذ الطلبُ نيابةً عنه، إن كان الطلبُ سلسلةً من طلبِ مستخدم.
   * يحمل المعرِّفَ العامَّ فقط — لا الداخليَّ — كي لا يعبرَ المعرِّفُ الداخليُّ الحدود.
   */
  readonly onBehalfOfPublicId?: string;
}

/** الاتّحادُ الحاكم. أيُّ حدٍّ يستقبل هذا النوعَ لا نوعاً أوسع. */
export type Principal = AnonymousPrincipal | UserPrincipal | ServicePrincipal;

// ─────────────────────────────── حُرّاسُ النوع ───────────────────────────────

export function isUserPrincipal(p: Principal): p is UserPrincipal {
  return p.kind === "user";
}

export function isServicePrincipal(p: Principal): p is ServicePrincipal {
  return p.kind === "service";
}

export function isAnonymousPrincipal(p: Principal): p is AnonymousPrincipal {
  return p.kind === "anonymous";
}

/** الشكلُ الوحيدُ المقبولُ للمجهول. دالّةٌ لا ثابتٌ مُصدَّرٌ كي لا يُطفَّر. */
export function anonymous(
  reason: AnonymousPrincipal["reason"] = "no_credentials",
): AnonymousPrincipal {
  return { kind: "anonymous", reason };
}

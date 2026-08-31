/**
 * جانبُ المُنادي: مُوقِّعٌ واحدٌ لكلِّ نداءٍ صادرٍ (M1-03 · الفجوةُ الثالثة).
 *
 * ── لِمَ دالّةٌ تُحقَن ولا سجلُّ مفاتيحَ يُمرَّر إلى كلِّ عميل ────────────────
 * لو أخذَ كلُّ عميلٍ خارجٍ سجلَّ المفاتيحِ لصار كلُّ عميلٍ موضعاً يُصنَع فيه
 * رمزٌ، فتكرَّرَ قرارُ «ما جمهورُ الرمزِ · ما صلاحيّاتُه · أيَّ ساعةٍ نقرأ» في
 * أحدَ عشرَ ملفاً — وأوّلُ ملفٍ يُخطئ في أحدِها يصنع بابَ تجاوزٍ لا يُرى في
 * مراجعةٍ. والدالّةُ تُبنى مرّةً في جذرِ التركيبِ وتُحقَن، فيكون العميلُ
 * **مُستهلِكاً للتوقيعِ لا مُنتِجاً له**، ويكون الحقنُ نفسُه ما يُحصيه حارسُ
 * التغطيةِ في `scripts/checks/validate-service-auth-coverage.sh`.
 *
 * ── ولِمَ لا يُعاد استعمالُ رمزٍ واحدٍ لعدّةِ نداءاتٍ ───────────────────────
 * لأنّ الرمزَ مربوطٌ بطريقةٍ ومسارٍ ويحمل `jti` يُحرَق عندَ أوّلِ استعمالٍ
 * (ADR-021). فإعادةُ استعمالِه ليست تحسيناً بل رفضٌ مضمونٌ من الحدِّ. والتوقيعُ
 * `HMAC-SHA256` على نصٍّ قصيرٍ، وكلفتُه لا تُقاس أمامَ كلفةِ نداءِ الشبكةِ نفسِه.
 */

import type { ServiceAuthKeyRegistry } from "./keys.js";
import { SERVICE_AUTH_HEADER, serviceAuthHeaders } from "./http.js";

/**
 * يُوقِّع نداءً صادراً. يردُّ ترويساتٍ تُدمَج في ترويساتِ الطلبِ.
 * المسارُ يُمرَّر **بلا سلسلةِ استعلامٍ** لأنّ الربطَ لا يشملها (ADR-021 §4).
 */
export type ServiceRequestSigner = (
  method: string,
  path: string,
) => Record<string, string>;

export interface ServiceRequestSignerOptions {
  /** اسمُ الخدمةِ المُنادِيةِ — يظهر في `sub` ويُقرأ في سجلِّ المُتحقِّق. */
  readonly serviceName: string;
  /** اسمُ الخدمةِ المُنادَاةِ — يُطابق `aud` عندَها. */
  readonly audience: string;
  readonly keys: ServiceAuthKeyRegistry;
  /**
   * الصلاحيّاتُ المطلوبةُ لهذا النداءِ. **تُعلَن ولا تُستنبَط**: مُنادٍ يطلب
   * أكثرَ مِمّا يحتاج يُوسِّع أثرَ سرقةِ رمزٍ بلا سببٍ.
   */
  readonly scopes: readonly string[];
  readonly now?: () => Date;
  readonly ttlSeconds?: number;
}

/** يبني المُوقِّعَ. يُستدعى في جذرِ التركيبِ لا في العميل. */
export function createServiceRequestSigner(
  options: ServiceRequestSignerOptions,
): ServiceRequestSigner {
  const now = options.now ?? (() => new Date());
  return (method: string, path: string) =>
    serviceAuthHeaders({
      serviceName: options.serviceName,
      audience: options.audience,
      method,
      path,
      keys: options.keys,
      now: now(),
      scopes: options.scopes,
      ...(options.ttlSeconds === undefined ? {} : { ttlSeconds: options.ttlSeconds }),
    });
}

/**
 * مُوقِّعٌ يرفض أن يُوقِّع. **ليس «لا توقيعَ»**: يرمي عندَ الاستدعاءِ كي يكون
 * جذرُ تركيبٍ نسيَ الإعدادَ عطلاً مرئيّاً في أوّلِ نداءٍ، لا خدمةً تُنادي
 * بلا هويّةٍ فتُرَدُّ 401 ويُقرأ العطلُ بوصفِه عطلَ الطرفِ الآخر.
 */
export function refusingServiceRequestSigner(reason: string): ServiceRequestSigner {
  return () => {
    throw new Error(`لا يمكن توقيعُ نداءٍ صادرٍ: ${reason}`);
  };
}

export { SERVICE_AUTH_HEADER };

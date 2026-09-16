/**
 * قراءةُ إعدادِ الإرسالِ من البيئةِ — دالّةٌ نقيّةٌ تُقاسُ بلا إقلاعِ خدمةٍ. (M2-04)
 *
 * ── لماذا يوجد هذا الملف ───────────────────────────────────────────────
 * لأنَّ القواعدَ الأربعَ كانت تُقرأُ في `http/server.ts`، و`server.ts` يُنفِّذُ
 * `await main()` عندَ استيرادِهِ — فأيُّ اختبارٍ يستوردُهُ **يُقلِعُ خدمةً**. فلم
 * يكنِ للقراءةِ اختبارٌ ممكنٌ، ولذلكَ عاشَ `Number(process.env.X ?? n)` سنةً بلا
 * حارسٍ حتّى قِيسَ في M2-04 أنَّ `DISPATCH_WAVE_SIZE=٣` يُنتِجُ `waveSize = NaN`
 * وموجةً بلا سائقٍ وخدمةً حيّةً تقولُ إنّها سليمةٌ (`RISK-0046`).
 *
 * فالإصلاحُ الجذريُّ نقلُ القراءةِ إلى **حدٍّ نقيٍّ يقبلُ البيئةَ حُقنةً**، لا
 * تشديدُ سطرٍ في مَوضعٍ لا يُقاسُ.
 *
 * المرجع: docs/08-infrastructure/CONFIG_SCHEMA.md · ADR-032 · RISK-0046
 */

import { DISPATCH_SERVICE_PORT } from "@wasla/contracts-dispatch";
import { type EnvBag, readIntEnv, readPortEnv } from "@wasla/config";

/** قواعدُ الموجةِ والعرضِ والتصعيدِ كما تُقرأُ من البيئةِ. */
export interface DispatchRules {
  readonly rulesetVersion: number;
  readonly waveSize: number;
  readonly offerTimeoutSeconds: number;
  readonly maxWaves: number;
  readonly escalationTimeoutSeconds: number;
}

/**
 * الافتراضيّاتُ المُعلَنةُ — هيَ نفسُها المُسجَّلةُ في `env-registry.json`،
 * والفحصُ 18 يمنعُ انحرافَ الاثنَينِ.
 */
export const DISPATCH_RULE_DEFAULTS = {
  waveSize: 2,
  offerTimeoutSeconds: 30,
  maxWaves: 3,
  escalationTimeoutSeconds: 120,
} as const;

/**
 * يقرأُ القواعدَ الأربعَ بحدٍّ أدنى **واحدٍ** لكلٍّ منها: موجةٌ بصفرِ سائقينَ
 * ليست موجةً، ومهلةٌ بصفرِ ثوانٍ تُنهي العرضَ قبلَ عرضِهِ.
 */
export function resolveDispatchRules(env: EnvBag): DispatchRules {
  return {
    rulesetVersion: 1,
    waveSize: readIntEnv(env, "DISPATCH_WAVE_SIZE", {
      min: 1,
      fallback: DISPATCH_RULE_DEFAULTS.waveSize,
    }),
    offerTimeoutSeconds: readIntEnv(env, "DISPATCH_OFFER_TIMEOUT_SECONDS", {
      min: 1,
      fallback: DISPATCH_RULE_DEFAULTS.offerTimeoutSeconds,
    }),
    maxWaves: readIntEnv(env, "DISPATCH_MAX_WAVES", {
      min: 1,
      fallback: DISPATCH_RULE_DEFAULTS.maxWaves,
    }),
    escalationTimeoutSeconds: readIntEnv(env, "DISPATCH_ESCALATION_TIMEOUT_SECONDS", {
      min: 1,
      fallback: DISPATCH_RULE_DEFAULTS.escalationTimeoutSeconds,
    }),
  };
}

/** منفذُ الاستماعِ: `PORT` أوّلاً ثمَّ منفذُ العقدِ — لا رقمَ مكتوباً في الجذرِ. */
export function resolveDispatchPort(env: EnvBag): number {
  return readPortEnv(env, "PORT", DISPATCH_SERVICE_PORT);
}

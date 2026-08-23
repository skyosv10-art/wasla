/**
 * أدواتُ الاختبار: تبعيّاتٌ في الذاكرة، ومُعرّفاتٌ صالحةُ الشكل، وبانياتُ مسوّدات.
 *
 * لا `sleep` ولا `new Date()` ولا `Math.random()` في أي اختبارٍ في هذه الحزمة. الساعةُ
 * تُدفَع بيد، والمُعرّفاتُ متتالية، ولحظةُ البداية ثابتةٌ مكتوبة — فحزمةُ الاختبارات
 * تُعطي نفسَ النتيجة اليوم وبعد سنة، وعند منتصف الليل أيضاً (ونافذةُ الاحتيال سلّةٌ
 * يوميّة، فمنتصفُ الليل هو بالضبط ما يكسر اختباراً مبنياً على «الآن»).
 */

import {
  createInMemoryReputationDependencies,
  type InMemoryReputationDependencies,
} from "../infrastructure/in-memory.js";
import type { ReputationFactDraft } from "../domain/model.js";
import { recordFact } from "../use-cases/record-fact.js";

/** لحظةُ البداية في كل اختبار. منتصفُ نهارٍ في UTC كي لا تلتبس حدودُ اليوم بالنيّة. */
export const T0 = "2026-03-01T12:00:00.000Z";

export const CUSTOMER = "WS-1000000001";
export const DRIVER = "WS-2000000002";
export const OTHER_DRIVER = "WS-2000000003";

/** مُعرّفُ طلبٍ صالحُ الشكل من رقمٍ صغير: `order(7)` ⇒ `ORD-0000000007`. */
export function order(index: number): string {
  return `ORD-${String(index).padStart(10, "0")}`;
}

export function deps(startAt: string = T0): InMemoryReputationDependencies {
  return createInMemoryReputationDependencies({ startAt });
}

/**
 * مسوّدةُ واقعةٍ كاملةٌ بحقولٍ افتراضيةٍ مُعلَنة.
 *
 * الافتراضاتُ مكتوبةٌ هنا مرّةً كي يُظهر كلُّ اختبارٍ **ما يهمّه وحده**: اختبارُ تلاشٍ
 * يذكر `occurredAt` و`factKind` ولا شيءَ غيرهما، فيُقرأ ما يُفحَص من سطرٍ واحد.
 */
export function factDraft(overrides: Partial<ReputationFactDraft> = {}): ReputationFactDraft {
  return {
    subjectType: "customer",
    subjectPublicId: CUSTOMER,
    factKind: "order_completed",
    orderPublicId: order(1),
    sourceEventType: "order.completed",
    sourceEventId: "11111111-1111-4111-8111-111111111111",
    sourceSequence: 1,
    actorType: "system",
    reasonCode: null,
    occurredAt: T0,
    ...overrides,
  };
}

/**
 * طلبٌ مكتملٌ بطرفين — وهو الشرطُ المُسبق لأي تقييم.
 *
 * يُسجّل واقعةَ إكمالٍ للعميل وأخرى للسائق على نفس الطلب بتسلسلين مستقلّين، لأنّ تسلسل
 * المصدر مربوطٌ بـ(شخص × طلب) لا بالطلب وحده.
 */
export async function completeOrder(
  dependencies: InMemoryReputationDependencies,
  input: {
    readonly orderPublicId: string;
    readonly customerPublicId?: string;
    readonly driverPublicId?: string;
    readonly occurredAt?: string;
  },
): Promise<void> {
  const occurredAt = input.occurredAt ?? dependencies.clock.now();
  await recordFact(dependencies, {
    draft: factDraft({
      subjectType: "customer",
      subjectPublicId: input.customerPublicId ?? CUSTOMER,
      factKind: "order_completed",
      orderPublicId: input.orderPublicId,
      sourceEventId: `c-${input.orderPublicId}`,
      sourceSequence: 1,
      occurredAt,
    }),
  });
  await recordFact(dependencies, {
    draft: factDraft({
      subjectType: "driver",
      subjectPublicId: input.driverPublicId ?? DRIVER,
      factKind: "order_completed",
      orderPublicId: input.orderPublicId,
      sourceEventId: `d-${input.orderPublicId}`,
      sourceSequence: 1,
      occurredAt,
    }),
  });
}

/**
 * تسجيلُ سلسلةٍ من الوقائع لجانبٍ واحد، كلُّ واحدةٍ على طلبٍ مختلف.
 *
 * لأنّ تفرّدَ `ux_reputation_facts_source` يمنع واقعتين بنفس النوع على نفس الطلب، وهو
 * القيدُ الصحيح: عميلٌ لا يُلغي نفس الطلب خمس مرّات. واختبارُ الاحتيال يحتاج **خمسةَ
 * طلبات**، وهذا ما يجعله يقيس النمطَ الحقيقيّ لا حيلةً في المفاتيح.
 */
export async function recordSeries(
  dependencies: InMemoryReputationDependencies,
  input: {
    readonly subjectType: ReputationFactDraft["subjectType"];
    readonly subjectPublicId: string;
    readonly factKind: ReputationFactDraft["factKind"];
    readonly count: number;
    readonly occurredAt?: string;
    readonly firstOrderIndex?: number;
    readonly actorType?: ReputationFactDraft["actorType"];
  },
): Promise<void> {
  const first = input.firstOrderIndex ?? 100;
  for (let index = 0; index < input.count; index += 1) {
    await recordFact(dependencies, {
      draft: factDraft({
        subjectType: input.subjectType,
        subjectPublicId: input.subjectPublicId,
        factKind: input.factKind,
        orderPublicId: order(first + index),
        sourceEventId: `${input.factKind}-${first + index}`,
        sourceSequence: 1,
        actorType: input.actorType ?? "system",
        occurredAt: input.occurredAt ?? dependencies.clock.now(),
      }),
    });
  }
}

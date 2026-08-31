/**
 * M1-03 · إنفاذ هوية الخدمة على حدٍّ حقيقيٍّ عبر مقبسٍ حقيقيّ.
 *
 * السؤال الذي يجيب عنه هذا الملف واحد: **«هل يفرض النظام هوية الخدمة، أم أن حزمة
 * `service-auth` وحدها هي التي تعمل؟»** الفرق بين الجوابين هو الفرق بين
 * `service-auth works` و`the system enforces service identity`، وقد رُفض الأول
 * صراحةً كدليلٍ على البوّابة.
 *
 * لذلك لا شيء هنا يستعمل `app.inject`: كل نداءٍ يمرّ على TCP إلى خدمة المطابقة
 * الحقيقية التي تُشغِّلها بقيّة سيناريوهات المرحلة السابعة نفسها، بترتيبها الإنتاجيّ
 * نفسه (`registerServiceIdentity` قبل المسارات).
 *
 * المصفوفة المطلوبة أربعة صفوف، وكلٌّ منها اختبارٌ مستقلّ:
 *
 *   | الحالة                        | المتوقَّع |
 *   |-------------------------------|-----------|
 *   | بلا هوية                      | 401       |
 *   | هويّة مزوّرة (سرٌّ آخر)         | 401       |
 *   | هويّة صحيحة                    | مسموح     |
 *   | هويّة صحيحة بصلاحيةٍ خاطئة      | 403       |
 *
 * ويُضاف إليها صفٌّ خامس لا تكفي الوحدةُ لإثباته: **إعادة استعمال الرمز نفسه على
 * السلك** — 200 ثمّ 401 — لأن حَرْق الرمز في متجرٍ داخل العملية قد يبدو صحيحاً في
 * اختبار وحدةٍ ثمّ يسقط عند أول مسارٍ حقيقيّ.
 *
 * ما لا يُثبته هذا الملف بإعلانٍ صريح: **انتشار الإنفاذ على كلّ حدود النظام**. هذه
 * الدفعة تُثبت حدَّ المطابقة وتمنع بحارس تغطيةٍ إضافةَ عميلٍ جديدٍ بلا توقيع، وتغطية
 * بقيّة الحدود بوّابةٌ مستقلّة في M1-04 (docs/07-security/SERVICE_AUTH_ENFORCEMENT.md).
 */

import { SERVICE_AUTH_HEADER } from "@wasla/service-auth";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { callMatchingUnsigned, startGate, type GateContext } from "../harness.js";

const DRIVER = "WS-0703000001";
const READ_PATH = `/candidacy/${DRIVER}`;
/** صلاحيةٌ حقيقيّةٌ لكنّها ليست صلاحيةَ هذا المسار: هكذا يُفرَّق 403 عن 401. */
const WRONG_SCOPE = ["matching:decisions:read"];

let gate: GateContext;

beforeEach(async () => {
  gate = await startGate();
});

afterEach(async () => {
  await gate.close();
});

describe("M1-03 · حدُّ المطابقة يفرض هوية الخدمة على السلك", () => {
  it("بلا هوية ⇒ 401، وقبل أيّ منطقِ عمل", async () => {
    const result = await callMatchingUnsigned(gate, { method: "GET", path: READ_PATH });
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ code: "AUTHN_UNAUTHENTICATED" });
    // الغلاف ثلاثةُ حقولٍ فقط: لا تفاصيل تُعين مهاجماً.
    expect(Object.keys(result.body).sort()).toEqual(["code", "message", "trace_id"]);
  });

  it("هويّةٌ مزوّرةٌ بسرٍّ آخر ⇒ 401: التوقيع يُفحَص، لا وجودُ الترويسة", async () => {
    const forged = gate.serviceIdentity.sign("GET", READ_PATH, { forged: true });
    expect(forged[SERVICE_AUTH_HEADER]).toMatch(/^wsvc2\./);
    const result = await callMatchingUnsigned(gate, {
      method: "GET",
      path: READ_PATH,
      headers: forged,
    });
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ code: "AUTHN_UNAUTHENTICATED" });
  });

  it("هويّةٌ صحيحةٌ ⇒ يمرّ الطلب إلى منطق العمل (404 لا 401)", async () => {
    const result = await callMatchingUnsigned(gate, {
      method: "GET",
      path: READ_PATH,
      headers: gate.serviceIdentity.sign("GET", READ_PATH),
    });
    // لا صفَّ ترشيحٍ لهذا السائق، وهذا هو المقصود: 404 يعني أن الحدَّ سمح ووصل
    // الطلب إلى القرار. لو أُعيد 401 لكان الإنفاذ يرفض هويّةً صحيحة.
    expect(result.status).toBe(404);
    expect(result.body).not.toMatchObject({ code: "AUTHN_UNAUTHENTICATED" });
  });

  it("هويّةٌ صحيحةٌ بصلاحيةٍ خاطئة ⇒ 403: التوثيق ليس التخويل", async () => {
    const result = await callMatchingUnsigned(gate, {
      method: "GET",
      path: READ_PATH,
      headers: gate.serviceIdentity.sign("GET", READ_PATH, { scopes: WRONG_SCOPE }),
    });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ code: "AUTHZ_FORBIDDEN" });
  });

  it("الرمزُ يُحرَق: النداء الثاني بالرمز نفسه ⇒ 401 (سياسةُ الإعادة، ADR-021)", async () => {
    const headers = gate.serviceIdentity.sign("GET", READ_PATH);
    const first = await callMatchingUnsigned(gate, { method: "GET", path: READ_PATH, headers });
    const second = await callMatchingUnsigned(gate, { method: "GET", path: READ_PATH, headers });
    // الأوّل مرّ إلى القرار (404)، والثاني رُفض على الحدّ لأن jti استُهلك.
    expect(first.status).toBe(404);
    expect(second.status).toBe(401);
    expect(second.body).toMatchObject({ code: "AUTHN_UNAUTHENTICATED" });
  });

  it("الرمزُ مربوطٌ بالمسار والطريقة: رمزُ مسارٍ آخر ⇒ 401", async () => {
    const otherPath = "/candidacy/WS-0703000002";
    const result = await callMatchingUnsigned(gate, {
      method: "GET",
      path: READ_PATH,
      headers: gate.serviceIdentity.sign("GET", otherPath),
    });
    expect(result.status).toBe(401);
  });

  it("مسارٌ غير مصنَّفٍ يُرفَض قبل 404: الافتراضُ منعٌ لا سماح", async () => {
    const path = "/matching/does-not-exist";
    const unsigned = await callMatchingUnsigned(gate, { method: "GET", path });
    expect(unsigned.status).toBe(401);
  });

  it("‏/health يبقى مفتوحاً: الإنفاذُ لا يُعمي المراقبة", async () => {
    const result = await callMatchingUnsigned(gate, { method: "GET", path: "/health" });
    expect(result.status).toBe(200);
  });
});

/**
 * إنفاذُ هويّةِ الخدمةِ على حدِّ السوقِ — **على السلكِ** لا في `inject`
 * (`M1-04` · الموجةُ 7 · المراجعةُ 29/N · `CLM-0150`).
 *
 * ── لماذا هذا الملفُّ موجودٌ معَ وجودِ 24 حالةٍ في الخدمةِ ──────────────────
 * `services/marketplace/src/__tests__/service-identity.test.ts` يُثبِتُ الحدَّ
 * عبرَ `app.inject`، وهوَ يتجاوزُ طبقةَ `node:http` كلَّها: ترميزَ الترويسةِ،
 * وحدَّ طولِها، وتطبيعَ اسمِها، وما يفعلُهُ الإطارُ قبلَ أن يبلغَ الخطّافَ. فحدٌّ
 * أخضرُ في `inject` **قد** يكونُ مفتوحاً على مقبسٍ حقيقيٍّ — وهذا الفرقُ هوَ
 * سببُ وجودِ حزمةِ البوّابةِ أصلاً (البندُ 2 في رأسِ `harness.ts`).
 *
 * ── والدعوى المُقابِلةُ: أنَّ الحارسَ لا يُرضى بالغيابِ ──────────────────────
 * بقيّةُ دعاوى البوّابةِ تُنادي عبرَ `call` **الموقِّعِ**، فخُضرتُها تُثبِتُ أنَّ
 * الموقَّعَ يمرُّ — **ولا تُثبِتُ أنَّ غيرَ الموقَّعِ يُرَدُّ**. ولو كانَ الحدُّ
 * مفتوحاً لمرَّت كلُّها بالحرفِ نفسِهِ. ولذا يُنادى هنا بـ`fetch` **عارياً**:
 * بلا ترويسةٍ، وبترويسةٍ **مزوَّرةٍ بسرٍّ آخرَ**، وبترويسةٍ **مُوجَّهةٍ إلى جمهورٍ
 * آخرَ** — «حارسٌ يطمئنُّ عندَ الغيابِ أسوأُ من لا حارسٍ».
 *
 * ── ولمَ مساراتُ الحجزِ بالذاتِ ────────────────────────────────────────────
 * `POST /inventory/reserve` و`POST /inventory/release` هما المسارانِ الذانِ
 * يُنادِيهما التوصيلُ فعلاً في الإنتاجِ ويُحرِّكانِ **مخزوناً حقيقيّاً**. فإن
 * كانَ الحدُّ مفتوحاً هنا فمنادٍ بلا هويّةٍ يُفرِغُ رفَّ متجرٍ أو يُفرِجُ حجزَ
 * طلبٍ حيٍّ.
 *
 * ── ما لا يُدَّعى ──────────────────────────────────────────────────────────
 * - **لا يُقاسُ الرفضُ لكلِّ المساراتِ العشرينَ على السلكِ** — ذلكَ مقيسٌ في
 *   `inject`، وهنا يُقاسُ أنَّ **الطبقةَ الشبكيّةَ لا تفتحُ ما أغلقَهُ الخطّافُ**.
 * - ولا يُقاسُ منعُ الإعادةِ ولا انتهاءُ الرمزِ هنا: مقيسانِ في الخدمةِ، ولا
 *   تُضيفُ الشبكةُ إليهما شيئاً.
 * - وتُشترَطُ `DATABASE_URL`: البوّابةُ ترفعُ التركيبَ الإنتاجيَّ كامِلاً،
 *   ولا يُبنى حدٌّ مُخالِفٌ لما يركضُ لأجلِ دعوى أمنٍ.
 *
 * Scope: M1-04 · الموجةُ 7
 * Related Code: services/marketplace/src/http/service-identity.ts
 * Related Docs: docs/07-security/SERVICE_AUTH_ENFORCEMENT.md §2.8
 */

import { ServiceAuthKeyRegistry, createServiceRequestSigner } from "@wasla/service-auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PG_ENABLED, gateServiceAuthKeys, startGate, type GateContext } from "../harness.js";

/**
 * سرٌّ **آخرُ** بكِيدٍ يعرفُهُ الحدُّ — فالرفضُ يكونُ على **التوقيعِ** لا على
 * كِيدٍ مجهولٍ. ولو زُوِّرَ بكِيدٍ مجهولٍ لمرَّ الاختبارُ وهوَ يقيسُ شيئاً أسهلَ.
 */
const FORGED = new ServiceAuthKeyRegistry({
  keys: [{ kid: "gate-active", secret: "forged-secret-999999999999999999999", status: "active" }],
  activeKid: "gate-active",
});

const RESERVE = "/inventory/reserve";

describe.skipIf(!PG_ENABLED)("إنفاذُ هويّةِ السوقِ على مُستمعٍ حقيقيٍّ", () => {
  let gate: GateContext;

  beforeAll(async () => {
    gate = await startGate();
  }, 60_000);

  afterAll(async () => {
    await gate.close();
  });

  async function bare(
    path: string,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
    const response = await fetch(`${gate.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `bare-${Math.random().toString(36).slice(2)}`,
        ...headers,
      },
      body: JSON.stringify({ store_slug: "x", items: [] }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }

  it("نداءٌ عارٍ على حجزِ المخزونِ يُرَدُّ 401 — لا 400 ولا 503 ولا مرورَ", async () => {
    const { status, body } = await bare(RESERVE);
    expect(status).toBe(401);
    // ولا 400: الهويّةُ تُفحَصُ **قبلَ** المُعامِلِ وقبلَ تصديقِ الجسمِ، فالغائبُ
    // لا يتعلَّمُ شكلَ الحدِّ من رسالةِ خطئِهِ.
    const error = body.error as Record<string, unknown> | undefined;
    expect(error?.code).toBe("AUTHN_UNAUTHENTICATED");
    expect(typeof body.trace_id).toBe("string");
  });

  it("ورسالةُ الرفضِ لا تُسرِّبُ سرَّها", async () => {
    const { body } = await bare(RESERVE);
    const error = body.error as Record<string, unknown> | undefined;
    expect(String(error?.message)).not.toMatch(/توقيع|منته|kid|صلاحي|scope|secret/u);
  });

  it("وترويسةٌ مزوَّرةٌ بسرٍّ آخرَ على الكِيدِ نفسِهِ تُرَدُّ 401", async () => {
    const forge = createServiceRequestSigner({
      serviceName: "attacker",
      audience: "marketplace",
      keys: FORGED,
      scopes: ["marketplace:inventory:reserve"],
    });
    const { status, body } = await bare(RESERVE, forge("POST", RESERVE));
    expect(status).toBe(401);
    expect((body.error as Record<string, unknown> | undefined)?.code).toBe(
      "AUTHN_UNAUTHENTICATED",
    );
  });

  it("ورمزٌ صحيحٌ لجمهورٍ آخرَ (`delivery`) يُرَدُّ 401 على هذا الحدِّ", async () => {
    const wrongAudience = createServiceRequestSigner({
      serviceName: "e2e-harness",
      audience: "delivery",
      keys: gateServiceAuthKeys(),
      scopes: ["marketplace:inventory:reserve"],
    });
    const { status } = await bare(RESERVE, wrongAudience("POST", RESERVE));
    // السرُّ صحيحٌ والتوقيعُ صحيحٌ — والجمهورُ وحدَهُ خاطئٌ. فمن سرقَ رمزَ حدٍّ
    // لا يستعملُهُ على حدٍّ آخرَ.
    expect(status).toBe(401);
  });

  it("ومسارٌ مجهولٌ بلا توقيعٍ يُرَدُّ 401 قبلَ 404 — لا يُكشَفُ سطحُ الحدِّ للغائبِ", async () => {
    const { status } = await bare("/inventory/no-such-route");
    expect(status).toBe(401);
  });

  it("و`GET /health` مفتوحٌ بلا توقيعٍ ⇒ 200 — والانفتاحُ مقيسٌ لا مُعلَنٌ", async () => {
    const response = await fetch(`${gate.baseUrl}/health`);
    expect(response.status).toBe(200);
  });
});

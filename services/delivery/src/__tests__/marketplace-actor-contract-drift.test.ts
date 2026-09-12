/**
 * حرسُ انحرافٍ بينَ مُستهلِكٍ ومُنتِجٍ — `RISK-0035` (ADR-026 §4.22).
 *
 * هذا الملفُّ يقرأُ **عقدَ السوقِ المنشورَ** نفسَهُ
 * (`services/marketplace/contracts/events.json`) ويُطابِقُ ما يُجيزُهُ في
 * `MarketplaceInventoryAdjustedV1.data.actor_public_id` بما يقبلُهُ مُصنِّفُ
 * ناقلِ مخزونِ التوصيلِ. فهوَ لا يُثبِّتُ نمطاً مكتوباً بيدٍ في مكانَينِ، بل
 * يجعلُ **المُنتِجَ مصدرَ الحقيقةِ** ويُسقِطُ الاختبارَ إن ضاقَ المُستهلِكُ عنهُ.
 *
 * **ولمَ حرسٌ لا اختبارُ قبولٍ:** العطبُ الذي سُجِّلَ `RISK-0035` لم يكن خطأً في
 * منطقٍ بل **انحرافاً بينَ وثيقتَينِ** لا يُسقِطُ بناءً ولا يُشعِلُ نوعاً: عقدُ
 * السوقِ أعلنَ صيغتَينِ ومُصنِّفُ التوصيلِ نسخَ واحدةً. ولو أُصلِحَ المُصنِّفُ بلا
 * حرسٍ لَعادَ الانحرافُ عندَ أوّلِ توسيعٍ في العقدِ — والتوسيعُ في المُنتِجِ لا
 * يكسرُ المُستهلِكَ الأضيقَ **بناءً**، وإنّما يُسقِطُ أحداثَهُ **صامتاً في
 * الإنتاجِ**. فالحرسُ هوَ ما يُحوِّلُ الفقدَ الصامتَ إلى إخفاقِ اختبارٍ.
 *
 * **وما لا يُدَّعى:** الحرسُ يُغطّي حقلَ الفاعلِ وحدَهُ — لا كلَّ حقولِ الحمولةِ.
 * و`reason_code` مثلاً: العقدُ يُعلِنُهُ `enum` من سبعةٍ والمُصنِّفُ يقبلُ أيَّ
 * نصٍّ غيرِ فارغٍ. وذاكَ **الاتجاهُ الآمنُ** بالتحديدِ (مُستهلِكٌ أوسعُ من
 * مُنتِجِهِ لا يُسقِطُ حدثاً صحيحاً)، فلم يُضيَّقْ في هذه المراجعةِ.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyMarketplaceInventoryEvent,
  MARKETPLACE_ACTOR_PATTERNS,
  MarketplacePayloadError,
  type MarketplaceOutboxRow,
} from "../domain/marketplace-inventory-events.js";

const here = dirname(fileURLToPath(import.meta.url));
const eventsContractPath = resolve(
  here,
  "../../../../services/marketplace/contracts/events.json",
);

interface EventsContract {
  readonly $defs: Record<string, unknown>;
}

const contract = JSON.parse(readFileSync(eventsContractPath, "utf8")) as EventsContract;

/** يقرأُ `oneOf` الخاصَّ بالفاعلِ من مخطَّطِ حدثِ تعديلِ المخزونِ. */
function actorSchemaPatterns(): readonly string[] {
  const def = contract.$defs.MarketplaceInventoryAdjustedV1 as {
    properties: { data: { properties: { actor_public_id: { oneOf: unknown[] } } } };
  };
  const oneOf = def.properties.data.properties.actor_public_id.oneOf;
  return oneOf.map((branch) => {
    const b = branch as { $ref?: string; pattern?: string };
    if (typeof b.pattern === "string") return b.pattern;
    if (typeof b.$ref === "string") {
      const name = b.$ref.replace("#/$defs/", "");
      const referenced = contract.$defs[name] as { pattern?: string };
      if (typeof referenced?.pattern !== "string") {
        throw new Error(`contract $def ${name} has no pattern`);
      }
      return referenced.pattern;
    }
    throw new Error("actor_public_id oneOf branch has neither $ref nor pattern");
  });
}

function row(actor: string): MarketplaceOutboxRow {
  return {
    event_id: "dddddddd-0000-0000-0000-00000000d001",
    event_type: "marketplace.inventory_adjusted",
    event_version: "v1",
    aggregate_type: "inventory",
    aggregate_id: "aaaaaaaa-0000-0000-0000-000000000001",
    occurred_at: "2026-09-12T10:00:00.000Z",
    trace_id: null,
    data: {
      adjustment_id: "cccccccc-0000-0000-0000-000000000003",
      product_id: "bbbbbbbb-0000-0000-0000-000000000002",
      store_id: "aaaaaaaa-0000-0000-0000-000000000001",
      quantity_delta: -2,
      quantity_after: 7,
      reason_code: "reservation",
      adjustment_sequence: 2,
      actor_public_id: actor,
      occurred_for: "2026-09-12T10:00:00.000Z",
    },
  };
}

describe("RISK-0035 · حرسُ الانحرافِ في فاعلِ حدثِ المخزونِ", () => {
  it("العقدُ المنشورُ يُعلِنُ صيغتَينِ للفاعلِ لا واحدةً", () => {
    expect(actorSchemaPatterns()).toHaveLength(2);
  });

  it("مجموعةُ الأنماطِ في المُصنِّفِ **مساويةٌ حرفاً** لِما في العقدِ", () => {
    expect([...actorSchemaPatterns()].sort()).toEqual(
      [MARKETPLACE_ACTOR_PATTERNS.waslaPublicId, MARKETPLACE_ACTOR_PATTERNS.systemActor].sort(),
    );
  });

  it("كلُّ صيغةٍ يُجيزُها العقدُ يقبلُها المُصنِّفُ فعلاً — لا إعلاناً فقط", () => {
    // مثالٌ يُطابِقُ كلَّ فرعٍ، مُشتقٌّ من نمطِ العقدِ نفسِهِ لا مكتوبٌ بيدٍ.
    const sampleFor: Record<string, string> = {
      "^WS-[0-9]{10}$": "WS-0000000123",
      "^system:[a-z_]+$": "system:delivery",
    };
    for (const pattern of actorSchemaPatterns()) {
      const sample = sampleFor[pattern];
      expect(sample, `لا مثالَ لنمطٍ جديدٍ في العقدِ: ${pattern}`).toBeDefined();
      expect(new RegExp(pattern).test(sample!), `المثالُ لا يُطابِقُ ${pattern}`).toBe(true);
      const c = classifyMarketplaceInventoryEvent(row(sample!));
      expect(c.kind, `المُصنِّفُ رفضَ فاعلاً يُجيزُهُ العقدُ: ${sample}`).toBe("projectable");
    }
  });

  it("والحدُّ لم يُرخَ: فاعلٌ خارجَ الصيغتَينِ يبقى سُمّاً", () => {
    expect(() => classifyMarketplaceInventoryEvent(row("system:Delivery"))).toThrow(
      MarketplacePayloadError,
    );
    expect(() => classifyMarketplaceInventoryEvent(row("anything"))).toThrow(
      MarketplacePayloadError,
    );
  });
});

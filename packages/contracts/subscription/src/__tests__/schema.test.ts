import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REFERRAL_REJECTION_REASONS, REFERRAL_STATES, SUBSCRIPTION_ALLOWED_TRANSITIONS,
  SUBSCRIPTION_ENTITLEMENTS, SUBSCRIPTION_PERIOD_SOURCES, SUBSCRIPTION_STATES,
  SUBSCRIPTION_TRANSITION_REASONS,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(resolve(__dirname, "../../../../../services/subscriptions/contracts/schema.sql"), "utf8");
const openapi = readFileSync(resolve(__dirname, "../../../../../services/subscriptions/contracts/api.openapi.yml"), "utf8");
/** يقتص تعريف جدول واحد كي لا يمر تعداد لعمود من جدول آخر. */
function table(name: string): string {
  const start = schemaSql.indexOf(`CREATE TABLE IF NOT EXISTS ${name}`);
  expect(start, `${name} يجب أن يوجد`).toBeGreaterThan(-1);
  const end = schemaSql.indexOf("\nCREATE TABLE IF NOT EXISTS ", start + 1);
  return schemaSql.slice(start, end === -1 ? undefined : end);
}
/** يستخرج قائمة IN لعمود بعينه للمقارنة الحرفية بثابت الحزمة. */
function inList(sql: string, column: string): string[] {
  const match = new RegExp(`${column}[^\\n]*?IN \\(([^)]*)\\)`, "s").exec(sql);
  expect(match, `${column} يجب أن يقيّد قيمه`).not.toBeNull();
  return [...match![1]!.matchAll(/'([a-z_]+)'/g)].map((item) => item[1]!);
}

const TABLES = [
  "subscription_plans", "subscription_plan_entitlements", "subscriptions", "subscription_periods",
  "subscription_transitions", "referral_codes", "referrals", "referral_rewards",
  "subscription_idempotency", "subscription_outbox",
];

describe("مخطط الاشتراك ↔ ثوابت الحزمة", () => {
  it("يمنع غياب واحد من الجداول العشرة أو إضافة جدول خارج الطور", () => {
    expect([...schemaSql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]!).sort()).toEqual([...TABLES].sort());
  });
  it("يمنع تعداداً في DDL يختلف حرفياً عن ثوابت المجال", () => {
    expect(inList(table("subscriptions"), "state")).toEqual([...SUBSCRIPTION_STATES]);
    expect(inList(table("subscription_transitions"), "reason_code")).toEqual([...SUBSCRIPTION_TRANSITION_REASONS]);
    expect(inList(table("subscription_periods"), "source")).toEqual([...SUBSCRIPTION_PERIOD_SOURCES]);
    expect(inList(table("subscription_plan_entitlements"), "entitlement_code")).toEqual([...SUBSCRIPTION_ENTITLEMENTS]);
    expect(inList(table("referrals"), "state")).toEqual([...REFERRAL_STATES]);
    expect(inList(table("referrals"), "reason_code")).toEqual([...REFERRAL_REJECTION_REASONS]);
  });
  it("يمنع إسقاط قيود التفرد وعدم الإحالة الذاتية", () => {
    for (const constraint of [
      "ux_subscriptions_driver", "ux_subscription_transitions_sequence", "ux_referrals_referee",
      "ux_referral_codes_owner", "ux_referral_rewards_referral", "ux_referral_rewards_period",
      "ck_referrals_not_self",
    ]) expect(schemaSql, constraint).toContain(`CONSTRAINT ${constraint}`);
  });
});

describe("دفتر الانتقالات المعلن", () => {
  /**
   * لماذا هذا الحارس: التجديد مدة في الدفتر، لا انتقال active → active بلا معنى تدقيقي.
   * النسخة الخاطئة الأرخص: قبول أي زوج حالات في الكود فيتحول فرع عرضي إلى سابقة دائمة.
   */
  it("يمنع انتقال active إلى نفسه أو انتقالاً غير مُعلن", () => {
    const declared: ReadonlyArray<readonly [(typeof SUBSCRIPTION_STATES)[number] | null, (typeof SUBSCRIPTION_STATES)[number]]> = [
      [null, "trial"], ["trial", "active"], ["trial", "expired"], ["active", "expired"],
      ["expired", "active"], ["expired", "community"], ["community", "active"],
    ];
    expect(SUBSCRIPTION_ALLOWED_TRANSITIONS).toEqual(declared);
    expect(SUBSCRIPTION_ALLOWED_TRANSITIONS).not.toContainEqual(["active", "active"]);
  });
  it("يمنع انتقالاً يذكر حالة ليست من حالات الاشتراك", () => {
    for (const [from, to] of SUBSCRIPTION_ALLOWED_TRANSITIONS) {
      if (from !== null) expect([...SUBSCRIPTION_STATES], String(from)).toContain(from);
      expect([...SUBSCRIPTION_STATES], String(to)).toContain(to);
    }
  });
});

describe("أرضيّةُ المجتمع: رقمٌ في نسخة الخطّة (ملحق ADR-015 · المراجعة 2/6)", () => {
  /**
   * لماذا هذا الحارس: أرضيّةُ `community` سقفٌ يوميّ، والسقفُ رقمٌ لا بدّ أن يسكن في
   * نسخةِ الخطّة كي يُحفَظ ما كانت الأرضيّةُ أمس.
   * النسخة الخاطئة الأرخص: ثابتٌ في كود الخدمة يُغيَّر بنشرة، فلا يبقى أثرٌ تدقيقيّ لأرضيّةٍ سابقة.
   */
  it("يمنع إسقاط عمود سقف الأرضيّة من جدول الخطط", () => {
    expect(table("subscription_plans")).toContain("community_daily_order_cap");
  });
  it("يمنع تعارض حدود المخطط مع حدود العقد لأيّام التجربة والمهلة", () => {
    // صفرٌ قرارٌ مشروع في DDL؛ فلو أعلن OpenAPI حدّاً أدنى 1 لكذّب أحدُ العقدَين الآخر.
    for (const column of ["trial_days", "community_grace_days", "community_daily_order_cap"]) {
      expect(table("subscription_plans"), column).toContain(`CHECK (${column} BETWEEN 0`);
      // نقتص مخطط SubscriptionPlan وحده كي لا يقرأ الحارس مثالاً في متن مسار آخر.
      const planSchema = openapi.slice(openapi.indexOf("    SubscriptionPlan:"), openapi.indexOf("    SubscriptionPlanList:"));
      expect(planSchema.slice(planSchema.indexOf(`        ${column}:`)).slice(0, 220), column).toContain("minimum: 0");
    }
  });
});

/**
 * حرسُ الطاقم: مالكٌ واحدٌ لا يُعدَّل ولا يُزال، وإزالةٌ بختمٍ نهائيٍّ لا بحذف.
 */
import { describe, expect, it } from "vitest";

import { STORE_STAFF_ROLES } from "../domain/contract-sets.js";
import { MarketplaceError } from "../domain/errors.js";
import type { StoreStaffEntry } from "../domain/model.js";
import {
  activeStaff,
  assertActiveMembership,
  assertActiveOwnership,
  assertRoleChange,
  assertSingleActiveOwner,
  assertStaffAddition,
  assertStaffRemoval,
  assertStaffRole,
  findActiveOwner,
  sealStaffRemoval,
} from "../domain/staff.js";

const OWNER = "WS-0000000001";
const MANAGER = "WS-0000000002";
const STAFF = "WS-0000000003";

function member(
  memberPublicId: string,
  role: StoreStaffEntry["role"],
  removed = false,
): StoreStaffEntry {
  const base: StoreStaffEntry = {
    memberPublicId,
    role,
    addedByPublicId: OWNER,
    addedAt: "2026-03-01T08:00:00.000Z",
  };
  return removed
    ? { ...base, removedAt: "2026-03-09T08:00:00.000Z", removedByPublicId: OWNER }
    : base;
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error("expected a MarketplaceError to be thrown");
  } catch (error) {
    expect(error).toBeInstanceOf(MarketplaceError);
    expect((error as MarketplaceError).code).toBe(code);
  }
}

describe("الأدوارُ قائمةٌ مُقفَلة", () => {
  it("ثلاثةُ أدوارٍ لا رابعَ", () => {
    expect(STORE_STAFF_ROLES).toEqual(["owner", "manager", "staff"]);
    for (const role of STORE_STAFF_ROLES) expect(assertStaffRole(role)).toBe(role);
    for (const bad of ["admin", "moderator", "", "Owner", 1, null]) {
      expectCode(() => assertStaffRole(bad), "MARKETPLACE_VALIDATION_FAILED");
    }
  });
});

describe("الطاقمُ الفعّالُ والمالكُ الواحد", () => {
  const roster = [member(OWNER, "owner"), member(MANAGER, "manager"), member(STAFF, "staff", true)];

  it("المختومُ خارجَ الطاقمِ الفعّالِ وباقٍ في السِّجل", () => {
    expect(activeStaff(roster)).toHaveLength(2);
    expect(roster).toHaveLength(3);
  });

  it("مالكٌ فعّالٌ واحدٌ يُعثَر عليه ويُثبَت", () => {
    expect(findActiveOwner(roster)?.memberPublicId).toBe(OWNER);
    expect(assertSingleActiveOwner(roster).memberPublicId).toBe(OWNER);
  });

  it("يرفض طاقماً بمالكَين أو بلا مالكٍ فعّال", () => {
    expectCode(
      () => assertSingleActiveOwner([member(OWNER, "owner"), member(MANAGER, "owner")]),
      "MARKETPLACE_VALIDATION_FAILED",
    );
    expectCode(
      () => assertSingleActiveOwner([member(OWNER, "owner", true), member(MANAGER, "manager")]),
      "MARKETPLACE_VALIDATION_FAILED",
    );
  });
});

describe("إضافةُ عضو", () => {
  const roster = [member(OWNER, "owner"), member(MANAGER, "manager")];

  it("تقبل `manager` و`staff`", () => {
    expect(assertStaffAddition({ role: "manager", memberPublicId: STAFF, existing: roster })).toBe(
      "manager",
    );
    expect(assertStaffAddition({ role: "staff", memberPublicId: STAFF, existing: roster })).toBe(
      "staff",
    );
  });

  it("ترفض دورَ مالكٍ برمزِ `STORE_OWNER_ROLE_IMMUTABLE`", () => {
    expectCode(
      () => assertStaffAddition({ role: "owner", memberPublicId: STAFF, existing: roster }),
      "STORE_OWNER_ROLE_IMMUTABLE",
    );
  });

  it("ترفض عضواً فعّالاً مكرّراً وتقبل عودةَ مختومٍ بصفٍّ جديد", () => {
    expectCode(
      () => assertStaffAddition({ role: "staff", memberPublicId: MANAGER, existing: roster }),
      // الرمزُ هو رمزُ العقدِ ورمزُ القيدِ معاً: كان `MARKETPLACE_VALIDATION_FAILED` حتى
      // المراجعة 4/6، فكان السلكُ يقول 400 لحقيقةٍ يُعلنها العقدُ 409.
      "STORE_STAFF_ALREADY_MEMBER",
    );
    expect(
      assertStaffAddition({
        role: "staff",
        memberPublicId: STAFF,
        existing: [...roster, member(STAFF, "staff", true)],
      }),
    ).toBe("staff");
  });
});

describe("تعديلُ الدورِ وإزالةُ العضو", () => {
  it("يُبدّل بين `manager` و`staff`", () => {
    expect(assertRoleChange({ member: member(MANAGER, "manager"), nextRole: "staff" })).toBe("staff");
    expect(assertRoleChange({ member: member(STAFF, "staff"), nextRole: "manager" })).toBe("manager");
  });

  it("لا يُخفَّض مالكٌ ولا يُرقّى أحدٌ مالكاً", () => {
    expectCode(
      () => assertRoleChange({ member: member(OWNER, "owner"), nextRole: "manager" }),
      "STORE_OWNER_ROLE_IMMUTABLE",
    );
    expectCode(
      () => assertRoleChange({ member: member(MANAGER, "manager"), nextRole: "owner" }),
      "STORE_OWNER_ROLE_IMMUTABLE",
    );
  });

  it("المالكُ يُفحَص قبل الختم: الجوابُ الأدقُّ أوّلاً", () => {
    expectCode(
      () => assertRoleChange({ member: member(OWNER, "owner", true), nextRole: "manager" }),
      "STORE_OWNER_ROLE_IMMUTABLE",
    );
  });

  it("لا يُعدَّل دورُ مختوم", () => {
    expectCode(
      () => assertRoleChange({ member: member(MANAGER, "manager", true), nextRole: "staff" }),
      "MARKETPLACE_VALIDATION_FAILED",
    );
  });

  it("لا يُزال مالكٌ ولا يُختَم مختومٌ مرّتَين", () => {
    expectCode(() => assertStaffRemoval(member(OWNER, "owner")), "STORE_OWNER_ROLE_IMMUTABLE");
    expectCode(
      () => assertStaffRemoval(member(MANAGER, "manager", true)),
      "MARKETPLACE_VALIDATION_FAILED",
    );
    expect(() => assertStaffRemoval(member(MANAGER, "manager"))).not.toThrow();
  });

  it("الختمُ زمنٌ وفاعلٌ معاً ولا يمسّ الصفَّ الأصليّ", () => {
    const original = member(MANAGER, "manager");
    const sealed = sealStaffRemoval({
      member: original,
      removedAt: "2026-03-20T08:00:00.000Z",
      removedByPublicId: OWNER,
    });
    expect(sealed.removedAt).toBe("2026-03-20T08:00:00.000Z");
    expect(sealed.removedByPublicId).toBe(OWNER);
    expect(original.removedAt).toBeUndefined();
    expect(activeStaff([sealed])).toHaveLength(0);
  });
});

// ── عضويّةُ المُستأجِرِ (`M1-05B` الموجةُ 2 · `CLM-0179`) ────────────────────
/**
 * هذانِ الحارسانِ هما **الطبقةُ الثانيةُ** من ربطِ المُستأجِرِ: الأولى عندَ
 * الحدِّ (`tenantScoped` يرفضُ رمزاً بلا `obo`)، وهذهِ **داخلَ المعاملةِ**
 * تسألُ «أهذا الفاعلُ من هذا المتجرِ؟».
 *
 * **والمالكُ ليسَ صفّاً في الطاقمِ** — قِيسَ بإسقاطِ 45 اختبارَ تكاملٍ فوقَ
 * محرّكٍ حقيقيٍّ، لا بقراءةِ شفرةٍ. فالمِلكيّةُ تُقرأُ من `stores.owner_public_id`
 * والعضويّةُ من `store_staff`، وخلطُهما كانَ سيُقفِلُ المتاجرَ على أصحابِها.
 * ولذلكَ تُمرَّرُ `storeOwnerPublicId` صراحةً في كلِّ دعوىً أدناهُ.
 */
describe("عضويّةُ المُستأجِرِ: مَن يمسُّ متجراً", () => {
  const SLUG = "madinah-electronics";

  it("عضوٌ نشِطٌ في الطاقمِ يُقبَلُ", () => {
    expect(() =>
      assertActiveMembership({
        storeSlug: SLUG,
        actorPublicId: STAFF,
        storeOwnerPublicId: OWNER,
        existing: [member(STAFF, "staff")],
      }),
    ).not.toThrow();
  });

  it("والمالكُ يُقبَلُ **بلا صفِّ طاقمٍ البتّةَ** — وهذا هوَ العطبُ الذي قِيسَ", () => {
    // لو رُدَّ هذا الحارسُ إلى `activeStaff` وحدَها لسقطَ هذا السطرُ وحدَهُ
    // قبلَ أن يسقطَ أيُّ اختبارِ تكاملٍ — وهذا موضعُهُ الأرخصُ.
    expect(() =>
      assertActiveMembership({
        storeSlug: SLUG,
        actorPublicId: OWNER,
        storeOwnerPublicId: OWNER,
        existing: [],
      }),
    ).not.toThrow();
  });

  it("غيرُ العضوِ يُرَدُّ `STORE_NOT_FOUND` لا `403` — فلا يصيرُ الحدُّ عرّافاً", () => {
    // **الفرقُ مقصودٌ ومكتوبٌ**: `403` يُفرِّقُ «موجودٌ ولستَ منهُ» عن «غيرُ
    // موجودٍ»، فيصيرُ الحدُّ يُجيبُ عن وجودِ متاجرَ لا ينتسبُ إليها المُنادي.
    expectCode(
      () =>
        assertActiveMembership({
          storeSlug: SLUG,
          actorPublicId: STAFF,
          storeOwnerPublicId: OWNER,
          existing: [member(MANAGER, "manager")],
        }),
      "STORE_NOT_FOUND",
    );
  });

  it("والمُزالُ ليسَ عضواً — الختمُ يُقرأُ إزالةً لا سجلّاً فقط", () => {
    expectCode(
      () =>
        assertActiveMembership({
          storeSlug: SLUG,
          actorPublicId: MANAGER,
          storeOwnerPublicId: OWNER,
          existing: [member(MANAGER, "manager", true)],
        }),
      "STORE_NOT_FOUND",
    );
  });

  it("ومتجرٌ بلا طاقمٍ يردُّ كلَّ مَن ليسَ مالكَهُ — لا يُقرأُ الفراغُ سماحاً", () => {
    expectCode(
      () =>
        assertActiveMembership({
          storeSlug: SLUG,
          actorPublicId: STAFF,
          storeOwnerPublicId: OWNER,
          existing: [],
        }),
      "STORE_NOT_FOUND",
    );
  });

  it("والمِلكيّةُ أضيقُ من العضويّةِ: عضوٌ ليسَ مالكاً يُرَدُّ", () => {
    // طلبُ المراجعةِ يكتبُ في الدفترِ `actorType` بقيمةِ المالكِ بلا شرطٍ،
    // فلو قُبِلَ فيهِ مُجرَّدُ عضوٍ لكذَبَ الدفترُ. والفرضُ هنا **يُصدِّقُ
    // دعوىً قائمةً** لا يخترعُ سياسةً جديدةً.
    expectCode(
      () =>
        assertActiveOwnership({
          storeSlug: SLUG,
          actorPublicId: STAFF,
          storeOwnerPublicId: OWNER,
        }),
      "STORE_NOT_FOUND",
    );
    expect(() =>
      assertActiveOwnership({ storeSlug: SLUG, actorPublicId: OWNER, storeOwnerPublicId: OWNER }),
    ).not.toThrow();
  });

  it("ورتبةُ `owner` في جدولِ الطاقمِ لا تصنعُ مالكاً — مصدرُ الحقيقةِ عمودُ المتجرِ", () => {
    // دعوىً تمنعُ الارتدادَ إلى `findActiveOwner`: مَن لهُ صفُّ طاقمٍ بدورِ
    // `owner` وليسَ صاحبَ العمودِ **ليسَ مالكاً**، وإلّا صارتْ ترقيةٌ في
    // جدولٍ ثانويٍّ طريقاً إلى سلطةِ المالكِ.
    expectCode(
      () =>
        assertActiveOwnership({
          storeSlug: SLUG,
          actorPublicId: MANAGER,
          storeOwnerPublicId: OWNER,
        }),
      "STORE_NOT_FOUND",
    );
  });
});

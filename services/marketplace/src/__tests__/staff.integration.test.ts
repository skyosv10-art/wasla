/**
 * الطاقمُ على قاعدةٍ حقيقيّة: مالكٌ نشطٌ واحدٌ، وعضويّةٌ نشطةٌ واحدةٌ، وإزالةٌ ختمٌ لا حذف.
 *
 * ثلاثةُ أشياءَ يستحيل إثباتُها في الذاكرة:
 *
 *  - `ux_store_staff_single_owner` فهرسٌ **جزئيّ** (`WHERE role='owner' AND removed_at IS NULL`):
 *    فحصٌ في الكودِ كان سيمرّ لمالكَين يُضافان في نفسِ اللحظةِ من طلبَين متزامنَين، فيصير للمتجرِ
 *    مالكانِ ولا يُعرف مَن يملك حقَّ الحذف.
 *  - `ux_store_staff_active_member` يمنع عضويّةً نشطةً مكرّرةً، ويسمح **بعودةِ** مَن أُزيل: صفٌّ
 *    جديدٌ بينما القديمُ مختومٌ. ولو كان الفهرسُ كلّيّاً لصار الطردُ نهائيّاً بلا رجعةٍ — عقوبةً
 *    لم يقرّرها أحد.
 *  - الختمُ يُغيّر حقلَين فارغَين ولا يُعيد كتابةَ ماضٍ، ويُفحَص أنّ عددَ الصفوفِ لا ينقص أبداً.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { activeStaff, assertSingleActiveOwner } from "../domain/staff.js";
import { draftStore } from "../domain/catalog.js";
import {
  MEMBER,
  MODERATOR,
  OWNER,
  PG_ENABLED,
  T0,
  T1,
  T2,
  countRows,
  rejectingConstraint,
  resetData,
  seedLeafCategory,
  setupPostgres,
  type PgFixture,
} from "./pg-harness.js";

const CATEGORY = { slug: "electronics-phones", depth: 2, isActive: true } as const;

describe.runIf(PG_ENABLED)("استمراريّةُ طاقمِ المتجر", () => {
  let pg: PgFixture;
  let storeId: string;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  afterAll(async () => {
    await pg.close();
  });

  beforeEach(async () => {
    await resetData(pg.pool);
    const categoryId = await seedLeafCategory(pg.stores);
    const store = await pg.stores.resources.insertStore(
      draftStore({
        ownerPublicId: OWNER,
        slug: "medina-dates",
        titleAr: "متجرُ تمورِ المدينة",
        categoryId,
        category: CATEGORY,
        activeStoreCount: 0,
      }),
    );
    storeId = store.storeId;
    await pg.stores.staff.insertMember(storeId, {
      memberPublicId: OWNER,
      role: "owner",
      addedByPublicId: OWNER,
      addedAt: T0,
    });
  });

  it("مالكٌ نشطٌ واحدٌ — والثاني يسقط بالفهرسِ الجزئيّ", async () => {
    await expect(
      pg.stores.staff.insertMember(storeId, {
        memberPublicId: "WS-1000000008",
        role: "owner",
        addedByPublicId: OWNER,
        addedAt: T1,
      }),
    ).rejects.toMatchObject({ code: "STORE_OWNER_ROLE_IMMUTABLE" });
    expect(await countRows(pg.pool, "store_staff")).toBe(1);
  });

  it("وعضويّةٌ نشطةٌ مكرّرةٌ مرفوضةٌ برمزٍ مُعلَن", async () => {
    await pg.stores.staff.insertMember(storeId, {
      memberPublicId: MEMBER,
      role: "staff",
      addedByPublicId: OWNER,
      addedAt: T1,
    });
    await expect(
      pg.stores.staff.insertMember(storeId, {
        memberPublicId: MEMBER,
        role: "manager",
        addedByPublicId: OWNER,
        addedAt: T2,
      }),
    ).rejects.toMatchObject({ code: "STORE_STAFF_ALREADY_MEMBER" });
  });

  it("والإزالةُ ختمٌ: الصفُّ يبقى ويزداد بياناً", async () => {
    await pg.stores.staff.insertMember(storeId, {
      memberPublicId: MEMBER,
      role: "staff",
      addedByPublicId: OWNER,
      addedAt: T1,
    });
    const sealed = await pg.stores.staff.sealRemoval({
      storeId,
      memberPublicId: MEMBER,
      removedAt: T2,
      removedByPublicId: OWNER,
    });
    expect(sealed?.removedAt).toBe(T2);
    expect(sealed?.removedByPublicId).toBe(OWNER);
    expect(await countRows(pg.pool, "store_staff")).toBe(2);
    expect(await pg.stores.staff.findActiveMember(storeId, MEMBER)).toBeUndefined();
    expect(activeStaff(await pg.stores.staff.listStaff(storeId))).toHaveLength(1);
  });

  it("وختمٌ ثانٍ لا يُعيد كتابةَ الأوّل", async () => {
    await pg.stores.staff.insertMember(storeId, {
      memberPublicId: MEMBER,
      role: "staff",
      addedByPublicId: OWNER,
      addedAt: T1,
    });
    await pg.stores.staff.sealRemoval({
      storeId,
      memberPublicId: MEMBER,
      removedAt: T2,
      removedByPublicId: OWNER,
    });
    const again = await pg.stores.staff.sealRemoval({
      storeId,
      memberPublicId: MEMBER,
      removedAt: T2,
      removedByPublicId: MODERATOR,
    });
    expect(again).toBeUndefined();
    const rows = await pg.stores.staff.listStaff(storeId);
    const member = rows.find((row) => row.memberPublicId === MEMBER);
    expect(member?.removedByPublicId).toBe(OWNER);
  });

  it("ومَن أُزيل يعود بصفٍّ جديدٍ لا بإحياءِ القديم", async () => {
    await pg.stores.staff.insertMember(storeId, {
      memberPublicId: MEMBER,
      role: "staff",
      addedByPublicId: OWNER,
      addedAt: T1,
    });
    await pg.stores.staff.sealRemoval({
      storeId,
      memberPublicId: MEMBER,
      removedAt: T2,
      removedByPublicId: OWNER,
    });
    await pg.stores.staff.insertMember(storeId, {
      memberPublicId: MEMBER,
      role: "manager",
      addedByPublicId: OWNER,
      addedAt: T2,
    });
    const rows = await pg.stores.staff.listStaff(storeId);
    expect(rows.filter((row) => row.memberPublicId === MEMBER)).toHaveLength(2);
    expect((await pg.stores.staff.findActiveMember(storeId, MEMBER))?.role).toBe("manager");
    expect(await countRows(pg.pool, "store_staff")).toBe(3);
  });

  it("وختمٌ بزمنٍ قبل الإضافةِ يسقط على قيدِ العقدِ باسمِه", async () => {
    await pg.stores.staff.insertMember(storeId, {
      memberPublicId: MEMBER,
      role: "staff",
      addedByPublicId: OWNER,
      addedAt: T2,
    });
    expect(
      await rejectingConstraint(
        pg.stores.staff.sealRemoval({
          storeId,
          memberPublicId: MEMBER,
          removedAt: T1,
          removedByPublicId: OWNER,
        }),
      ),
    ).toBe("ck_store_staff_removed_after_added");
  });

  it("والطاقمُ المقروءُ من القاعدةِ يجتاز حَكَمَ المجالِ على المالكِ الواحد", async () => {
    const rows = await pg.stores.staff.listStaff(storeId);
    expect(assertSingleActiveOwner(rows).memberPublicId).toBe(OWNER);
  });
});

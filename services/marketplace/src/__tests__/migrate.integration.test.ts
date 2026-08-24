/**
 * المُهاجرةُ تُطبّق العقدَ حرفاً — لا وصفاً له في الكود.
 *
 * هذا الملفُّ يفحص ما لا يفحصه حارسُ الانحراف: الحارسُ يقارن نصّاً بأنواعٍ، وهذا يُشغّل النصَّ
 * على Postgres حقيقيٍّ ويقرأ من `pg_tables` و`pg_constraint` و`pg_indexes` **ما وُجد فعلاً**.
 * وقد فشلت أطوارٌ سابقةٌ لأنّ العقدَ كان صحيحاً في الملفِّ ولم يُطبَّق قطّ.
 *
 * والفهارسُ الجزئيّةُ تُفحَص بالاسمِ لأنّها حرّاسُ تفرّدٍ لا تحسينُ سرعة: `ux_stores_owner_active`
 * هي وحدَها ما يمنع مالكاً من متجرَين نشطَين، وسقوطُها في مُهاجرةٍ لا يُظهر خطأً بل يُظهر سوقاً
 * يقبل ما مُنِع.
 *
 * وإعادةُ التشغيلِ تُفحَص كذلك: العقدُ كلُّه `IF NOT EXISTS`، فتشغيلٌ ثانٍ يجب أن يمرّ بلا خطأٍ
 * وبلا تكرارِ جدولٍ — وإلّا صار كلُّ نشرٍ يحتاج قاعدةً بِكراً.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyMarketplaceSchema } from "../db/migrate.js";
import { NOT_MIRRORED_TABLES } from "../db/schema.js";
import {
  PG_ENABLED,
  TABLES,
  constraintNames,
  indexNames,
  setupPostgres,
  tableNames,
  type PgFixture,
} from "./pg-harness.js";

describe.runIf(PG_ENABLED)("مُهاجرةُ السوقِ على Postgres حقيقيّ", () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await setupPostgres();
  });

  afterAll(async () => {
    await pg.close();
  });

  it("تُنشئ الجداولَ العشرةَ كلَّها — بما فيها ما لا مرآةَ له", async () => {
    const present = new Set(await tableNames(pg.pool));
    for (const table of TABLES) expect(present.has(table)).toBe(true);
    for (const table of NOT_MIRRORED_TABLES) expect(present.has(table)).toBe(true);
  });

  it("والقيودُ المُسمّاةُ موجودةٌ بأسمائها", async () => {
    const names = new Set(await constraintNames(pg.pool));
    for (const name of [
      "ck_store_categories_depth_parent",
      "ck_stores_first_approved_state",
      "ck_store_reviews_actor",
      "ck_store_reviews_reason_required",
      "ck_store_staff_removed_pair",
      "ck_store_staff_removed_after_added",
      "ck_products_published_moderated",
      "ck_product_reviews_actor",
      "ck_product_reviews_reason_required",
    ]) {
      expect(names.has(name)).toBe(true);
    }
  });

  it("والفهارسُ الجزئيّةُ حرّاسُ تفرّدٍ لا تحسين", async () => {
    const names = new Set(await indexNames(pg.pool));
    for (const name of [
      "ux_stores_slug_lower",
      "ux_stores_owner_active",
      "ux_store_reviews_sequence",
      "ux_store_staff_active_member",
      "ux_store_staff_single_owner",
      "ux_products_store_sku",
      "ux_product_reviews_sequence",
      "ux_inventory_adjustments_sequence",
      "ix_marketplace_outbox_unpublished",
    ]) {
      expect(names.has(name)).toBe(true);
    }
  });

  it("وتشغيلٌ ثانٍ يمرّ بلا خطأٍ وبلا جدولٍ مُكرَّر", async () => {
    const before = await tableNames(pg.pool);
    await applyMarketplaceSchema(pg.pool);
    expect(await tableNames(pg.pool)).toEqual(before);
  });

  it("ولا تبذر شيئاً: التصنيفاتُ في المراجعة 5/6", async () => {
    const result = await pg.pool.query<{ readonly count: string }>(
      "SELECT count(*)::text AS count FROM store_categories",
    );
    expect(result.rows[0]?.count).toBe("0");
  });
});

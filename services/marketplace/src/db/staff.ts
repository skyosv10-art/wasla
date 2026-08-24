/**
 * مخزنُ الطاقم: إضافةٌ وقراءةٌ و**ختمُ إزالةٍ** — ولا حذفَ صفٍّ بحال (القرار 8).
 *
 * ## القرار: الإزالةُ ختمٌ لا حذف
 *
 * `sealRemoval` تكتب `removed_at` و`removed_by_public_id` في صفٍّ حقلاهما فارغان. وهذا
 * التحديثُ الوحيدُ المسموحُ في هذا الملفِّ، وهو ليس إعادةَ كتابةِ ماضٍ: الصفُّ يقول «كان
 * عضواً من كذا إلى كذا» بدلاً من «كان عضواً»، والماضي يزداد بياناً لا يُبدَّل. أمّا `DELETE`
 * فكان سيمحو الجوابَ عن «مَن نشر هذا المنتج؟» بعد أن يترك الموظّفُ المتجرَ — وهو أوّلُ سؤالٍ
 * في أيِّ نزاعِ اعتدال، ومحروسٌ بلا استثناءٍ في `purity.test.ts`.
 *
 * ## والشرطُ `removed_at IS NULL` في `WHERE` ليس تجميلاً
 *
 * ختمٌ بلا هذا الشرطِ كان سيسمح بختمِ صفٍّ مُزالٍ ثانيةً بفاعلٍ وزمنٍ جديدَين، فيصير تاريخُ
 * الإزالةِ آخرَ مَن ضغط الزرَّ لا مَن أزال فعلاً. والدالّةُ تُعيد `undefined` إن لم يُطابق صفٌّ
 * (غيرُ موجودٍ أو مُزالٌ سابقاً)، والقرارُ في ذلك للمُنادي: 404 أو تكرارٌ مقبول.
 *
 * ## ولا فحصَ دورٍ ولا حكمَ صلاحيّةٍ هنا
 *
 * `assertStaffAddition` و`assertRoleChange` و`assertStaffRemoval` و`sealStaffRemoval` كلُّها
 * في `domain/staff.ts`، ومُقابلُها في القاعدةِ فهرسان جزئيّان (`ux_store_staff_active_member`
 * و`ux_store_staff_single_owner`) يُترجَمان في `constraints.ts`. والمخزنُ يكتب ويقرأ.
 */

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { DbOrTx } from "./client.js";
import { translateConstraint } from "./constraints.js";
import { storeStaff } from "./schema.js";
import { toStoreStaff, type StoreStaffRecord } from "./rows.js";
import { validationFailed } from "../domain/errors.js";
import type { StoreStaffEntry } from "../domain/model.js";

export class PostgresStaffStore {
  constructor(private readonly db: DbOrTx) {}

  async insertMember(storeId: string, entry: StoreStaffEntry): Promise<StoreStaffRecord> {
    try {
      const rows = await this.db
        .insert(storeStaff)
        .values({
          staffId: sql`gen_random_uuid()`,
          storeId,
          memberPublicId: entry.memberPublicId,
          role: entry.role,
          addedByPublicId: entry.addedByPublicId,
          addedAt: new Date(entry.addedAt),
          removedAt: entry.removedAt === undefined ? null : new Date(entry.removedAt),
          removedByPublicId: entry.removedByPublicId ?? null,
        })
        .returning();
      const row = rows[0];
      if (!row) throw validationFailed("store_staff", "one inserted row");
      return toStoreStaff(row);
    } catch (error) {
      throw translateConstraint(error, { memberPublicId: entry.memberPublicId }) ?? error;
    }
  }

  /** الطاقمُ كلُّه — المُزالُ والنشطُ — مرتّباً بلحظةِ الإضافةِ ثمّ بالمُعرّفِ العلنيّ. */
  async listStaff(storeId: string): Promise<ReadonlyArray<StoreStaffRecord>> {
    const rows = await this.db
      .select()
      .from(storeStaff)
      .where(eq(storeStaff.storeId, storeId))
      .orderBy(asc(storeStaff.addedAt), asc(storeStaff.memberPublicId));
    return rows.map(toStoreStaff);
  }

  async findActiveMember(
    storeId: string,
    memberPublicId: string,
  ): Promise<StoreStaffRecord | undefined> {
    const rows = await this.db
      .select()
      .from(storeStaff)
      .where(
        and(
          eq(storeStaff.storeId, storeId),
          eq(storeStaff.memberPublicId, memberPublicId),
          isNull(storeStaff.removedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toStoreStaff(row);
  }

  /**
   * يختم إزالةَ عضوٍ نشطٍ بلحظةٍ وفاعلٍ مُسمّىً، أو `undefined` إن لم يكن نشطاً.
   *
   * القيدُ `ck_store_staff_removed_pair` يمنع ختماً بنصفِ بيانٍ (زمنٌ بلا فاعلٍ أو فاعلٌ بلا
   * زمن)، و`ck_store_staff_removed_after_added` يمنع إزالةً قبل الإضافة. فهذه الدالّةُ لا
   * تفحصهما في الكودِ ثانيةً: تمريرُ حقلَين معاً بنوعٍ إلزاميٍّ يجعل نصفَ البيانِ غيرَ قابلٍ
   * للتعبيرِ أصلاً.
   */
  async sealRemoval(input: {
    readonly storeId: string;
    readonly memberPublicId: string;
    readonly removedAt: string;
    readonly removedByPublicId: string;
  }): Promise<StoreStaffRecord | undefined> {
    const rows = await this.db
      .update(storeStaff)
      .set({
        removedAt: new Date(input.removedAt),
        removedByPublicId: input.removedByPublicId,
      })
      .where(
        and(
          eq(storeStaff.storeId, input.storeId),
          eq(storeStaff.memberPublicId, input.memberPublicId),
          isNull(storeStaff.removedAt),
        ),
      )
      .returning();
    const row = rows[0];
    return row === undefined ? undefined : toStoreStaff(row);
  }
}

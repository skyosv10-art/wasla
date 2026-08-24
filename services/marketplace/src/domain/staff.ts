/**
 * الطاقم: ثلاثةُ أدوارٍ مُقفَلةٌ، مالكٌ واحدٌ لا يُعدَّل، وإزالةٌ بختمٍ لا بحذف.
 *
 * ADR-016 القرار 8. الأدوارُ `owner | manager | staff` تُقرأ من العقد، ولا رابعَ يُخترَع في
 * الخدمة: دورٌ رابعٌ في الشيفرةِ بلا قيدٍ في المخطّطِ يعني صفّاً يُكتَب فيسقط، أو — أسوأ — قيداً
 * يُوسَّع بلا أن يعرف أحدٌ ما يقدر عليه الدورُ الجديد.
 *
 * ## لماذا مالكٌ واحدٌ لا أكثر
 *
 * لأنّ المُلكيّةَ **مرجعُ المسؤولية**: من يُسأل عن متجرٍ عند شكوى، ومن يُحسَب متجرُه في حدِّ
 * المتاجرِ النشطة (`ux_stores_owner_active`). ولو جاز مالكان لصار الحدُّ بلا معنىً (متجرٌ واحدٌ
 * يُحسَب على اثنَين أو على لا أحد)، ولصار كلُّ قرارٍ إداريٍّ يسأل «أيُّ المالكَين؟». والمشاركةُ
 * في الإدارةِ حقٌّ محفوظٌ بدورِ `manager`، وهو يفعل كلَّ شيءٍ إلّا أن يكون المرجع.
 *
 * ## لماذا دورُ المالكِ لا يُعدَّل ولا يُنزَع
 *
 * `STORE_OWNER_ROLE_IMMUTABLE` رمزٌ مُعلَنٌ في الكتالوجِ لأنّ الحالةَ متوقّعةٌ لا استثنائيّة:
 * يُحاول مديرٌ أن يُخفّض المالكَ أو يُزيله. ولو جاز ذلك لأمكن أن يبقى متجرٌ **بلا مالكٍ أصلاً**
 * — صفوفُ طاقمٍ بلا مرجعٍ ومتجرٌ لا يُسأل عنه أحد؛ وهو وضعٌ لا يُصلَح إلّا بكتابةٍ يدويّةٍ في
 * القاعدة. ونقلُ المُلكيّةِ حين يُطلَب سيكون **عمليّةً مُعلَنةً** تكتب سطرَين في الدفترِ لا
 * تعديلَ حقلٍ صامتاً، وهي ليست في هذا الطور.
 *
 * ## لماذا الإزالةُ ختمٌ (`removed_at`) لا حذفُ صفّ
 *
 * القرار 9: لا حذفَ صلباً في هذا السوق. صفٌّ يُحذَف يجعل سؤالَ «من أضاف هذا الموظّفَ الذي حذف
 * منتجاتٍ في مارس؟» بلا جوابٍ، ويجعل إعادةَ إضافةِ نفسِ العضوِ لاحقاً تُظهِره كأنّه لم يكن
 * قبلاً. والختمُ يُبقي السطرَ ويُخرجه من الطاقمِ الفعّال، وهو **نهائيٌّ**: صفٌّ مختومٌ لا
 * يُفَكُّ ختمُه، وعودةُ العضوِ صفٌّ جديدٌ بزمنٍ جديدٍ وفاعلٍ جديد.
 */

import { STORE_STAFF_ROLES, type StoreStaffRole } from "./contract-sets.js";
import { storeOwnerRoleImmutable, validationFailed } from "./errors.js";
import type { StoreStaffEntry } from "./model.js";

/** دورٌ مقبولٌ من قائمةِ العقدِ المُقفَلة. */
export function assertStaffRole(value: unknown, field = "role"): StoreStaffRole {
  if (typeof value !== "string" || !(STORE_STAFF_ROLES as readonly string[]).includes(value)) {
    throw validationFailed(field, `one of ${STORE_STAFF_ROLES.join(" | ")}`);
  }
  return value as StoreStaffRole;
}

/** الطاقمُ الفعّال: ما لم يُختَم. الإسقاطُ الوحيدُ الذي تُقاس عليه القدرةُ على الفعل. */
export function activeStaff(entries: readonly StoreStaffEntry[]): StoreStaffEntry[] {
  return entries.filter((entry) => entry.removedAt === undefined);
}

/** مالكُ المتجرِ الفعّال إن وُجد. تُستعمَل قبل كلِّ قرارٍ يسأل «من المرجع؟». */
export function findActiveOwner(entries: readonly StoreStaffEntry[]): StoreStaffEntry | undefined {
  return activeStaff(entries).find((entry) => entry.role === "owner");
}

/**
 * حرسُ وحدانيّةِ المالكِ على طاقمٍ كامل: مالكٌ فعّالٌ واحدٌ لا صفرٌ ولا اثنان.
 *
 * الصفرُ مرفوضٌ مثلَ الاثنَين، وهذا مقصود: طاقمٌ بلا مالكٍ فعّالٍ يعني متجراً فقد مرجعَه، وهو
 * ما تمنعه القواعدُ أعلاه عند كلّ عمليّة — وهذه الدالّةُ تُثبته على المجموعِ كلِّه فتكشف أيَّ
 * ثغرةٍ سبقت. ومطابقُها في المخطّط: `ux_store_staff_single_owner`.
 */
export function assertSingleActiveOwner(entries: readonly StoreStaffEntry[]): StoreStaffEntry {
  const owners = activeStaff(entries).filter((entry) => entry.role === "owner");
  if (owners.length !== 1) {
    throw validationFailed("role", "exactly one active owner per store");
  }
  return owners[0] as StoreStaffEntry;
}

/**
 * إضافةُ عضوٍ: الدورُ `manager` أو `staff` فقط، والمالكُ لا يُضاف بهذا المسار.
 *
 * المالكُ يُنشَأ مع المتجرِ (`draftStore` + سطرُ طاقمٍ واحدٌ في نفسِ المعاملة، المراجعة 3/6)،
 * ولو قَبِل مسارُ الإضافةِ دورَ مالكٍ لصار للمتجرِ مالكان بمسارٍ مشروعٍ ظاهراً، ولما نفع قيدُ
 * القاعدةِ إلّا رسالةَ خطأٍ لا يفهمها من طلب.
 */
export function assertStaffAddition(input: {
  role: StoreStaffRole;
  memberPublicId: string;
  existing: readonly StoreStaffEntry[];
}): StoreStaffRole {
  if (input.role === "owner") throw storeOwnerRoleImmutable(input.memberPublicId);
  const active = activeStaff(input.existing);
  if (active.some((entry) => entry.memberPublicId === input.memberPublicId)) {
    throw validationFailed("member_public_id", "a member that is not already active in this store");
  }
  return input.role;
}

/**
 * تعديلُ دورِ عضو. المالكُ لا يُخفَّض، وأحدٌ لا يُرقّى مالكاً؛ والمختومُ لا دورَ له يُعدَّل.
 *
 * الترتيبُ مقصود: يُفحَص المالكُ أوّلاً لأنّه الجوابُ الأدقُّ. لو فُحِص الختمُ أوّلاً لقيل لمن
 * يحاول تعديلَ مالكٍ مُزال «هذا الصفُّ مختوم»، فيُعيد المحاولةَ على المالكِ الفعّالِ فيُرفَض
 * لسببٍ آخرَ لم يكن يعرفه.
 */
export function assertRoleChange(input: {
  member: StoreStaffEntry;
  nextRole: StoreStaffRole;
}): StoreStaffRole {
  if (input.member.role === "owner" || input.nextRole === "owner") {
    throw storeOwnerRoleImmutable(input.member.memberPublicId);
  }
  if (input.member.removedAt !== undefined) {
    throw validationFailed("member_public_id", "an active (not removed) staff member");
  }
  return input.nextRole;
}

/** إزالةُ عضو: المالكُ لا يُزال، والمختومُ لا يُختَم مرّتَين (الختمُ نهائيٌّ لا يُنقَض). */
export function assertStaffRemoval(member: StoreStaffEntry): void {
  if (member.role === "owner") throw storeOwnerRoleImmutable(member.memberPublicId);
  if (member.removedAt !== undefined) {
    throw validationFailed("member_public_id", "an active (not already removed) staff member");
  }
}

/**
 * ختمُ الإزالة: زمنٌ **وفاعلٌ** معاً أو لا شيء، حرفاً بحرفٍ كقيدِ `ck_store_staff_removal`.
 *
 * ولمَ الاثنان معاً؟ لأنّ زمناً بلا فاعلٍ يقول «أُزيل» ولا يقول «من أزال»، فتصير إزالةُ موظّفٍ
 * — وهي قرارٌ يمنع إنساناً من عملٍ — فعلاً بلا صاحب.
 */
export function sealStaffRemoval(input: {
  member: StoreStaffEntry;
  removedAt: string;
  removedByPublicId: string;
}): StoreStaffEntry {
  assertStaffRemoval(input.member);
  return {
    ...input.member,
    removedAt: input.removedAt,
    removedByPublicId: input.removedByPublicId,
  };
}

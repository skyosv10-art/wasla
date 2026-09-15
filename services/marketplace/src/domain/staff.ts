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
import {
  storeNotFound,
  storeOwnerRoleImmutable,
  storeStaffAlreadyMember,
  validationFailed,
} from "./errors.js";
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
    /**
     * عضويّةٌ نشطةٌ مكرّرةٌ رمزُها `STORE_STAFF_ALREADY_MEMBER` لا رمزُ تحقُّقٍ عامّ.
     *
     * وهذا صُحِّح في المراجعة 4/6 حين ظهر الحدُّ: العقدُ يُعلن `409` لهذه الحقيقةِ،
     * والقيدُ `ux_store_staff_active_member` يترجم إلى الرمزِ نفسِه في `db/constraints.ts` —
     * فكان في الخدمةِ جوابان لحقيقةٍ واحدةٍ، والفحصُ المجاليُّ يسبق القاعدةَ دائماً فلا
     * يُقرأ رمزُ القيدِ من السلكِ أبداً. و`400` تقول للعميل «أصلِح مُدخلَك» وهو لا يستطيع:
     * المُدخلُ صحيحٌ والحالةُ هي المانع، وذلك معنى `409` بالضبط.
     */
    throw storeStaffAlreadyMember(input.memberPublicId);
  }
  return input.role;
}

/**
 * **عضويّةُ الفاعلِ في المُستأجِرِ** — حرسُ `M1-05B` الموجةُ 2 · `RISK-0042` البندُ 2.
 *
 * ── ما كانَ ولِمَ تغيَّرَ ──────────────────────────────────────────────────
 * كانَ `storeSlug` يُقرأُ من المسارِ ويُسلَّمُ إلى المُستودَعِ **بلا سؤالٍ واحدٍ
 * عن علاقةِ الفاعلِ بالمتجرِ**، والصلاحيّةُ (`marketplace:staff:write` مثلاً)
 * تُقاسُ على مستوى **الحدِّ** لا المُستأجِرِ. فحاملُها — أيَّ متجرٍ كانَ — يكتبُ
 * في طاقمِ **كلِّ** متجرٍ بتبديلِ حرفٍ في المسارِ. وهذا هوَ بُعدُ المُستأجِرِ
 * الذي كانَ **صِفراً** في مصفوفةِ السياساتِ كلِّها.
 *
 * ── ولمَ الغيابُ يُجابُ `STORE_NOT_FOUND` لا `403` ────────────────────────
 * لأنَّ متجراً لا تنتسبُ إليهِ **لا يوجدُ لكَ**. و`403` كانَ يُجيبُ سؤالاً لم
 * يُسأَلْ: «هذا المتجرُ قائمٌ وأنتَ لستَ منهُ» — فيصيرُ الحدُّ كاشفاً لوجودِ
 * المتاجرِ بتبديلِ الـslug، وهوَ **مِسبارُ إحصاءٍ** لا رفضٌ. والرمزُ مُعلَنٌ في
 * `contracts/errors.md` بمعنىً يشملُ هذهِ الحالةَ نصّاً: «طاقمٌ أو إنشاءُ منتجٍ
 * في slug لا وجودَ لهُ» — **فلا رمزَ جديدٌ ولا تغييرَ عقدٍ**.
 *
 * ── وما لا يُدَّعى ────────────────────────────────────────────────────────
 * هذا يفرضُ **الانتسابَ** لا **الرتبةَ**: عضوٌ بدورِ `staff` يمرُّ من هنا كما
 * يمرُّ المالكُ. وتمييزُ الرتبِ داخلَ المتجرِ الواحدِ سؤالٌ آخرُ يحتاجُ رمزَ
 * خطأٍ ثالثاً وتغييرَ عقدٍ، **ومسجَّلٌ بندَ دَينٍ صريحاً** في
 * `RISK_REGISTER.md` — ولم يُدسَّ هنا نصفَ نموذجِ رتبٍ بلا قرارٍ مكتوبٍ.
 *
 * ── تصحيحٌ مقيسٌ: المالكُ **ليسَ** صفّاً في `store_staff` ─────────────────
 * كُتِبَ أوّلُ إصدارٍ من هذا الحارسِ يسألُ `activeStaff(existing)` وحدَها.
 * فأسقطَ **خمسةً وأربعينَ** اختبارَ تكاملٍ فوقَ Postgres حقيقيٍّ بـ
 * `STORE_NOT_FOUND` على مالكِ المتجرِ نفسِهِ. والسببُ مقيسٌ لا مُستنتَجٌ:
 * `registerStore` يكتبُ `stores.owner_public_id` **ولا يكتبُ صفَّ طاقمٍ
 * بدورِ `owner`** — وصفُّ المالكِ في `store_staff` يُنشَأُ يدويّاً في بعضِ
 * المُهيِّئاتِ فقط. فمصدرُ الحقيقةِ للمِلكيّةِ عمودُ المتجرِ، و`store_staff`
 * جدولُ **مَن أُضيفَ**، لا جدولُ **مَن يملكُ**.
 *
 * ولولا تشغيلُ المحرّكِ الحقيقيِّ لمرَّتِ الدفعةُ خضراءَ في الذاكرةِ ثمَّ
 * أقفلَتِ المتاجرَ على أصحابِها في الإنتاجِ. يُسجَّلُ هنا لا في رسالةِ
 * التزامٍ تُنسى.
 *
 * ولا يُعادُ صفٌّ: المالكُ بلا صفٍّ، فإعادةُ صفٍّ للموظّفِ وعدمُها للمالكِ
 * كانت ستُغري المُنادِيَ بقراءةِ الغيابِ نفياً للعضويّةِ.
 */
export function assertActiveMembership(input: {
  storeSlug: string;
  actorPublicId: string;
  storeOwnerPublicId: string;
  existing: readonly StoreStaffEntry[];
}): void {
  if (input.actorPublicId === input.storeOwnerPublicId) return;
  const member = activeStaff(input.existing).find(
    (entry) => entry.memberPublicId === input.actorPublicId,
  );
  if (member === undefined) throw storeNotFound(input.storeSlug);
}

/**
 * ملكيّةُ الفاعلِ لا مُجرَّدُ عضويّتِهِ — حيثُ يكتبُ الدفترُ `actorType` مالكاً.
 *
 * والغيابُ يُجابُ `STORE_NOT_FOUND` للسببِ عينِهِ المكتوبِ في
 * `assertActiveMembership`، **ومن ثمَّ لا يُفرَّقُ من السلكِ بينَ «لستَ منهُ»
 * و«أنتَ منهُ ولكنَ لا مالكُهُ»**: التفريقُ كانَ يُخبِرُ مديراً أنَّ للمتجرِ
 * مالكاً أخرَ غيرَهُ — وهيَ حقيقةٌ لا تلزمُ لإتمامِ نداءٍ مرفوضٍ.
 *
 * ── ومصدرُ الحقيقةِ عمودُ المتجرِ لا صفُّ الطاقمِ ──────────────────────────
 * كانَ أوّلُ إصدارٍ يقرأُ `findActiveOwner(existing)`، وقد **قِيسَ** أنَّ
 * تسجيلَ المتجرِ لا يكتبُ صفَّ طاقمٍ بدورِ `owner` أصلاً (انظرْ التصحيحَ في
 * `assertActiveMembership`). فصارَ يُقارَنُ بـ`stores.owner_public_id`.
 *
 * و`findActiveOwner` يبقى لِما بُنيَ لهُ: حَكَمُ «مالكٌ نشِطٌ واحدٌ» على صفوفِ
 * الطاقمِ حيثُ وُجِدَتْ، لا مُعرِّفُ صاحبِ المتجرِ.
 */
export function assertActiveOwnership(input: {
  storeSlug: string;
  actorPublicId: string;
  storeOwnerPublicId: string;
}): void {
  if (input.actorPublicId !== input.storeOwnerPublicId) {
    throw storeNotFound(input.storeSlug);
  }
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

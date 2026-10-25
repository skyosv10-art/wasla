# CLM-0606 — G-T1: أسماءُ ثلاثةِ اختباراتٍ تطابقُ توكيداتِها

**الحجزُ:** CLM-0606 · **العنصرُ:** M0-53 · **الأساسُ:** `dfff119ab37673e7283703447c0aa67410381218` (main بعدَ دمجِ #756 / CLM-0605 — أُعيدَ التأسيسُ عليه).

## §1 القياسُ (من [CLM-0602 §8](../2026-10-18T041600Z-clm-0602-screen-state-traceability/README.md))

| الملفُّ | الاسمُ القديمُ | ما يؤكّدُه الجسمُ فعلًا | الاسمُ الجديدُ |
|---|---|---|---|
| `apps/customer-mini-app/src/__tests__/Home.test.tsx` L12 | `renders all seven menu items` | حضورُ 7 نصوصٍ (`getByText` × 7 · L14-20) — **لا العددَ** | `renders each of the seven spec menu items (presence, not count)` |
| `apps/driver-mini-app/src/__tests__/JobDetail.test.tsx` L112 | `shows arrived button when status is in_progress` | `transition-completed` (L118) | `shows the complete transition button when status is in_progress` |
| `apps/admin-portal/e2e/audit-rbac.spec.ts` L123 | `PUT to audit events returns 405` | لا `form[action*='edit' i]` في صفحةِ التدقيقِ (L127-128) — واجهةٌ محاكاةٌ، لا HTTP | `audit page exposes no form to edit audit events (UI only — HTTP 405 is proven in services/audit)` |

## §2 ما تغيّرَ وما لم يتغيّرْ

- **تغيّرَ:** سطرُ الاسمِ فقط في كلِّ ملفٍّ (3 أسطرٍ · `git diff -U0` يُظهرُ 3 حذوفٍ و3 إضافاتٍ لا غير).
- **لم يتغيّرْ:** أيُّ توكيدٍ أو إعدادٍ أو محدِّدٍ. لا اختبارَ حُذفَ أو تُخطِّيَ.
- الاسمُ الإداريُّ الجديدُ يحيلُ إلى 405 في `services/audit` — صحيحٌ **بعدَ** دمجِ CLM-0605 (#756) فقط، ولذلك هذا الفرعُ مكدَّسٌ عليه.
- عددُ عناصرِ Home وتوكيدُ العددِ موضوعُ G-S7 (ADR-072 D1) — شريحةٌ مستقلةٌ.

## §3 القياسُ المحليُّ

vitest: العميلُ 72/72 · السائقُ 132/132 · الإدارةُ 101/101 (مطابقٌ للأساسِ) · Playwright `audit-rbac.spec.ts`: 9/9 بالاسمِ الجديدِ.

## §4 الحوكمةُ (الأساسُ `dfff119a` · pnpm على PATH)

`validate-state-sync.sh` PASS (أوّلُ تشغيلٍ رفضَ مدخلَ TASK_LOG لأنه لم يُسمِّ الوحداتِ `apps/*` — أُضيفتْ) · `validate-work-claims.sh` نجح · `require-doc-update.sh` OK · `verify-governance.sh` exit 0 + **تخطٍّ معلَنٌ: الفحصُ 8** (لقطةٌ مؤرَّخةٌ 2026-09-28T06:48:00Z).

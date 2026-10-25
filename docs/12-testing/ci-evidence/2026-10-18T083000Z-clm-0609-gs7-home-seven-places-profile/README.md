# CLM-0609 — G-S7: Home العميلِ 7 عناصرَ · الأماكنُ المحفوظةُ من Profile (ADR-072 D1)

**الحجزُ:** CLM-0609 · **العنصرُ:** M0-53 · **الأساسُ:** `98f3d0d5c48c35189f4ddd686d6bbe3726890268` (main بعدَ دمجِ #759 / CLM-0608 — أُعيدَ التأسيسُ عليه؛ ما بينَ الأساسينِ وثائقُ فقط فالقياسُ المحليُّ قائمٌ) · **القرارُ:** [ADR-072](../../../15-decisions/ADR-072-owner-decisions-gs7-uat08.md) D1 — «أعتمد التوصية».

## §1 القياسُ قبلَ

`src/screens/Home.tsx`: 8 عناصرَ — `ride · delivery · **places** · marketplace · search · myOrders · reputation · profile`. Profile بلا مدخلٍ إلى الأماكنِ. E2E «home shows all 8 menu items». المصدرُ: CMS §3.1 و USER_FLOWS §2.4 = 7 عناصرَ · CMS §3.8: «إدارة الأماكن المحفوظة (إضافة/حذف)» داخلَ «حسابي».

## §2 التغييرُ

| الملفُّ | التغييرُ |
|---|---|
| [`Home.tsx`](../../../../apps/customer-mini-app/src/screens/Home.tsx) | حُذفَ عنصرُ `places` → 7 بترتيبِ المصدرِ حرفيًّا (🚗 · 📦 · 🛍 · 🔎 · 📋 · ⭐ · 👤) |
| [`Profile.tsx`](../../../../apps/customer-mini-app/src/screens/Profile.tsx) | قسمُ «الأماكن المحفوظة» (`h2`) برابطٍ `#/places` (`data-testid="profile-places-link"`) — مسارُ `#/places` وشاشتُه وعقدُ `/customers/{id}/places` **دونَ تغييرٍ**؛ لا مفاتيحَ ترجمةٍ جديدةٌ (`places.title` قائمٌ في ar/en/ur) |

## §3 الاختباراتُ (التوكيدُ لا الاسمُ)

| ما يُثبَتُ | الاختبارُ | التوكيدُ |
|---|---|---|
| **العددُ النهائيُّ 7 والترتيبُ** | U [`Home.test.tsx`](../../../../apps/customer-mini-app/src/__tests__/Home.test.tsx) L24 | `getAllByRole("link")` طولُه 7 · `href`s `toEqual` ترتيبَ المصدرِ · لا «الأماكن المحفوظة» · لا `#/places` |
| العددُ في المتصفّحِ | E [`navigation.spec.ts`](../../../../apps/customer-mini-app/e2e/navigation.spec.ts) L15 | `.home nav a` `toHaveCount(7)` · 7 نصوصٍ ظاهرةٌ · «الأماكن المحفوظة» `toHaveCount(0)` · لا `a[href="#/places"]` (كانَ «all 8 menu items» — السلوكُ تغيّرَ بقرارٍ) |
| مدخلُ Profile | U [`Profile.test.tsx`](../../../../apps/customer-mini-app/src/__tests__/Profile.test.tsx) L120 | `href`=`#/places` · النصُّ · عنوانُ `h2` |
| **التنقّلُ + الإضافةُ + الحذفُ من Profile** | E [`places-flow.spec.ts`](../../../../apps/customer-mini-app/e2e/places-flow.spec.ts) L123 | نقرُ `profile-places-link` → URL `#/places` · `h1` · إضافةُ «Gym» تظهرُ · حذفُ `place-1` يُخفي «Home» ويبقى «Gym» |
| الإضافةُ/الحذفُ على الشاشةِ (قائمانِ) | U `SavedPlaces.test.tsx` L73 · L97 · E `places-flow.spec.ts` | دونَ تغييرٍ |

المحليُّ: vitest **74/74** (كانت 72: +2) · Playwright **36/36** (كانت 35: +1، وعُدِّلَ واحدٌ) — [raw/unit](raw/unit-customer-mini-app.txt) · [raw/e2e](raw/e2e-customer-mini-app.txt). `tsc --noEmit` = 0.

**طفراتٌ مقيسةٌ (أُعيدتِ الملفّاتُ بعدَها):** (أ) إعادةُ `places` إلى Home → يُخفقُ U L24 ويُخفقُ E «exactly the seven» (`toHaveCount`) · (ب) رابطُ Profile إلى `#/home` → يُخفقُ U L120 ويُخفقُ E L123 (`toHaveURL`).

## §4 حدودُ الدليلِ

E2E Playwright يحاكي الـAPI بـ`page.route` — دليلُ واجهةٍ وتنقّلٍ، **لا** تكاملٍ حيٍّ مع `services/customers`. لا تغييرَ في العقدِ ولا في الخدمةِ.

## §5 الحوكمةُ (الأساسُ `98f3d0d5` · pnpm على PATH)

الفحوصُ الأربعةُ exit 0 · `verify-governance.sh` + **تخطٍّ معلَنٌ: الفحصُ 8** (لقطةٌ مؤرَّخةٌ 2026-09-28T06:48:00Z). `apps/**` ← render-deploy بعدَ الدمجِ.

## §6 الإغلاقُ

G-S7 · RQ-CMA-7 · RQ-CMA-54 مفتوحةٌ حتى الدمجِ ونجاحِ CI على main.

/**
 * إعدادٌ واحدٌ، ويُضمّنُ ملفَّ `.e2e.test.ts` **عن قصدٍ**.
 *
 * كلُّ حزمةٍ أخرى في هذا المستودعِ تستثني `*.{integration,e2e}.test.ts` كي يبقى
 * `pnpm -r test` أخضرَ بلا قاعدةِ بيانات. وهذه الحزمةُ استثناءٌ مُعلَنٌ حادِيَ
 * عشَرَ أخواتِها (channel · customer · order · dispatch · driver · negotiation ·
 * reputation · subscription · search · marketplace) ولنفسِ السبب: فيها **بوّابةُ
 * خروجِ الطورِ 13**، وبوّابةٌ يمكن تخطّيها ليست بوّابةً.
 *
 * وبغيابِ `DATABASE_URL` يتخطّى الملفُّ نفسَه (`describe.skipIf`) فيبقى
 * `pnpm -r test` أخضرَ على جهازٍ بلا قاعدةٍ — **ولذلك وجودُ وظيفةِ CI هوَ ما
 * يجعلُ البوّابةَ بوّابةً** لا هذا الملفُّ وحدَه. والوظيفةُ
 * `delivery-exit-gate-e2e` في `.github/workflows/ci.yml` و`.gitlab-ci.yml`.
 *
 * `fileParallelism: false` لأنَّ الملفَّ يرفعُ **مُستمعَينِ** حقيقيَّينِ ويملكُ
 * مخطَّطَ خدمتَينِ على قاعدةٍ واحدةٍ يُسقِطُهُ ويُعيدُ بناءَهُ؛ وملفٌّ ثانٍ يجري
 * بالتوازي كانَ سيُسقِطُ جداولَ الأوّلِ وهوَ يعملُ — والعطبُ حينَها يظهرُ تقلّباً
 * لا خطأً، وهوَ عينُ العيبِ الذي أنشأَ `validate-integration-isolation.sh`.
 *
 * والمهلةُ 120 ثانيةً لا 30: البوّابةُ تسوقُ رحلتَينِ كاملتَينِ عبرَ الشبكةِ —
 * متجرٌ فمراجعةٌ فقرارٌ فمنتجٌ فاعتدالٌ فمخزونٌ فنشرٌ في السوقِ، ثمّ طلبٌ فمرآةُ
 * دفعٍ فتأكيدٌ في التوصيلِ، ثمّ ناقلُ مخزونٍ — على قاعدةٍ بعيدةٍ (Supabase في
 * التطويرِ) لا محلّيّةٍ، فالمهلةُ للشبكةِ لا للحسابِ.
 *
 * التفصيل في docs/12-testing/PHASE13_EXIT_GATE_E2E.md.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/*.e2e.test.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});

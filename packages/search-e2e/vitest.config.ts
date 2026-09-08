/**
 * إعدادٌ واحدٌ، ويُضمِّنُ ملفَّ `*.e2e.test.ts` **عن قصد** — وهو الاستثناءُ المُعلَنُ العاشرُ.
 *
 * كلُّ حزمةٍ أخرى في هذا المستودعِ تستثني `*.{integration,e2e}.test.ts` كي يبقى `pnpm -r test`
 * أخضرَ بلا قاعدةِ بيانات. وهذه الحزمةُ تاليةُ تسعِ أخواتٍ (channel-e2e · customer-e2e ·
 * order-e2e · dispatch-e2e · driver-e2e · negotiation-e2e · reputation-e2e · subscription-e2e ·
 * marketplace-e2e) ولنفسِ السببِ: فيها **بوّابةُ خروجِ الطورِ 12**، وبوّابةٌ يمكن تخطّيها ليست
 * بوّابة.
 *
 * وبغيابِ `DATABASE_URL` يتخطّى الملفُّ نفسَه (`describe.skipIf`) فيبقى `pnpm -r test` أخضرَ على
 * جهازٍ بلا قاعدة — **ولذلك وجودُ وظيفةِ CI هو ما يجعلُ البوّابةَ بوّابةً** لا هذا الملفُّ وحدَه.
 * والوظيفةُ هنا `exit-gate-e2e (search, @wasla/search-e2e, wasla_search_e2e, DATABASE_URL)` في
 * `.github/workflows/ci.yml`، ونظيرتُها في `.gitlab-ci.yml` — وخلافاً لأخواتِها **هذه تركضُ
 * فعلاً على المُشغِّل** (لا `RISK-0001`) لأنّ الخطَّ الحاكمَ صارَ GitHub Actions (ADR-023).
 *
 * `fileParallelism: false` لأنّ الملفَّ يملكُ مخطّطَ قاعدةٍ يُسقطُهُ ويُعيدُ بناءَهُ ويبذرُ فيه
 * ألفَي وثيقةٍ؛ وملفٌّ ثانٍ يجري بالتوازي كان سيُسقطُ جداولَ الأوّلِ وهو يقيسُ زمنَ استجابةٍ —
 * فيظهرُ العطبُ **تقلّباً في الأرقامِ** لا خطأً، وهو أسوأُ ما يقعُ في بوّابةِ حملٍ.
 *
 * والمهلةُ 180 ثانيةً لا 120: البوّابةُ تبني الفهرسَ بالناقلِ الحقيقيِّ من صندوقِ صادرٍ حقيقيٍّ،
 * ثمّ تبذرُ حملاً، ثمّ تُطلقُ مئاتِ النداءاتِ عبرَ الشبكةِ وتقيسُ مئينيّاتِها. تجري في ثوانٍ
 * محلّيّاً، والهامشُ لحاويةِ CI الباردةِ ولقُرصِ `postgres:15` فيها.
 *
 * التفصيل في docs/12-testing/PHASE12_EXIT_GATE_E2E.md.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/*.e2e.test.ts"],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});

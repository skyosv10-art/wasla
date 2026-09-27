/**
 * بوّابةُ خروجِ M5-17Q — تُضمِّنُ `*.e2e.test.ts` عن قصدٍ كأخواتِها من حزمِ `*-e2e`.
 *
 * بغيابِ `DATABASE_URL` يتخطّى الملفُّ نفسَه (`describe.skipIf`) فيبقى `pnpm -r test`
 * أخضرَ بلا قاعدة — ولذلك وجودُ ساقِ `billing` في مصفوفةِ `exit-gate-e2e`
 * (`.github/workflows/ci.yml`) هوَ ما يجعلُها بوّابة.
 *
 * `fileParallelism: false` لأنَّ الملفَّ يُسقِطُ مخطَّطَ خدمتَينِ (التوصيلِ والفوترةِ)
 * على قاعدةٍ واحدةٍ ويُعيدُ بناءَهُ.
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

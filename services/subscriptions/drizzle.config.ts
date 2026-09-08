/**
 * drizzle-kit config for the Subscriptions & Referrals service (M0-23 · ADR-024).
 *
 * العقدُ القانونيُّ هو `contracts/schema.sql` (ADR-015)، وهذا الإعدادُ يُتيحُ
 * لـ`drizzle-kit generate/push/studio` أن يعملَ من المرآةِ الآمنةِ للأنواعِ متى احتيجَ
 * إلى ترحيلٍ أو فحصٍ. وتوليدُ ترحيلٍ **لا يُستبدِلُ** تحديثَ العقدِ: العقدُ هو ما يقرؤهُ
 * المراجعون، والمرآةُ تسقطُه إلى TypeScript لتكميلَ الاستعلاماتِ الترجمةَ، ويُولِّدُ منهُ
 * `drizzle-kit generate` الترحيلاتِ العكوسةَ المطلوبةَ في عقدِ البيانات.
 *
 * Scripts: pnpm --filter @wasla/subscriptions-service db:generate | db:push | db:studio
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://wasla:wasla@localhost:5432/wasla_subscriptions",
  },
  strict: true,
  verbose: true,
});

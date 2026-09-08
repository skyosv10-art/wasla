/**
 * drizzle-kit config for the Marketplace service.
 *
 * العقدُ الكنونيُّ هو `contracts/schema.sql` (ADR-014): هذا الإعدادُ لا يُنشئُ المخطّطَ،
 * بل يُتيحُ `drizzle-kit generate/push/studio` على الإسقاطِ الآمنِ أنواعِيّاً (المرآة)
 * عندَ الحاجةِ إلى ترحيلٍ أو فحصٍ — ومصالحةُ ADR-024 جعلتِ المرآةَ تعلنُ كلَّ ما في
 * العقدِ (القيودَ المضمَّنةَ بأسمائِها الكنونيّةِ والفهارسَ الجزئيّةَ والتعبيريّةَ)،
 * فيولّدُ المولّدُ ترحيلاً متكافئاً مع العقدِ في سبعةِ أبعادِ كتالوج. وتوليدُ ترحيلٍ
 * لا يُغني عن تحديثِ العقدِ أبداً: العقدُ هو ما يقرؤه المُراجعون.
 *
 * التشغيل: pnpm --filter @wasla/marketplace-service db:generate | db:push | db:studio
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://wasla:wasla@localhost:5432/wasla_marketplace",
  },
  strict: true,
  verbose: true,
});

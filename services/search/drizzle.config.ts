/**
 * drizzle-kit config for the Search service.
 *
 * العقدُ الكنونيُّ هو `contracts/schema.sql` (ADR-014): هذا الإعدادُ لا يُنشئُ المخطّطَ،
 * بل يُتيحُ `drizzle-kit generate/push/studio` على الإسقاطِ الآمنِ أنواعِيّاً (المرآةِ في
 * `src/db/schema.ts`) — والمرآةُ تُعلنُ ما تستطيعُ: الجداولَ والأعمدةَ والقيودَ بأسمائِها
 * والفهارسَ البُنيويّةَ الجزئيّةَ. وما لا تستطيعُهُ (امتدادُ `pg_trgm` · فهرسا `gin` ·
 * دالّتا plpgsql · أربعةُ مُطلِقاتٍ) يُلحَقُ بيدٍ **مُعلَمةٍ** في ذيلِ الترحيلِ المولَّدِ،
 * ويُقاسُ التكافؤُ في سبعةِ أبعادِ كتالوجٍ في `migrations.integration.test.ts`.
 *
 * وتوليدُ ترحيلٍ لا يُغني عن تحديثِ العقدِ أبداً: العقدُ هو ما يقرؤهُ المُراجعون.
 *
 * التشغيل: pnpm --filter @wasla/search-service db:generate | db:push | db:studio
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://wasla:wasla@localhost:5432/wasla_search",
  },
  strict: true,
  verbose: true,
});

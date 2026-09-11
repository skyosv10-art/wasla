/**
 * drizzle-kit config for the Delivery service.
 *
 * العقدُ الكنونيُّ هو `contracts/schema.sql` (ADR-014): هذا الإعدادُ لا يُنشئُ المخطّطَ،
 * بل يُتيحُ `drizzle-kit generate/push/studio` على الإسقاطِ الآمنِ أنواعِيّاً (المرآةِ في
 * `src/db/schema.ts`) — والمرآةُ تُعلنُ كلَّ ما في العقدِ: القيودَ المضمَّنةَ بأسمائِها
 * المقيسةِ من الكتالوجِ، والفهارسَ الجزئيّةَ، والمتتالَ المستقلَّ. فيولّدُ المولّدُ ترحيلاً
 * متكافئاً مع العقدِ في سبعةِ أبعادِ كتالوجٍ (يُقاسُ في `migrations.integration.test.ts`).
 *
 * وتوليدُ ترحيلٍ لا يُغني عن تحديثِ العقدِ أبداً: العقدُ هو ما يقرؤهُ المُراجعون.
 *
 * التشغيل: pnpm --filter @wasla/delivery-service db:generate | db:push | db:studio
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://wasla:wasla@localhost:5432/wasla_delivery",
  },
  strict: true,
  verbose: true,
});

/**
 * Integration vitest config — runs only the Postgres integration tests. Requires
 * a live database (DATABASE_URL). Skipped entirely when DATABASE_URL is unset.
 *
 * `fileParallelism: false` مطلبٌ لا تفضيل (M0-03 — عزلُ DDL):
 * كِلا الملفَّين الذَين يُطابقان `include` أدناه — `postgres-repository.integration`
 * و`exit-gate.e2e` — يملكُ **مخطّطَ القاعدةِ نفسِها** في `beforeAll`
 * (`DROP TABLE ... CASCADE` ثمّ إعادةُ تشغيلِ `contracts/schema.sql`). فإن جرى
 * الملفّان في عاملَين متوازيَين، أسقطَ أحدُهما جداولَ الآخرِ وهو يعمل.
 *
 * وهذا مقيسٌ لا مُفترَض: على قاعدةِ Postgres حقيقيّةٍ وبأربعةِ عوامل
 * (`--poolOptions.forks.maxForks=4`) فشلت الحزمةُ **10 من 10** تشغيلات بـ
 * `duplicate key value` و`Cannot read properties of undefined`؛ وبهذا السطرِ
 * نجحت **10 من 10** بلا تغييرٍ آخر. ولا يُخفى أنّ المسألةَ كانت مستورةً على
 * آلةٍ بنواتَين فقط، إذ يجعل vitest حدَّ العوامل `availableParallelism - 1 = 1`
 * فيتسلسلُ الملفّان عرَضاً؛ فالخطرُ يظهر على أيِّ عاملٍ أوسع.
 *
 * والبديلُ المطروحُ في اللوحةِ (schema-per-worker) مرفوضٌ هنا بقصد: يقتضي
 * حقنَ `search_path` في كلِّ مُهيِّئٍ ويُبعِد الاختبارَ عن شكلِ الإنتاج، وكلُّ
 * الخدماتِ العشرِ الأخرى تعزل بالتسلسل — فالتسلسلُ هو السابقةُ والأرخص.
 *
 * Run with:
 *   DATABASE_URL=postgres://... pnpm --filter @wasla/identity-service test:integration
 *
 * CI job: `db-integration` (انظر `.gitlab-ci.yml`).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/*.{integration,e2e}.test.ts"],
    fileParallelism: false,
  },
});

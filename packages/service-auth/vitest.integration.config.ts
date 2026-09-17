/**
 * إعدادُ التكاملِ لحزمةِ `@wasla/service-auth` — يحتاجُ PostgreSQL حقيقيّاً.
 *
 * `fileParallelism: false` بالقصدِ نفسِهِ الذي في الخدماتِ: ملفُّ التكاملِ هنا
 * يُنشئُ جدولَ الآثارِ ويُفرِغُهُ في `beforeAll`، فأيُّ ملفٍّ تكامليٍّ ثانٍ يُضافُ
 * غداً كانَ سيُسقِطُ صفوفَ الأوّلِ وهوَ يعملُ. والتسلسلُ سابقةُ المستودعِ.
 *
 *   DATABASE_URL=postgres://... pnpm --filter @wasla/service-auth test:integration
 *
 * وظيفةُ CI: `db-integration` · ساقُ `service-auth`.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/*.integration.test.ts"],
    fileParallelism: false,
  },
});

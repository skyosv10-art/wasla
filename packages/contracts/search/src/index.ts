/**
 * @wasla/contracts-search
 *
 * تبرير الحزمة (§7): تضع عقودَ خدمةِ البحثِ في السوقِ في سطحِ TypeScript
 * واحدٍ كي لا ينسخُ المستهلكون أشكالَ النتائجِ ولا حدودَ الترتيبِ.
 * مستهلكوها المعلومون اليوم: بوتُ العميلِ (بحثُ المنتجات)، لوحةُ الإدارةِ،
 * وطورُ الشراءِ (Phase 13) الذي يقرأُ نتائجَ البحثِ لا فهرسَه.
 *
 * Contract First artifacts (ADR-004), NOT a runtime implementation.
 * The search index is a DERIVED READ MODEL (ADR-025), not a source of truth.
 * Visibility is rebuilt from consumed marketplace state (ADR-016 decision 3):
 * store approved · product published · moderation approved · quantity > 0.
 *
 * Regenerate API types: pnpm --filter @wasla/contracts-search generate
 */

export * from "./api-types.js";
export * from "./events-types.js";

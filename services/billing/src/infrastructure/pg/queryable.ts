/**
 * واجهةُ الاستعلامِ الدنيا التي يرضاها `pg.Pool` و`pg.PoolClient` معاً — فالمحوِّلُ نفسُهُ
 * يعملُ على المسبحِ خارجَ المعاملةِ وعلى عميلِ المعاملةِ داخلَها (M5-17P · CLM-0375).
 */

export interface Queryable {
  query<R extends object = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** معرِّفٌ غيرُ UUID لا يُرسَلُ إلى عمودِ `uuid` — كانَ سيُعيدُ 22P02 فيصيرُ 500 بدلَ «غيرِ موجود». */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Postgres-backed Wasla Public ID sequence.
 *
 * Backs the PublicIdSequence port with a Postgres sequence
 * (wasla_public_id_seq). nextval() is atomic and monotonic across concurrent
 * transactions, so generated Public IDs (WS- + 10 zero-padded digits) are
 * unique. The DB unique constraint on identity_users.wasla_public_id is the
 * final safety net.
 */

import { sql } from "drizzle-orm";

import { IdentityError } from "../../domain/errors.js";
import { formatWaslaPublicId } from "../../domain/public-id.js";
import type { PublicIdSequence } from "../../ports.js";
import type { Db } from "./db.js";

export class PostgresPublicIdSequence implements PublicIdSequence {
  constructor(private readonly db: Db) {}

  async next(): Promise<number> {
    const result = await this.db.execute(
      sql`SELECT nextval('wasla_public_id_seq') AS v`,
    );
    const row = (result.rows ?? []) as Array<{ v: string }>;
    const value = row[0]?.v;
    if (value === undefined) {
      throw new IdentityError(
        "IDENTITY_INTERNAL_ERROR",
        "wasla_public_id_seq returned no value",
      );
    }
    return Number(value);
  }

  /** Convenience: return the next formatted Wasla Public ID. */
  async nextFormatted(): Promise<string> {
    return formatWaslaPublicId(await this.next());
  }
}

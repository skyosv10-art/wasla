/**
 * Drizzle database connection for the Audit service.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import * as schema from "./schema.js";

export function createAuditDb(pool: Pool) {
  return drizzle(pool, { schema });
}

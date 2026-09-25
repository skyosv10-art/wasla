/**
 * PostgreSQL adapter for partner API credentials (CredentialStore).
 *
 * Implements CredentialStore using the `partner_api_credentials` table.
 *
 * Key design decisions (ADR-048):
 * - Credentials are hashed (SHA-256) and stored as `key_hash`.
 * - `key_prefix` is stored in plaintext for identification.
 * - Scopes are stored as TEXT[] array.
 * - Revocation sets `state = 'revoked'` and `revoked_at = now()`.
 * - List queries filter by tenant for isolation.
 */

import type { Pool, PoolClient } from "pg";
import type { ApiCredential, CredentialCreateInput } from "../domain/lifecycle.js";
import type { CredentialStore } from "../ports.js";

const INSERT_CREDENTIAL = `
  INSERT INTO partner_api_credentials
    (credential_id, tenant_store_id, issued_by_public_id, key_prefix, key_hash, scopes, state)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING credential_id::text, tenant_store_id::text, issued_by_public_id, key_prefix,
    scopes, state, created_at::timestamptz::text, revoked_at::timestamptz::text
`;

const LIST_CREDENTIALS = `
  SELECT credential_id::text, tenant_store_id::text, issued_by_public_id, key_prefix,
    scopes, state, created_at::timestamptz::text, revoked_at::timestamptz::text
  FROM partner_api_credentials
  WHERE tenant_store_id = $1
  ORDER BY created_at DESC
`;

const REVOKE_CREDENTIAL = `
  UPDATE partner_api_credentials
  SET state = 'revoked', revoked_at = $2
  WHERE credential_id = $1 AND state = 'active'
  RETURNING credential_id::text, tenant_store_id::text, issued_by_public_id, key_prefix,
    scopes, state, created_at::timestamptz::text, revoked_at::timestamptz::text
`;

const FIND_BY_HASH = `
  SELECT credential_id::text, tenant_store_id::text, issued_by_public_id, key_prefix,
    scopes, state, created_at::timestamptz::text, revoked_at::timestamptz::text
  FROM partner_api_credentials
  WHERE key_hash = $1 AND state = 'active'
`;

interface CredentialRow {
  credential_id: string;
  tenant_store_id: string;
  issued_by_public_id: string;
  key_prefix: string;
  scopes: string[];
  state: "active" | "revoked";
  created_at: string;
  revoked_at: string | null;
}

function rowToCredential(row: CredentialRow): ApiCredential {
  return {
    credentialId: row.credential_id,
    tenantStoreId: row.tenant_store_id,
    issuedByPublicId: row.issued_by_public_id,
    keyPrefix: row.key_prefix,
    scopes: row.scopes,
    state: row.state,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

export class PgCredentialStore implements CredentialStore {
  constructor(private pool: Pool | PoolClient) {}

  async create(input: CredentialCreateInput): Promise<ApiCredential> {
    const result = await this.pool.query(INSERT_CREDENTIAL, [
      input.credentialId,
      input.tenantStoreId,
      input.issuedByPublicId,
      input.keyPrefix,
      input.keyHash,
      input.scopes,
      input.state,
    ]);
    return rowToCredential(result.rows[0]);
  }

  async listByTenant(storeId: string): Promise<ApiCredential[]> {
    const result = await this.pool.query(LIST_CREDENTIALS, [storeId]);
    return result.rows.map(rowToCredential);
  }

  async revoke(credentialId: string, revokedAt: string): Promise<ApiCredential | null> {
    const result = await this.pool.query(REVOKE_CREDENTIAL, [credentialId, revokedAt]);
    if (result.rows.length === 0) return null;
    return rowToCredential(result.rows[0]);
  }

  async findByHash(keyHash: string): Promise<ApiCredential | null> {
    const result = await this.pool.query(FIND_BY_HASH, [keyHash]);
    if (result.rows.length === 0) return null;
    return rowToCredential(result.rows[0]);
  }
}

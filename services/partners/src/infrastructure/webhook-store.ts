/**
 * PostgreSQL adapter for partner webhooks (WebhookStore).
 *
 * Implements WebhookStore using the `partner_webhooks` table.
 *
 * Key design decisions (ADR-048):
 * - Webhooks are event-driven, not polled.
 * - Soft delete: `state = 'deleted'` + `deleted_at` timestamp.
 * - Pause: `state = 'paused'` without deletion.
 * - `secret_hash` stores the HMAC signing key hash, not the key itself.
 */

import type { Pool, PoolClient } from "pg";
import type { PartnerWebhook } from "../domain/lifecycle.js";
import type { WebhookStore } from "../ports.js";

const INSERT_WEBHOOK = `
  INSERT INTO partner_webhooks
    (webhook_id, tenant_store_id, url, secret_hash, event_types, state)
  VALUES ($1, $2, $3, $4, $5, $6)
  RETURNING webhook_id::text, tenant_store_id::text, url, secret_hash, event_types, state,
    created_at::timestamptz::text, updated_at::timestamptz::text
`;

const LIST_WEBHOOKS = `
  SELECT webhook_id::text, tenant_store_id::text, url, secret_hash, event_types, state,
    created_at::timestamptz::text, updated_at::timestamptz::text
  FROM partner_webhooks
  WHERE tenant_store_id = $1 AND state != 'deleted'
  ORDER BY created_at DESC
`;

const DELETE_WEBHOOK = `
  UPDATE partner_webhooks
  SET state = 'deleted', deleted_at = $2, updated_at = $2
  WHERE webhook_id = $1 AND state != 'deleted'
  RETURNING webhook_id::text, tenant_store_id::text, url, secret_hash, event_types, state,
    created_at::timestamptz::text, updated_at::timestamptz::text
`;

const PAUSE_WEBHOOK = `
  UPDATE partner_webhooks
  SET state = 'paused', updated_at = $2
  WHERE webhook_id = $1 AND state = 'active'
  RETURNING webhook_id::text, tenant_store_id::text, url, secret_hash, event_types, state,
    created_at::timestamptz::text, updated_at::timestamptz::text
`;

interface WebhookRow {
  webhook_id: string;
  tenant_store_id: string;
  url: string;
  secret_hash: string;
  event_types: string[];
  state: "active" | "paused" | "deleted";
  created_at: string;
  updated_at: string;
}

function rowToWebhook(row: WebhookRow): PartnerWebhook {
  return {
    webhookId: row.webhook_id,
    tenantStoreId: row.tenant_store_id,
    url: row.url,
    secretHash: row.secret_hash,
    eventTypes: row.event_types,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgWebhookStore implements WebhookStore {
  constructor(private pool: Pool | PoolClient) {}

  async create(webhook: Omit<PartnerWebhook, "createdAt" | "updatedAt">): Promise<PartnerWebhook> {
    const result = await this.pool.query(INSERT_WEBHOOK, [
      webhook.webhookId,
      webhook.tenantStoreId,
      webhook.url,
      webhook.secretHash,
      webhook.eventTypes,
      webhook.state,
    ]);
    return rowToWebhook(result.rows[0]);
  }

  async listByTenant(storeId: string): Promise<PartnerWebhook[]> {
    const result = await this.pool.query(LIST_WEBHOOKS, [storeId]);
    return result.rows.map(rowToWebhook);
  }

  async delete(webhookId: string, deletedAt: string): Promise<PartnerWebhook | null> {
    const result = await this.pool.query(DELETE_WEBHOOK, [webhookId, deletedAt]);
    if (result.rows.length === 0) return null;
    return rowToWebhook(result.rows[0]);
  }

  async pause(webhookId: string, updatedAt: string): Promise<PartnerWebhook | null> {
    const result = await this.pool.query(PAUSE_WEBHOOK, [webhookId, updatedAt]);
    if (result.rows.length === 0) return null;
    return rowToWebhook(result.rows[0]);
  }
}

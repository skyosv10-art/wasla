-- WASLA Billing & Fees — Baseline migration (Phase 17, ADR-050, review 3/N)
-- Generated from services/billing/src/infrastructure/drizzle/schema.ts

CREATE TABLE IF NOT EXISTS "billing_invoices" (
	"invoice_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_public_id" text NOT NULL,
	"period" text NOT NULL,
	"state" text NOT NULL DEFAULT 'draft',
	"fee_type" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"paid_amount_cents" bigint NOT NULL DEFAULT 0,
	"payment_ref" text,
	"settlement_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"issued_at" timestamp,
	"paid_at" timestamp,
	"closed_at" timestamp,
	"voided_at" timestamp,
	CONSTRAINT "billing_amount_cents_positive" CHECK (amount_cents > 0),
	CONSTRAINT "billing_paid_amount_non_negative" CHECK (paid_amount_cents >= 0),
	CONSTRAINT "billing_state_valid" CHECK (state IN ('draft', 'issued', 'paid', 'partially_paid', 'closed', 'void')),
	CONSTRAINT "billing_fee_type_valid" CHECK (fee_type IN ('store_fixed', 'store_variable', 'subscription', 'payout')),
	CONSTRAINT "billing_payment_gate" CHECK (state NOT IN ('issued', 'partially_paid') OR paid_amount_cents <= amount_cents),
	CONSTRAINT "billing_void_gate" CHECK (state != 'void' OR voided_at IS NOT NULL),
	CONSTRAINT "billing_close_gate" CHECK (state != 'closed' OR paid_at IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_settlements" (
	"settlement_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"fee_type" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"period" text NOT NULL,
	"state" text NOT NULL DEFAULT 'pending',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp,
	CONSTRAINT "billing_settlement_amount_positive" CHECK (amount_cents > 0),
	CONSTRAINT "billing_settlement_fee_type_valid" CHECK (fee_type IN ('store_fixed', 'store_variable', 'subscription', 'payout')),
	CONSTRAINT "billing_settlement_state_valid" CHECK (state IN ('pending', 'settled', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "billing_settlements" ADD CONSTRAINT "billing_settlements_invoice_id_billing_invoices_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."billing_invoices"("invoice_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_outbox" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"event_version" text NOT NULL DEFAULT 'v1',
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp,
	"publish_attempts" integer NOT NULL DEFAULT 0,
	CONSTRAINT "billing_outbox_event_type_valid" CHECK (event_type IN ('billing.invoice_issued', 'billing.fee_settled', 'billing.payout_requested'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_billing_invoices_store" ON "billing_invoices" ("store_public_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_billing_invoices_state" ON "billing_invoices" ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_billing_settlements_invoice" ON "billing_settlements" ("invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_billing_outbox_unpublished" ON "billing_outbox" ("published_at");

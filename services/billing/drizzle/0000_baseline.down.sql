-- WASLA Billing & Fees — Baseline migration rollback
DROP TABLE IF EXISTS "billing_outbox";
DROP TABLE IF EXISTS "billing_settlements";
DROP TABLE IF EXISTS "billing_invoices";

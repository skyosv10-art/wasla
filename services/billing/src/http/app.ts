/**
 * طبقةُ HTTP لخدمة الفوترة — المنفذ 8096 (Phase 17 · ADR-050).
 *
 * المعالجُ يستقبل `InvoiceStore` و`PaymentGatewayPort` و`BillingEventPublisher`
 * ولا شيءَ غيرهما. لا `Db` ولا بركةَ اتصال في نطاقه.
 */

import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import { BILLING_SERVICE_PORT } from "@wasla/contracts-billing";
import { registerServiceIdentityOnFastify } from "@wasla/service-auth/fastify";
import { BillingError } from "../domain/errors.js";
import {
  createInvoice,
  transitionInvoice,
  recordPayment,
  allowsVoid,
} from "../domain/model.js";
import type { Invoice } from "../domain/model.js";
import type {
  InvoiceStore,
  PaymentGatewayPort,
  BillingEventPublisher,
} from "../ports.js";
import { registerErrorHandler } from "./errors.js";
import {
  BILLING_SERVICE_AUDIENCE,
  BILLING_SCOPES,
  OPEN,
  internalScoped,
  denialBody,
  type BillingServiceIdentityOptions,
} from "./service-identity.js";

export interface BillingHttpDeps {
  readonly store: InvoiceStore;
  readonly paymentGateway?: PaymentGatewayPort;
  readonly publisher?: BillingEventPublisher;
  readonly serviceIdentity?: BillingServiceIdentityOptions;
}

function serializeInvoice(inv: Invoice) {
  return {
    id: inv.id,
    store_public_id: inv.store_public_id,
    period: inv.period,
    state: inv.state,
    fee_type: inv.fee_type,
    amount_cents: inv.amount_cents,
    paid_amount_cents: inv.paid_amount_cents,
    payment_ref: inv.payment_ref,
    created_at: inv.created_at.toISOString(),
    updated_at: inv.updated_at.toISOString(),
  };
}

export function createBillingApp(deps: BillingHttpDeps): FastifyInstance {
  const app = Fastify({
    logger: false,
    genReqId: () => randomUUID(),
  });

  if (deps.serviceIdentity) {
    registerServiceIdentityOnFastify(app as never, {
      audience: BILLING_SERVICE_AUDIENCE,
      boundaryLabel: "حد الفوترة",
      keys: deps.serviceIdentity.keys,
      replayGuard: deps.serviceIdentity.replayGuard,
      denialBody,
    });
  }

  registerErrorHandler(app);

  // GET /billing/health — open
  app.get("/billing/health", { config: OPEN }, async () => ({
    status: "ok",
    service: "billing",
    port: BILLING_SERVICE_PORT,
  }));

  // POST /billing/invoices — create invoice
  app.post(
    "/billing/invoices",
    { config: internalScoped(BILLING_SCOPES.invoiceWrite) },
    async (request, reply) => {
      const body = request.body as {
        store_public_id?: string;
        period?: string;
        fee_type?: string;
        amount_cents?: number;
      };

      if (!body?.store_public_id || !body?.period || !body?.fee_type || !body?.amount_cents) {
        throw BillingError.validationFailed(
          "store_public_id, period, fee_type, and amount_cents are required",
        );
      }

      if (typeof body.amount_cents !== "number" || body.amount_cents <= 0) {
        throw BillingError.validationFailed("amount_cents must be a positive number");
      }

      const now = new Date();
      const invoice = createInvoice({
        id: `INV-${randomUUID().slice(0, 12).toUpperCase()}`,
        store_public_id: body.store_public_id,
        period: body.period,
        fee_type: body.fee_type,
        amount_cents: body.amount_cents,
        now,
      });

      await deps.store.save(invoice);

      reply.status(201).send(serializeInvoice(invoice));
    },
  );

  // GET /billing/invoices/:id — get invoice
  app.get(
    "/billing/invoices/:id",
    { config: internalScoped(BILLING_SCOPES.invoiceRead) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const invoice = await deps.store.findById(id);

      if (!invoice) {
        throw BillingError.invoiceNotFound(id);
      }

      reply.send(serializeInvoice(invoice));
    },
  );

  // GET /billing/invoices — list invoices by store
  app.get(
    "/billing/invoices",
    { config: internalScoped(BILLING_SCOPES.invoiceRead) },
    async (request, reply) => {
      const query = request.query as {
        store_public_id?: string;
        limit?: string;
        cursor?: string;
      };

      if (!query.store_public_id) {
        throw BillingError.validationFailed("store_public_id query parameter is required");
      }

      const limit = query.limit ? parseInt(query.limit, 10) : 20;
      const result = await deps.store.findByStore(
        query.store_public_id,
        limit,
        query.cursor,
      );

      reply.send({
        items: result.items.map(serializeInvoice),
        next_cursor: result.nextCursor,
      });
    },
  );

  // POST /billing/invoices/:id/issue — transition draft → issued
  app.post(
    "/billing/invoices/:id/issue",
    { config: internalScoped(BILLING_SCOPES.invoiceWrite) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const invoice = await deps.store.findById(id);

      if (!invoice) {
        throw BillingError.invoiceNotFound(id);
      }

      try {
        const issued = transitionInvoice(invoice, "issued", new Date());
        await deps.store.save(issued);

        if (deps.publisher) {
          await deps.publisher.publishInvoiceIssued({
            invoice_id: issued.id,
            store_public_id: issued.store_public_id,
            period: issued.period,
          });
        }

        reply.send(serializeInvoice(issued));
      } catch (e) {
        if (e instanceof Error && e.message.includes("Invalid transition")) {
          throw BillingError.invalidStateTransition(invoice.state, "issued");
        }
        throw e;
      }
    },
  );

  // POST /billing/invoices/:id/payment — record payment
  app.post(
    "/billing/invoices/:id/payment",
    { config: internalScoped(BILLING_SCOPES.invoiceWrite) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        amount_cents?: number;
        payment_ref?: string;
      };

      if (!body?.amount_cents || !body?.payment_ref) {
        throw BillingError.validationFailed("amount_cents and payment_ref are required");
      }

      const invoice = await deps.store.findById(id);
      if (!invoice) {
        throw BillingError.invoiceNotFound(id);
      }

      try {
        const paid = recordPayment(
          invoice,
          body.amount_cents,
          body.payment_ref,
          new Date(),
        );
        await deps.store.save(paid);
        reply.send(serializeInvoice(paid));
      } catch (e) {
        if (e instanceof Error && e.message.includes("Payment not allowed")) {
          throw BillingError.invalidStateTransition(invoice.state, "paid");
        }
        throw e;
      }
    },
  );

  // POST /billing/invoices/:id/void — void invoice
  app.post(
    "/billing/invoices/:id/void",
    { config: internalScoped(BILLING_SCOPES.invoiceWrite) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const invoice = await deps.store.findById(id);

      if (!invoice) {
        throw BillingError.invoiceNotFound(id);
      }

      if (!allowsVoid(invoice.state)) {
        throw BillingError.invoiceAlreadyClosed(id);
      }

      const voided = transitionInvoice(invoice, "void", new Date());
      await deps.store.save(voided);
      reply.send(serializeInvoice(voided));
    },
  );

  return app;
}

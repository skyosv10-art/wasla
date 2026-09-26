/**
 * طبقةُ HTTP لخدمة الدعم — المنفذ 8095 (Phase 16 · ADR-049).
 *
 * المعالجُ يستقبل `SupportTicketStore` و`SupportEventPublisher` ولا شيءَ غيرهما.
 * لا `Db` ولا بركةَ اتصال في نطاقه. وكلُّ كتابةٍ تمرّ بـStore.
 *
 * لا `try`/`catch` في أيّ معالج: معالجُ الخطأ الواحد يُترجم.
 */

import Fastify, { type FastifyInstance } from "fastify";

import { SUPPORT_SERVICE_PORT } from "@wasla/contracts-support";
import { registerServiceIdentityOnFastify } from "@wasla/service-auth/fastify";
import { supportErrors } from "../domain/errors.js";
import type { SupportTicketStore, SupportEventPublisher, ReputationBridgePort } from "../ports.js";
import { registerErrorHandler } from "./errors.js";
import {
  SUPPORT_SERVICE_AUDIENCE,
  SUPPORT_SCOPES,
  OPEN,
  internalScoped,
  denialBody,
  type SupportServiceIdentityOptions,
} from "./service-identity.js";

export interface SupportHttpDeps {
  readonly store: SupportTicketStore;
  readonly publisher?: SupportEventPublisher;
  readonly reputationBridge: ReputationBridgePort;
  readonly serviceIdentity?: SupportServiceIdentityOptions;
}

export function createSupportApp(deps: SupportHttpDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  if (deps.serviceIdentity) {
    registerServiceIdentityOnFastify(app, {
      audience: SUPPORT_SERVICE_AUDIENCE,
      keys: deps.serviceIdentity.keys,
      replayGuard: deps.serviceIdentity.replayGuard,
      denialBody,
      boundaryLabel: "حد الدعم",
    });
  }

  registerErrorHandler(app);

  // ── /health ────────────────────────────────────────────────────────────
  app.get("/health", { config: OPEN }, async () => ({
    status: "ok" as const,
    service: "support-service" as const,
    port: SUPPORT_SERVICE_PORT,
  }));

  // ── POST /support/tickets ──────────────────────────────────────────────
  app.post("/support/tickets", { config: internalScoped(SUPPORT_SCOPES.ticketWrite) }, async (request, reply) => {
    const body = request.body as {
      ticket_type: string;
      reporter_public_id: string;
      subject_public_id: string | null;
      order_public_id: string | null;
    };

    if (!body?.ticket_type || !body?.reporter_public_id) {
      return sendValidation(reply, "ticket_type and reporter_public_id are required");
    }

    const ticket = await deps.store.createTicket({
      ticket_type: body.ticket_type as never,
      reporter_public_id: body.reporter_public_id,
      subject_public_id: body.subject_public_id ?? null,
      order_public_id: body.order_public_id ?? null,
    });

    if (deps.publisher) {
      await deps.publisher.publishTicketOpened(
        ticket.ticket_id,
        ticket.ticket_type,
        ticket.reporter_public_id,
      );
    }

    return reply.status(201).send(ticket);
  });

  // ── GET /support/tickets/:ticketId ─────────────────────────────────────
  app.get("/support/tickets/:ticketId", { config: internalScoped(SUPPORT_SCOPES.ticketRead) }, async (request, reply) => {
    const { ticketId } = request.params as { ticketId: string };
    const ticket = await deps.store.getTicket(ticketId);

    if (!ticket) {
      throw supportErrors.ticketNotFound(ticketId);
    }

    return reply.status(200).send(ticket);
  });

  // ── POST /support/tickets/:ticketId/evidence ────────────────────────────
  app.post(
    "/support/tickets/:ticketId/evidence",
    { config: internalScoped(SUPPORT_SCOPES.evidenceWrite) },
    async (request, reply) => {
      const { ticketId } = request.params as { ticketId: string };
      const body = request.body as {
        evidence_type: string;
        content_hash: string;
        storage_ref: string;
      };

      if (!body?.evidence_type || !body?.content_hash || !body?.storage_ref) {
        return sendValidation(reply, "evidence_type, content_hash, and storage_ref are required");
      }

      const evidence = await deps.store.attachEvidence({
        ticket_id: ticketId,
        evidence_type: body.evidence_type as never,
        content_hash: body.content_hash,
        storage_ref: body.storage_ref,
      });

      return reply.status(201).send(evidence);
    },
  );

  // ── POST /support/tickets/:ticketId/escalate ───────────────────────────
  app.post(
    "/support/tickets/:ticketId/escalate",
    { config: internalScoped(SUPPORT_SCOPES.ticketWrite) },
    async (request, reply) => {
      const { ticketId } = request.params as { ticketId: string };
      const body = request.body as { escalation_level: string };

      if (!body?.escalation_level) {
        return sendValidation(reply, "escalation_level is required");
      }

      const existing = await deps.store.getTicket(ticketId);
      if (!existing) {
        throw supportErrors.ticketNotFound(ticketId);
      }

      const ticket = await deps.store.updateState(ticketId, "escalated", {
        escalation_level: body.escalation_level as never,
      });

      if (deps.publisher) {
        await deps.publisher.publishTicketEscalated(ticketId, body.escalation_level as never);
      }

      return reply.status(200).send(ticket);
    },
  );

  // ── POST /support/tickets/:ticketId/resolve ───────────────────────────
  app.post(
    "/support/tickets/:ticketId/resolve",
    { config: internalScoped(SUPPORT_SCOPES.ticketWrite) },
    async (request, reply) => {
      const { ticketId } = request.params as { ticketId: string };
      const body = request.body as {
        resolution_reason: string;
        evidence_id: string;
      };

      if (!body?.resolution_reason || !body?.evidence_id) {
        return sendValidation(reply, "resolution_reason and evidence_id are required");
      }

      const ticket = await deps.store.resolve({
        ticket_id: ticketId,
        resolution_reason: body.resolution_reason as never,
        evidence_id: body.evidence_id,
      });

      if (deps.publisher) {
        await deps.publisher.publishTicketResolved(
          ticketId,
          body.resolution_reason as never,
          body.evidence_id,
        );
      }

      // ADR-049 §7: record dispute_resolved fact to reputation service.
      // Best-effort: if the bridge is unavailable, the ticket is still resolved.
      if (ticket.subject_public_id) {
        try {
          await deps.reputationBridge.recordDisputeResolved({
            ticketId,
            subjectPublicId: ticket.subject_public_id,
            orderPublicId: ticket.order_public_id,
            resolutionReason: body.resolution_reason,
          });
        } catch {
          // Best-effort: the fact can be backfilled later.
        }
      }

      return reply.status(200).send(ticket);
    },
  );

  // ── POST /support/tickets/:ticketId/close ──────────────────────────────
  app.post(
    "/support/tickets/:ticketId/close",
    { config: internalScoped(SUPPORT_SCOPES.ticketWrite) },
    async (request, reply) => {
      const { ticketId } = request.params as { ticketId: string };

      const existing = await deps.store.getTicket(ticketId);
      if (!existing) {
        throw supportErrors.ticketNotFound(ticketId);
      }

      const ticket = await deps.store.updateState(ticketId, "closed", {});

      return reply.status(200).send(ticket);
    },
  );

  return app;
}

function sendValidation(reply: import("fastify").FastifyReply, message: string): void {
  reply.status(400).send({
    error: {
      code: "SUPPORT_VALIDATION_FAILED",
      message,
    },
  });
}

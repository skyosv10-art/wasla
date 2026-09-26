/**
 * إعدادُ تشغيلِ خادمِ الفوترة (Phase 17 · ADR-050).
 */

import type { FastifyInstance } from "fastify";
import { BILLING_SERVICE_PORT } from "@wasla/contracts-billing";

export async function startBillingServer(
  app: FastifyInstance,
  port: number = BILLING_SERVICE_PORT,
): Promise<void> {
  await app.listen({ port, host: "0.0.0.0" });
}

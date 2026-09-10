/**
 * HTTP adapter for `InventoryReservationPort` — المراجعةُ 10/N، ADR-026 §2.3.
 *
 * الحجزُ طلبٌ إلى السوقِ عبرَ الحدِّ المتَّفقِ عليهِ. السوقُ يخصمُ من
 * `quantity_on_hand` بحدثِ `marketplace.inventory_adjusted`، ويرجعُ مرجعَ الحجزِ.
 * التوصيلُ يخزّنُ المرجعَ لا الرصيدَ.
 *
 * مفتاحُ التماثُلِ مشتقٌّ حتميّاً من `orderPublicId`: إعادةُ المحاولةِ تُكمِلُ
 * الحجزَ نفسَهُ لا تنشئُ نسخةً. وهذا هو ما يمنعُ الحجزَ المزدوجَ تحتَ التزامنِ.
 *
 * مساراتُ السوقِ (المراجعةُ 10/N):
 *   POST /stores/{storeSlug}/inventory/reserve   → 201 { reservation_ref, items }
 *   POST /stores/{storeSlug}/inventory/release   → 200 { released: true }
 *
 * والفصلُ بينَ «لا مخزونَ» و«لا نعلمُ» هو نفسُ فصلِ الكتالوجِ: 409 جوابٌ
 * (المخزونُ لا يكفي)، وأيُّ شيءٍ آخرَ 503 (الحدُّ منقطعٌ).
 */

import type { ServiceRequestSigner } from "@wasla/service-auth";

import { DeliveryError } from "../domain/errors.js";
import {
  releaseIdempotencyKey,
  reservationIdempotencyKey,
} from "../domain/inventory-reservation.js";
import type {
  InventoryReservationPort,
  ReleaseRequest,
  ReservationRequest,
  ReservationResult,
} from "../ports.js";

export interface HttpMarketplaceReservationOptions {
  readonly baseUrl: string;
  readonly signRequest: ServiceRequestSigner;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/** الصلاحيّاتُ التي يحتاجُها هذا العميلُ على حدِّ السوقِ لاحجزِ المخزونِ. */
export const DELIVERY_MARKETPLACE_RESERVATION_SCOPES: readonly string[] = [
  "marketplace:inventory:reserve",
  "marketplace:inventory:release",
];

const reservePath = (slug: string): string =>
  `/stores/${encodeURIComponent(slug)}/inventory/reserve`;
const releasePath = (slug: string): string =>
  `/stores/${encodeURIComponent(slug)}/inventory/release`;

function unavailable(reason: string): DeliveryError {
  return new DeliveryError(
    "DELIVERY_MARKETPLACE_UNAVAILABLE",
    "حدُّ السوقِ لا يُجيبُ الآنَ — تعذّرَ حجزُ المخزونِ",
    { details: { field: "marketplace_reservation", actual: reason } },
  );
}

export class HttpMarketplaceReservationPort implements InventoryReservationPort {
  private readonly baseUrl: string;
  private readonly signRequest: ServiceRequestSigner;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpMarketplaceReservationOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.signRequest = options.signRequest;
    this.timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 3000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async reserve(req: ReservationRequest): Promise<ReservationResult> {
    const idempotencyKey = reservationIdempotencyKey(req.orderPublicId);
    const path = reservePath(req.storeSlug);
    const body = JSON.stringify({
      order_public_id: req.orderPublicId,
      items: req.items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
      idempotency_key: idempotencyKey,
    });

    const headers = this.signRequest("POST", path);
    const res = await this.doFetch(
      `${this.baseUrl}${path}`,
      { method: "POST", headers: { ...headers, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body },
    );

    if (res.status === 201) {
      const json = (await res.json()) as { reservation_ref?: string };
      return {
        reserved: true,
        reservationRef: json.reservation_ref ?? idempotencyKey,
      };
    }

    if (res.status === 409) {
      const json = (await res.json().catch(() => ({}))) as {
        code?: string;
        details?: { product_id?: string; available_quantity?: number };
      };
      return {
        reserved: false,
        reservationRef: idempotencyKey,
        insufficientProductId: json.details?.product_id,
        availableQuantity: json.details?.available_quantity,
      };
    }

    throw unavailable(`marketplace_error_status:${res.status}`);
  }

  async release(req: ReleaseRequest): Promise<{ released: boolean }> {
    const idempotencyKey = releaseIdempotencyKey(req.orderPublicId);
    const path = releasePath(req.storeSlug);
    const body = JSON.stringify({
      order_public_id: req.orderPublicId,
      reservation_ref: req.reservationRef,
      items: req.items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
      idempotency_key: idempotencyKey,
    });

    const headers = this.signRequest("POST", path);
    const res = await this.doFetch(
      `${this.baseUrl}${path}`,
      { method: "POST", headers: { ...headers, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body },
    );

    if (res.status === 200 || res.status === 201) {
      return { released: true };
    }

    // Idempotent: a second release is a no-op
    if (res.status === 409 || res.status === 404) {
      return { released: true };
    }

    throw unavailable(`marketplace_error_status:${res.status}`);
  }

  private async doFetch(
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        throw unavailable("marketplace_timeout");
      }
      throw unavailable("marketplace_unreachable");
    } finally {
      clearTimeout(timer);
    }
  }
}

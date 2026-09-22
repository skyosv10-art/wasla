import { create } from "zustand";

// Types matching the Customer HTTP API contract (OrderRequestInput schema)
export type OrderType = "ride" | "delivery";
export type VehicleClass = "sedan" | "suv" | "van" | "pickup" | "motorcycle" | "truck_small";
export type PriceMode = "customer_offer" | "negotiable";
export type StopKind = "pickup" | "dropoff";
export type StopSource = "map" | "telegram_location" | "link" | "text_search" | "saved_place" | "manual_zone";

export interface StopInput {
  kind: StopKind;
  zone_id: string;
  source: StopSource;
  label?: string | null;
  coordinates?: { lat: number; lng: number } | null;
}

export interface OrderRequestInput {
  order_type: OrderType;
  vehicle_class: VehicleClass;
  price_mode: PriceMode;
  offered_price?: { amount: number; currency: string } | null;
  stops: [StopInput, StopInput];
  shipment?: {
    shipment_type?: "parcel" | "documents" | "food" | "goods" | "other" | null;
    description?: string | null;
    weight_kg?: number | null;
  } | null;
  notes?: string | null;
}

export interface OrderRequestPreview {
  valid: boolean;
  order_type: OrderType;
  vehicle_class: VehicleClass;
  price_mode: PriceMode;
  offered_price?: { amount: number; currency: string } | null;
  stops: Array<{
    kind: StopKind;
    zone_id: string;
    label?: string | null;
    zone_path?: string[] | null;
  }>;
  shipment?: Record<string, unknown> | null;
  notes?: string | null;
}

export interface OrderRequestResult {
  order_request_id: string;
  status: "submitted" | "submission_failed";
  order_public_id?: string | null;
}

type PreviewStatus = "idle" | "loading" | "success" | "error";
type SubmitStatus = "idle" | "loading" | "success" | "error";

interface OrderFormState {
  // Form fields
  pickupZoneId: string;
  pickupLabel: string;
  dropoffZoneId: string;
  dropoffLabel: string;
  vehicleClass: VehicleClass;
  priceMode: PriceMode;
  offeredPrice: string;
  notes: string;

  // Preview
  preview: OrderRequestPreview | null;
  previewStatus: PreviewStatus;
  previewError: string | null;

  // Submit
  submitResult: OrderRequestResult | null;
  submitStatus: SubmitStatus;
  submitError: string | null;

  // Actions
  setPickupZoneId: (v: string) => void;
  setPickupLabel: (v: string) => void;
  setDropoffZoneId: (v: string) => void;
  setDropoffLabel: (v: string) => void;
  setVehicleClass: (v: VehicleClass) => void;
  setPriceMode: (v: PriceMode) => void;
  setOfferedPrice: (v: string) => void;
  setNotes: (v: string) => void;

  setPreview: (p: OrderRequestPreview | null) => void;
  setPreviewStatus: (s: PreviewStatus) => void;
  setPreviewError: (e: string | null) => void;

  setSubmitResult: (r: OrderRequestResult | null) => void;
  setSubmitStatus: (s: SubmitStatus) => void;
  setSubmitError: (e: string | null) => void;

  resetForm: () => void;
}

const initialState = {
  pickupZoneId: "",
  pickupLabel: "",
  dropoffZoneId: "",
  dropoffLabel: "",
  vehicleClass: "sedan" as VehicleClass,
  priceMode: "negotiable" as PriceMode,
  offeredPrice: "",
  notes: "",
  preview: null as OrderRequestPreview | null,
  previewStatus: "idle" as PreviewStatus,
  previewError: null as string | null,
  submitResult: null as OrderRequestResult | null,
  submitStatus: "idle" as SubmitStatus,
  submitError: null as string | null,
};

export const useOrderFormStore = create<OrderFormState>((set) => ({
  ...initialState,
  setPickupZoneId: (v) => set({ pickupZoneId: v, preview: null, previewStatus: "idle" }),
  setPickupLabel: (v) => set({ pickupLabel: v, preview: null, previewStatus: "idle" }),
  setDropoffZoneId: (v) => set({ dropoffZoneId: v, preview: null, previewStatus: "idle" }),
  setDropoffLabel: (v) => set({ dropoffLabel: v, preview: null, previewStatus: "idle" }),
  setVehicleClass: (v) => set({ vehicleClass: v, preview: null, previewStatus: "idle" }),
  setPriceMode: (v) => set({ priceMode: v, preview: null, previewStatus: "idle" }),
  setOfferedPrice: (v) => set({ offeredPrice: v, preview: null, previewStatus: "idle" }),
  setNotes: (v) => set({ notes: v, preview: null, previewStatus: "idle" }),
  setPreview: (p) => set({ preview: p }),
  setPreviewStatus: (s) => set({ previewStatus: s }),
  setPreviewError: (e) => set({ previewError: e }),
  setSubmitResult: (r) => set({ submitResult: r }),
  setSubmitStatus: (s) => set({ submitStatus: s }),
  setSubmitError: (e) => set({ submitError: e }),
  resetForm: () => set({ ...initialState }),
}));

// Build the API request body from form state
export function buildOrderRequest(state: OrderFormState): OrderRequestInput {
  const offeredPrice = state.priceMode === "customer_offer" && state.offeredPrice
    ? { amount: parseFloat(state.offeredPrice), currency: "SAR" }
    : null;

  const stops: [StopInput, StopInput] = [
    {
      kind: "pickup",
      zone_id: state.pickupZoneId,
      source: "manual_zone",
      label: state.pickupLabel || null,
      coordinates: null,
    },
    {
      kind: "dropoff",
      zone_id: state.dropoffZoneId,
      source: "manual_zone",
      label: state.dropoffLabel || null,
      coordinates: null,
    },
  ];

  return {
    order_type: "ride",
    vehicle_class: state.vehicleClass,
    price_mode: state.priceMode,
    offered_price: offeredPrice,
    stops,
    notes: state.notes || null,
  };
}

// Validate form — returns error message or null
export function validateOrderForm(state: OrderFormState): string | null {
  if (!state.pickupZoneId.trim()) return "pickup_zone_required";
  if (!state.dropoffZoneId.trim()) return "dropoff_zone_required";
  if (state.pickupZoneId === state.dropoffZoneId) return "same_zone";
  if (state.priceMode === "customer_offer") {
    const price = parseFloat(state.offeredPrice);
    if (!state.offeredPrice || isNaN(price) || price <= 0) return "invalid_price";
  }
  if (state.notes.length > 500) return "notes_too_long";
  return null;
}

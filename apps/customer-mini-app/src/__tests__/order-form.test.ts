import { describe, it, expect, beforeEach } from "vitest";
import { useOrderFormStore, buildOrderRequest, validateOrderForm } from "../store/order-form";

describe("order-form store", () => {
  beforeEach(() => {
    useOrderFormStore.getState().resetForm();
  });

  it("initializes with default values", () => {
    const state = useOrderFormStore.getState();
    expect(state.vehicleClass).toBe("sedan");
    expect(state.priceMode).toBe("negotiable");
    expect(state.pickupZoneId).toBe("");
    expect(state.dropoffZoneId).toBe("");
    expect(state.previewStatus).toBe("idle");
    expect(state.submitStatus).toBe("idle");
  });

  it("updates pickup zone and clears preview", () => {
    useOrderFormStore.getState().setPickupZoneId("zone-123");
    useOrderFormStore.getState().setPreviewStatus("success");
    useOrderFormStore.getState().setPickupZoneId("zone-456");
    expect(useOrderFormStore.getState().pickupZoneId).toBe("zone-456");
    expect(useOrderFormStore.getState().previewStatus).toBe("idle");
  });

  it("updates vehicle class and clears preview", () => {
    useOrderFormStore.getState().setPreviewStatus("success");
    useOrderFormStore.getState().setVehicleClass("suv");
    expect(useOrderFormStore.getState().vehicleClass).toBe("suv");
    expect(useOrderFormStore.getState().previewStatus).toBe("idle");
  });

  it("builds correct order request body", () => {
    const store = useOrderFormStore.getState();
    store.setPickupZoneId("pickup-uuid");
    store.setPickupLabel("Home");
    store.setDropoffZoneId("dropoff-uuid");
    store.setDropoffLabel("Work");
    store.setVehicleClass("suv");
    store.setPriceMode("customer_offer");
    store.setOfferedPrice("25.50");
    store.setNotes("Call me when you arrive");

    const body = buildOrderRequest(useOrderFormStore.getState());
    expect(body.order_type).toBe("ride");
    expect(body.vehicle_class).toBe("suv");
    expect(body.price_mode).toBe("customer_offer");
    expect(body.offered_price).toEqual({ amount: 25.5, currency: "SAR" });
    expect(body.stops).toHaveLength(2);
    expect(body.stops[0].kind).toBe("pickup");
    expect(body.stops[0].zone_id).toBe("pickup-uuid");
    expect(body.stops[0].label).toBe("Home");
    expect(body.stops[1].kind).toBe("dropoff");
    expect(body.stops[1].zone_id).toBe("dropoff-uuid");
    expect(body.stops[1].label).toBe("Work");
    expect(body.notes).toBe("Call me when you arrive");
  });

  it("builds order request with null offered_price for negotiable mode", () => {
    const store = useOrderFormStore.getState();
    store.setPickupZoneId("zone-1");
    store.setDropoffZoneId("zone-2");
    store.setPriceMode("negotiable");

    const body = buildOrderRequest(useOrderFormStore.getState());
    expect(body.price_mode).toBe("negotiable");
    expect(body.offered_price).toBeNull();
  });

  it("validates: missing pickup zone", () => {
    const store = useOrderFormStore.getState();
    store.setDropoffZoneId("zone-2");
    expect(validateOrderForm(useOrderFormStore.getState())).toBe("pickup_zone_required");
  });

  it("validates: missing dropoff zone", () => {
    const store = useOrderFormStore.getState();
    store.setPickupZoneId("zone-1");
    expect(validateOrderForm(useOrderFormStore.getState())).toBe("dropoff_zone_required");
  });

  it("validates: same pickup and dropoff zone", () => {
    const store = useOrderFormStore.getState();
    store.setPickupZoneId("same-zone");
    store.setDropoffZoneId("same-zone");
    expect(validateOrderForm(useOrderFormStore.getState())).toBe("same_zone");
  });

  it("validates: customer_offer with no price", () => {
    const store = useOrderFormStore.getState();
    store.setPickupZoneId("zone-1");
    store.setDropoffZoneId("zone-2");
    store.setPriceMode("customer_offer");
    expect(validateOrderForm(useOrderFormStore.getState())).toBe("invalid_price");
  });

  it("validates: customer_offer with zero price", () => {
    const store = useOrderFormStore.getState();
    store.setPickupZoneId("zone-1");
    store.setDropoffZoneId("zone-2");
    store.setPriceMode("customer_offer");
    store.setOfferedPrice("0");
    expect(validateOrderForm(useOrderFormStore.getState())).toBe("invalid_price");
  });

  it("validates: notes too long", () => {
    const store = useOrderFormStore.getState();
    store.setPickupZoneId("zone-1");
    store.setDropoffZoneId("zone-2");
    store.setNotes("x".repeat(501));
    expect(validateOrderForm(useOrderFormStore.getState())).toBe("notes_too_long");
  });

  it("validates: valid form returns null", () => {
    const store = useOrderFormStore.getState();
    store.setPickupZoneId("zone-1");
    store.setDropoffZoneId("zone-2");
    store.setPriceMode("customer_offer");
    store.setOfferedPrice("15");
    expect(validateOrderForm(useOrderFormStore.getState())).toBeNull();
  });

  it("resetForm restores defaults", () => {
    const store = useOrderFormStore.getState();
    store.setPickupZoneId("changed");
    store.setVehicleClass("van");
    store.setPreviewStatus("success");
    store.setSubmitStatus("error");
    useOrderFormStore.getState().resetForm();
    const state = useOrderFormStore.getState();
    expect(state.pickupZoneId).toBe("");
    expect(state.vehicleClass).toBe("sedan");
    expect(state.previewStatus).toBe("idle");
    expect(state.submitStatus).toBe("idle");
  });
});

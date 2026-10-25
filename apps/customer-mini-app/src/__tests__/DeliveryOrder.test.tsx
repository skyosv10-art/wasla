import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DeliveryOrder } from "../screens/DeliveryOrder";
import { useOrderFormStore } from "../store/order-form";
import { useSessionStore } from "../store/session";
import { usePlacesStore } from "../store/places";
import "../i18n";

vi.mock("../api/client", () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

import { apiClient } from "../api/client";

const mockedPost = apiClient.post as ReturnType<typeof vi.fn>;

describe("DeliveryOrder screen", () => {
  beforeEach(() => {
    useOrderFormStore.getState().resetForm();
    usePlacesStore.setState({ places: [], status: "idle", error: null });
    useSessionStore.setState({ token: "test-token", customerId: "WS-1234567890", expiresAt: Date.now() + 3600000 });
    vi.clearAllMocks();
  });

  it("renders all form fields including shipment details", () => {
    render(<DeliveryOrder />);
    expect(screen.getByTestId("d-pickup-zone-input")).toBeInTheDocument();
    expect(screen.getByTestId("d-dropoff-zone-input")).toBeInTheDocument();
    expect(screen.getByTestId("shipment-type-select")).toBeInTheDocument();
    expect(screen.getByTestId("shipment-desc-input")).toBeInTheDocument();
    expect(screen.getByTestId("weight-kg-input")).toBeInTheDocument();
  });

  it("renders the saved-place pickers for pickup and dropoff (G-S9.1)", () => {
    render(<DeliveryOrder />);

    expect(screen.getByTestId("d-pickup-place-select")).toBeInTheDocument();
    expect(screen.getByTestId("d-dropoff-place-select")).toBeInTheDocument();
  });

  it("shares one places request and drops the picker label on a manual edit (CLM-0622)", async () => {
    const mockedGet = apiClient.get as ReturnType<typeof vi.fn>;
    mockedGet.mockResolvedValue({
      items: [
        { place_id: "place-home", label: "المنزل", zone_id: "z-home", zone_path: null, created_at: "2026-10-18T00:00:00Z" },
      ],
      limit: 5,
    });

    render(<DeliveryOrder />);

    const pickupSelect = (await screen.findByTestId("d-pickup-place-select")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(pickupSelect.options).some((o) => o.value === "place-home")).toBe(true);
    });
    expect(mockedGet).toHaveBeenCalledTimes(1);

    fireEvent.change(pickupSelect, { target: { value: "place-home" } });
    expect(useOrderFormStore.getState().pickupLabel).toBe("المنزل");
    fireEvent.change(screen.getByTestId("d-pickup-zone-input"), { target: { value: "z-manual" } });
    expect(useOrderFormStore.getState().pickupLabel).toBe("");
    expect(useOrderFormStore.getState().pickupSource).toBe("manual_zone");
  });

  it("submitting with a saved place selected sends source saved_place for that stop (G-S9.1)", async () => {
    const mockedGet = apiClient.get as ReturnType<typeof vi.fn>;
    mockedGet.mockResolvedValue({
      items: [
        {
          place_id: "place-home",
          label: "المنزل",
          zone_id: "z-home",
          zone_path: ["المدينة", "العزيزية"],
          created_at: "2026-10-18T00:00:00Z",
        },
      ],
      limit: 5,
    });
    mockedPost.mockResolvedValue({} as never);

    render(<DeliveryOrder />);

    const pickupSelect = (await screen.findByTestId("d-pickup-place-select")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(pickupSelect.options).some((o) => o.value === "place-home")).toBe(true);
    });
    fireEvent.change(pickupSelect, { target: { value: "place-home" } });

    fireEvent.change(screen.getByTestId("d-dropoff-zone-input"), { target: { value: "z-2" } });
    fireEvent.click(screen.getByTestId("d-submit-button"));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalled();
    });

    const body = mockedPost.mock.calls[0][1] as {
      stops: Array<{ kind: string; zone_id: string; source: string; label: string | null }>;
    };
    expect(body.stops[0]).toMatchObject({
      kind: "pickup",
      zone_id: "z-home",
      source: "saved_place",
      label: "المنزل",
    });
    expect(body.stops[1]).toMatchObject({ kind: "dropoff", zone_id: "z-2", source: "manual_zone" });
  });

  it("shows shipment type options", () => {
    render(<DeliveryOrder />);
    const select = screen.getByTestId("shipment-type-select");
    fireEvent.change(select, { target: { value: "parcel" } });
    expect(select).toHaveValue("parcel");
  });

  it("validates and shows error when pickup zone is empty", async () => {
    render(<DeliveryOrder />);
    fireEvent.click(screen.getByTestId("d-submit-button"));
    await waitFor(() => {
      expect(screen.getByTestId("d-form-error")).toBeInTheDocument();
    });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("calls preview API with delivery order_type and shipment", async () => {
    const previewResponse = {
      valid: true,
      order_type: "delivery",
      vehicle_class: "van",
      price_mode: "negotiable",
      stops: [
        { kind: "pickup", zone_id: "zone-1" },
        { kind: "dropoff", zone_id: "zone-2" },
      ],
    };
    mockedPost.mockResolvedValueOnce(previewResponse);

    render(<DeliveryOrder />);
    fireEvent.change(screen.getByTestId("d-pickup-zone-input"), { target: { value: "zone-1" } });
    fireEvent.change(screen.getByTestId("d-dropoff-zone-input"), { target: { value: "zone-2" } });
    fireEvent.change(screen.getByTestId("shipment-type-select"), { target: { value: "parcel" } });
    fireEvent.change(screen.getByTestId("shipment-desc-input"), { target: { value: "Important documents" } });
    fireEvent.change(screen.getByTestId("weight-kg-input"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByTestId("d-preview-button"));

    await waitFor(() => {
      expect(screen.getByTestId("d-preview-result")).toBeInTheDocument();
    });

    expect(mockedPost).toHaveBeenCalledWith(
      "/customers/WS-1234567890/order-requests/preview",
      expect.objectContaining({
        order_type: "delivery",
        shipment: expect.objectContaining({
          shipment_type: "parcel",
          description: "Important documents",
          weight_kg: 2.5,
        }),
      })
    );
  });

  it("calls submit API with Idempotency-Key header", async () => {
    const submitResponse = {
      id: "req-456",
      status: "submitted",
    };
    mockedPost.mockResolvedValueOnce(submitResponse);

    render(<DeliveryOrder />);
    fireEvent.change(screen.getByTestId("d-pickup-zone-input"), { target: { value: "zone-1" } });
    fireEvent.change(screen.getByTestId("d-dropoff-zone-input"), { target: { value: "zone-2" } });
    fireEvent.click(screen.getByTestId("d-submit-button"));

    await waitFor(() => {
      expect(screen.getByTestId("d-submit-success")).toBeInTheDocument();
    });

    expect(mockedPost).toHaveBeenCalledWith(
      "/customers/WS-1234567890/order-requests",
      expect.objectContaining({ order_type: "delivery" }),
      expect.objectContaining({ "Idempotency-Key": expect.any(String) })
    );
  });
});

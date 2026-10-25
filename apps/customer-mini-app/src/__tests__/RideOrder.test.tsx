import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RideOrder } from "../screens/RideOrder";
import { useOrderFormStore } from "../store/order-form";
import { useSessionStore } from "../store/session";
import { usePlacesStore } from "../store/places";
import "../i18n";

// Mock the API client
vi.mock("../api/client", () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

import { apiClient } from "../api/client";

const mockedPost = apiClient.post as ReturnType<typeof vi.fn>;
const mockedGet = apiClient.get as ReturnType<typeof vi.fn>;

const savedPlaces = {
  items: [
    {
      place_id: "place-home",
      label: "المنزل",
      zone_id: "z-home",
      zone_path: ["المدينة", "العزيزية"],
      created_at: "2026-10-18T00:00:00Z",
    },
    {
      place_id: "place-work",
      label: "العمل",
      zone_id: "z-work",
      zone_path: ["المدينة", "المركز"],
      created_at: "2026-10-18T00:00:00Z",
    },
  ],
  limit: 5,
};

describe("RideOrder screen", () => {
  beforeEach(() => {
    useOrderFormStore.getState().resetForm();
    usePlacesStore.setState({ places: [], status: "idle", error: null });
    useSessionStore.setState({ token: "test-token", customerId: "WS-1234567890", expiresAt: Date.now() + 3600000 });
    vi.clearAllMocks();
  });

  it("renders all form fields", () => {
    render(<RideOrder />);
    expect(screen.getByTestId("pickup-zone-input")).toBeInTheDocument();
    expect(screen.getByTestId("dropoff-zone-input")).toBeInTheDocument();
    expect(screen.getByTestId("vehicle-class-select")).toBeInTheDocument();
    expect(screen.getByTestId("price-mode-select")).toBeInTheDocument();
    expect(screen.getByTestId("notes-input")).toBeInTheDocument();
    expect(screen.getByTestId("preview-button")).toBeInTheDocument();
    expect(screen.getByTestId("submit-button")).toBeInTheDocument();
  });

  it("renders the saved-place pickers for pickup and dropoff (G-S9.1)", () => {
    render(<RideOrder />);

    expect(screen.getByTestId("pickup-place-select")).toBeInTheDocument();
    expect(screen.getByTestId("dropoff-place-select")).toBeInTheDocument();
  });

  it("loads saved places on mount and lists them in the pickup picker (G-S9.1)", async () => {
    mockedGet.mockResolvedValue(savedPlaces);

    render(<RideOrder />);

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith("/customers/WS-1234567890/places");
    });

    const pickupSelect = (await screen.findByTestId("pickup-place-select")) as HTMLSelectElement;
    const optionValues = Array.from(pickupSelect.options).map((o) => o.value);
    expect(optionValues).toContain("place-home");
    expect(optionValues).toContain("place-work");
  });

  it("submitting with saved places selected sends source saved_place with the place's zone and label (G-S9.1)", async () => {
    mockedGet.mockResolvedValue(savedPlaces);
    mockedPost.mockResolvedValue({} as never);

    render(<RideOrder />);

    const pickupSelect = (await screen.findByTestId("pickup-place-select")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(pickupSelect.options).some((o) => o.value === "place-home")).toBe(true);
    });
    fireEvent.change(pickupSelect, { target: { value: "place-home" } });

    const dropoffSelect = screen.getByTestId("dropoff-place-select") as HTMLSelectElement;
    fireEvent.change(dropoffSelect, { target: { value: "place-work" } });

    fireEvent.change(screen.getByTestId("price-mode-select"), { target: { value: "customer_offer" } });
    fireEvent.change(screen.getByTestId("offered-price-input"), { target: { value: "25" } });
    fireEvent.click(screen.getByTestId("submit-button"));

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
    expect(body.stops[1]).toMatchObject({
      kind: "dropoff",
      zone_id: "z-work",
      source: "saved_place",
      label: "العمل",
    });
  });

  it("two pickers on one screen share a single places request (CLM-0622)", async () => {
    mockedGet.mockResolvedValue(savedPlaces);

    render(<RideOrder />);

    const pickupSelect = (await screen.findByTestId("pickup-place-select")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(pickupSelect.options).some((o) => o.value === "place-home")).toBe(true);
    });
    const dropoffSelect = screen.getByTestId("dropoff-place-select") as HTMLSelectElement;
    expect(Array.from(dropoffSelect.options).some((o) => o.value === "place-work")).toBe(true);
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith("/customers/WS-1234567890/places");
  });

  it("a failed places load is visible and retry loads the places (CLM-0622)", async () => {
    mockedGet.mockRejectedValueOnce(new Error("network_error")).mockResolvedValueOnce(savedPlaces);

    render(<RideOrder />);

    const alert = await screen.findByTestId("pickup-place-select-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("تعذّر تحميل الأماكن المحفوظة");
    expect(mockedGet).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("pickup-place-select-retry"));

    const pickupSelect = screen.getByTestId("pickup-place-select") as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(pickupSelect.options).some((o) => o.value === "place-home")).toBe(true);
    });
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("pickup-place-select-error")).not.toBeInTheDocument();
  });

  it("a manual zone edit after picking a place drops the picker-filled label (CLM-0622)", async () => {
    mockedGet.mockResolvedValue(savedPlaces);
    mockedPost.mockResolvedValue({} as never);

    render(<RideOrder />);

    const pickupSelect = (await screen.findByTestId("pickup-place-select")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(pickupSelect.options).some((o) => o.value === "place-home")).toBe(true);
    });
    fireEvent.change(pickupSelect, { target: { value: "place-home" } });
    expect(useOrderFormStore.getState().pickupLabel).toBe("المنزل");

    fireEvent.change(screen.getByTestId("pickup-zone-input"), { target: { value: "z-manual" } });
    expect(useOrderFormStore.getState().pickupLabel).toBe("");

    fireEvent.change(screen.getByTestId("dropoff-zone-input"), { target: { value: "z-2" } });
    fireEvent.change(screen.getByTestId("price-mode-select"), { target: { value: "customer_offer" } });
    fireEvent.change(screen.getByTestId("offered-price-input"), { target: { value: "25" } });
    fireEvent.click(screen.getByTestId("submit-button"));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalled();
    });
    const body = mockedPost.mock.calls[0][1] as {
      stops: Array<{ zone_id: string; source: string; label: string | null }>;
    };
    expect(body.stops[0]).toEqual(
      expect.objectContaining({ zone_id: "z-manual", source: "manual_zone", label: null })
    );
  });

  it("a manual zone edit without a picked place keeps the label the user typed (CLM-0622)", async () => {
    mockedGet.mockResolvedValue(savedPlaces);

    render(<RideOrder />);

    useOrderFormStore.getState().setPickupLabel("بوابة المسجد");
    fireEvent.change(screen.getByTestId("pickup-zone-input"), { target: { value: "z-manual" } });
    expect(useOrderFormStore.getState().pickupLabel).toBe("بوابة المسجد");
    expect(useOrderFormStore.getState().pickupSource).toBe("manual_zone");
  });

  it("manually editing the zone after picking a place reverts the stop source to manual_zone (G-S9.1)", async () => {
    mockedGet.mockResolvedValue(savedPlaces);
    mockedPost.mockResolvedValue({} as never);

    render(<RideOrder />);

    const pickupSelect = (await screen.findByTestId("pickup-place-select")) as HTMLSelectElement;
    await waitFor(() => {
      expect(Array.from(pickupSelect.options).some((o) => o.value === "place-home")).toBe(true);
    });
    fireEvent.change(pickupSelect, { target: { value: "place-home" } });

    const zoneInput = screen.getByTestId("pickup-zone-input");
    fireEvent.change(zoneInput, { target: { value: "z-manual" } });

    fireEvent.change(screen.getByTestId("dropoff-zone-input"), { target: { value: "z-2" } });
    fireEvent.change(screen.getByTestId("price-mode-select"), { target: { value: "customer_offer" } });
    fireEvent.change(screen.getByTestId("offered-price-input"), { target: { value: "25" } });
    fireEvent.click(screen.getByTestId("submit-button"));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalled();
    });

    const body = mockedPost.mock.calls[0][1] as {
      stops: Array<{ kind: string; zone_id: string; source: string }>;
    };
    expect(body.stops[0]).toMatchObject({ zone_id: "z-manual", source: "manual_zone" });
  });

  it("shows offered price field only when price_mode is customer_offer", () => {
    render(<RideOrder />);
    // Default is negotiable — no price field
    expect(screen.queryByTestId("offered-price-input")).not.toBeInTheDocument();

    // Switch to customer_offer
    fireEvent.change(screen.getByTestId("price-mode-select"), {
      target: { value: "customer_offer" },
    });
    expect(screen.getByTestId("offered-price-input")).toBeInTheDocument();
  });

  it("validates and shows error when pickup zone is empty", async () => {
    render(<RideOrder />);
    fireEvent.click(screen.getByTestId("submit-button"));
    await waitFor(() => {
      expect(screen.getByTestId("form-error")).toBeInTheDocument();
    });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("calls preview API and shows result", async () => {
    const previewResponse = {
      valid: true,
      order_type: "ride",
      vehicle_class: "sedan",
      price_mode: "negotiable",
      stops: [
        { kind: "pickup", zone_id: "zone-1", label: "Home" },
        { kind: "dropoff", zone_id: "zone-2", label: "Work" },
      ],
    };
    mockedPost.mockResolvedValueOnce(previewResponse);

    render(<RideOrder />);
    fireEvent.change(screen.getByTestId("pickup-zone-input"), {
      target: { value: "zone-1" },
    });
    fireEvent.change(screen.getByTestId("dropoff-zone-input"), {
      target: { value: "zone-2" },
    });
    fireEvent.click(screen.getByTestId("preview-button"));

    await waitFor(() => {
      expect(screen.getByTestId("preview-result")).toBeInTheDocument();
    });
    expect(mockedPost).toHaveBeenCalledWith(
      "/customers/WS-1234567890/order-requests/preview",
      expect.objectContaining({ order_type: "ride" })
    );
  });

  it("calls submit API with Idempotency-Key header", async () => {
    const submitResponse = {
      id: "req-123",
      status: "submitted",
      order_public_id: "ORD-001",
    };
    mockedPost.mockResolvedValueOnce(submitResponse);

    render(<RideOrder />);
    fireEvent.change(screen.getByTestId("pickup-zone-input"), {
      target: { value: "zone-1" },
    });
    fireEvent.change(screen.getByTestId("dropoff-zone-input"), {
      target: { value: "zone-2" },
    });
    fireEvent.click(screen.getByTestId("submit-button"));

    await waitFor(() => {
      expect(screen.getByTestId("submit-success")).toBeInTheDocument();
    });

    expect(mockedPost).toHaveBeenCalledWith(
      "/customers/WS-1234567890/order-requests",
      expect.objectContaining({ order_type: "ride" }),
      expect.objectContaining({ "Idempotency-Key": expect.any(String) })
    );
  });

  it("disables buttons while submitting", async () => {
    mockedPost.mockImplementationOnce(() => new Promise(() => {})); // never resolves

    render(<RideOrder />);
    fireEvent.change(screen.getByTestId("pickup-zone-input"), {
      target: { value: "zone-1" },
    });
    fireEvent.change(screen.getByTestId("dropoff-zone-input"), {
      target: { value: "zone-2" },
    });
    fireEvent.click(screen.getByTestId("submit-button"));

    await waitFor(() => {
      const submitBtn = screen.getByTestId("submit-button");
      const previewBtn = screen.getByTestId("preview-button");
      expect(submitBtn).toBeDisabled();
      expect(previewBtn).toBeDisabled();
    });
  });

  it("shows error message when preview fails", async () => {
    mockedPost.mockRejectedValueOnce(new Error("Network error"));

    render(<RideOrder />);
    fireEvent.change(screen.getByTestId("pickup-zone-input"), {
      target: { value: "zone-1" },
    });
    fireEvent.change(screen.getByTestId("dropoff-zone-input"), {
      target: { value: "zone-2" },
    });
    fireEvent.click(screen.getByTestId("preview-button"));

    await waitFor(() => {
      expect(screen.getByTestId("preview-error")).toBeInTheDocument();
    });
  });

  it("shows error message when submit fails", async () => {
    mockedPost.mockRejectedValueOnce(new Error("Server error"));

    render(<RideOrder />);
    fireEvent.change(screen.getByTestId("pickup-zone-input"), {
      target: { value: "zone-1" },
    });
    fireEvent.change(screen.getByTestId("dropoff-zone-input"), {
      target: { value: "zone-2" },
    });
    fireEvent.click(screen.getByTestId("submit-button"));

    await waitFor(() => {
      expect(screen.getByTestId("submit-error")).toBeInTheDocument();
    });
  });
});

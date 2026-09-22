import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RideOrder } from "../screens/RideOrder";
import { useOrderFormStore } from "../store/order-form";
import { useSessionStore } from "../store/session";
import "../i18n";

// Mock the API client
vi.mock("../api/client", () => ({
  apiClient: {
    post: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

import { apiClient } from "../api/client";

const mockedPost = apiClient.post as ReturnType<typeof vi.fn>;

describe("RideOrder screen", () => {
  beforeEach(() => {
    useOrderFormStore.getState().resetForm();
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
      order_request_id: "req-123",
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

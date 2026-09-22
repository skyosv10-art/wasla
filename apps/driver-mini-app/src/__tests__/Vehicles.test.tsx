import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Vehicles } from "../screens/Vehicles";
import { useVehiclesStore } from "../store/vehicles";
import { useSessionStore } from "../store/session";
import type { Vehicle } from "../types/vehicles";

vi.mock("../api/client", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class extends Error {
    constructor(public status: number, message: string) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockVehicle: Vehicle = {
  id: "veh-1",
  vehicle_class: "sedan",
  make: "Toyota",
  model: "Camry",
  model_year: 2023,
  color: "White",
  plate_number: "ABC-1234",
  is_primary: true,
  status: "active",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const mockVehicle2: Vehicle = {
  id: "veh-2",
  vehicle_class: "suv",
  make: "Nissan",
  model: "Patrol",
  model_year: 2022,
  color: "Black",
  plate_number: "XYZ-5678",
  is_primary: false,
  status: "active",
  created_at: "2024-01-02T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
};

describe("Vehicles screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVehiclesStore.setState({
      vehicles: [],
      loading: false,
      error: null,
      actionLoading: false,
      actionError: null,
      fetchVehicles: vi.fn(),
      addVehicle: vi.fn(),
      patchVehicle: vi.fn(),
      clearErrors: vi.fn(),
    });
    useSessionStore.getState().setSession("token-123", "drv-123", Date.now() + 3_600_000);
  });

  it("renders loading state", () => {
    useVehiclesStore.setState({ loading: true });
    render(<Vehicles />);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("renders error state with retry", () => {
    useVehiclesStore.setState({
      error: "Network error",
      fetchVehicles: vi.fn(),
    });
    render(<Vehicles />);
    expect(screen.getByText("Network error")).toBeInTheDocument();
    expect(screen.getByText("common.retry")).toBeInTheDocument();
  });

  it("renders empty state when no vehicles", () => {
    render(<Vehicles />);
    expect(screen.getByText("common.empty")).toBeInTheDocument();
    expect(screen.getByTestId("add-vehicle-btn")).toBeInTheDocument();
  });

  it("renders vehicle cards", () => {
    useVehiclesStore.setState({
      vehicles: [mockVehicle, mockVehicle2],
    });
    render(<Vehicles />);
    expect(screen.getByTestId("vehicle-veh-1")).toBeInTheDocument();
    expect(screen.getByTestId("vehicle-veh-2")).toBeInTheDocument();
    expect(screen.getByText("Toyota")).toBeInTheDocument();
    expect(screen.getByText("Nissan")).toBeInTheDocument();
  });

  it("shows retire button for active vehicles", () => {
    useVehiclesStore.setState({
      vehicles: [mockVehicle2],
    });
    render(<Vehicles />);
    expect(screen.getByTestId("retire-veh-2")).toBeInTheDocument();
  });

  it("shows set-primary button for non-primary active vehicles", () => {
    useVehiclesStore.setState({
      vehicles: [mockVehicle2],
    });
    render(<Vehicles />);
    expect(screen.getByTestId("set-primary-veh-2")).toBeInTheDocument();
  });

  it("does not show set-primary for primary vehicles", () => {
    useVehiclesStore.setState({
      vehicles: [mockVehicle],
    });
    render(<Vehicles />);
    expect(screen.queryByTestId("set-primary-veh-1")).not.toBeInTheDocument();
  });

  it("shows add vehicle form when button clicked", () => {
    render(<Vehicles />);
    fireEvent.click(screen.getByTestId("add-vehicle-btn"));
    expect(screen.getByTestId("vehicle-form")).toBeInTheDocument();
    expect(screen.getByTestId("form-vehicle_class")).toBeInTheDocument();
    expect(screen.getByTestId("form-make")).toBeInTheDocument();
  });

  it("calls addVehicle on form submit", async () => {
    const addVehicle = vi.fn().mockResolvedValue(true);
    useVehiclesStore.setState({ addVehicle });
    render(<Vehicles />);
    fireEvent.click(screen.getByTestId("add-vehicle-btn"));
    fireEvent.change(screen.getByTestId("form-make"), {
      target: { value: "Honda" },
    });
    fireEvent.click(screen.getByTestId("submit-vehicle"));
    await waitFor(() => {
      expect(addVehicle).toHaveBeenCalled();
    });
  });

  it("calls patchVehicle on retire button", async () => {
    const patchVehicle = vi.fn().mockResolvedValue(true);
    useVehiclesStore.setState({
      vehicles: [mockVehicle2],
      patchVehicle,
    });
    render(<Vehicles />);
    fireEvent.click(screen.getByTestId("retire-veh-2"));
    await waitFor(() => {
      expect(patchVehicle).toHaveBeenCalledWith("veh-2", { status: "retired" });
    });
  });

  it("calls patchVehicle on set-primary button", async () => {
    const patchVehicle = vi.fn().mockResolvedValue(true);
    useVehiclesStore.setState({
      vehicles: [mockVehicle2],
      patchVehicle,
    });
    render(<Vehicles />);
    fireEvent.click(screen.getByTestId("set-primary-veh-2"));
    await waitFor(() => {
      expect(patchVehicle).toHaveBeenCalledWith("veh-2", { is_primary: true });
    });
  });

  it("shows action error when present", () => {
    useVehiclesStore.setState({
      vehicles: [mockVehicle],
      actionError: "Failed to add",
    });
    render(<Vehicles />);
    expect(screen.getByTestId("action-error")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Zones } from "../screens/Zones";
import { useZonesStore } from "../store/zones";
import { useSessionStore } from "../store/session";

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

describe("Zones screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useZonesStore.setState({
      zones: [],
      availableZones: [],
      loading: false,
      error: null,
      saving: false,
      saveError: null,
      saveSuccess: false,
      fetchZones: vi.fn(),
      setAvailableZones: vi.fn(),
      saveZones: vi.fn(),
      clearErrors: vi.fn(),
    });
    useSessionStore.getState().setSession("token-123", "drv-123", Date.now() + 3_600_000);
  });

  it("renders loading state", () => {
    useZonesStore.setState({ loading: true });
    render(<Zones />);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("renders error state with retry", () => {
    useZonesStore.setState({
      error: "Network error",
      fetchZones: vi.fn(),
    });
    render(<Zones />);
    expect(screen.getByText("Network error")).toBeInTheDocument();
    expect(screen.getByText("common.retry")).toBeInTheDocument();
  });

  it("renders empty state when no zones", () => {
    render(<Zones />);
    expect(screen.getByText("common.empty")).toBeInTheDocument();
  });

  it("renders zone checkboxes for existing zones", () => {
    useZonesStore.setState({
      zones: [
        { zone_id: "zone-1", preference_rank: 1, created_at: "2024-01-01T00:00:00Z" },
        { zone_id: "zone-2", preference_rank: 2, created_at: "2024-01-02T00:00:00Z" },
      ],
    });
    render(<Zones />);
    expect(screen.getByTestId("zone-zone-1")).toBeInTheDocument();
    expect(screen.getByTestId("zone-zone-2")).toBeInTheDocument();
  });

  it("checkboxes are checked for existing zones", () => {
    useZonesStore.setState({
      zones: [
        { zone_id: "zone-1", preference_rank: 1, created_at: "2024-01-01T00:00:00Z" },
      ],
    });
    render(<Zones />);
    const checkbox = screen.getByTestId("zone-checkbox-zone-1") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("toggles zone selection on checkbox click", () => {
    useZonesStore.setState({
      zones: [
        { zone_id: "zone-1", preference_rank: 1, created_at: "2024-01-01T00:00:00Z" },
      ],
    });
    render(<Zones />);
    const checkbox = screen.getByTestId("zone-checkbox-zone-1");
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it("calls saveZones on save button", async () => {
    const saveZones = vi.fn().mockResolvedValue(true);
    useZonesStore.setState({
      zones: [
        { zone_id: "zone-1", preference_rank: 1, created_at: "2024-01-01T00:00:00Z" },
      ],
      saveZones,
    });
    render(<Zones />);
    fireEvent.click(screen.getByTestId("save-zones"));
    await waitFor(() => {
      expect(saveZones).toHaveBeenCalledWith([
        { zone_id: "zone-1", preference_rank: 1 },
      ]);
    });
  });

  it("save button is disabled when no zones selected", () => {
    useZonesStore.setState({
      zones: [],
    });
    render(<Zones />);
    const saveBtn = screen.getByTestId("save-zones") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it("shows save error when present", () => {
    useZonesStore.setState({
      zones: [
        { zone_id: "zone-1", preference_rank: 1, created_at: "2024-01-01T00:00:00Z" },
      ],
      saveError: "Failed to save",
    });
    render(<Zones />);
    expect(screen.getByTestId("save-error")).toBeInTheDocument();
  });

  it("shows save success when saveSuccess is true", () => {
    useZonesStore.setState({
      zones: [
        { zone_id: "zone-1", preference_rank: 1, created_at: "2024-01-01T00:00:00Z" },
      ],
      saveSuccess: true,
    });
    render(<Zones />);
    expect(screen.getByTestId("save-success")).toBeInTheDocument();
  });

  it("save button shows submitting text when saving", () => {
    useZonesStore.setState({
      zones: [
        { zone_id: "zone-1", preference_rank: 1, created_at: "2024-01-01T00:00:00Z" },
      ],
      saving: true,
    });
    render(<Zones />);
    expect(screen.getByTestId("save-zones").textContent).toBe("common.submitting");
  });

  it("re-orders zones by preference_rank on save", async () => {
    const saveZones = vi.fn().mockResolvedValue(true);
    useZonesStore.setState({
      zones: [
        { zone_id: "zone-2", preference_rank: 2, created_at: "2024-01-02T00:00:00Z" },
        { zone_id: "zone-1", preference_rank: 1, created_at: "2024-01-01T00:00:00Z" },
      ],
      saveZones,
    });
    render(<Zones />);
    fireEvent.click(screen.getByTestId("save-zones"));
    await waitFor(() => {
      expect(saveZones).toHaveBeenCalledWith([
        { zone_id: "zone-1", preference_rank: 1 },
        { zone_id: "zone-2", preference_rank: 2 },
      ]);
    });
  });
});

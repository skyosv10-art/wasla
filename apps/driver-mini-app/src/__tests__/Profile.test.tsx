import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Profile } from "../screens/Profile";
import { useProfileStore } from "../store/profile";
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

const mockProfile = {
  wasla_public_id: "drv-123",
  display_name: "Ahmed",
  preferred_locale: "ar",
  status: "active" as const,
  verification_status: "verified" as const,
  declared_availability: "available" as const,
  work_city_zone_id: "zone-1",
  service_kinds: ["ride"] as ("ride" | "delivery")[],
  suspension_reason_code: null,
  eligibility_policy_version: 1,
  eligibility_recheck_at: null,
  last_published_state: null,
  last_published_at: null,
  created_at: "",
  updated_at: "",
};

describe("Profile screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProfileStore.setState({
      profile: null,
      loading: false,
      error: null,
      saving: false,
      saveError: null,
      saveSuccess: false,
      fetchProfile: vi.fn(),
      updateProfile: vi.fn(),
      clearErrors: vi.fn(),
    });
    useSessionStore.getState().setSession("token-123", "drv-123", Date.now() + 3_600_000);
  });

  it("renders loading state", () => {
    useProfileStore.setState({ loading: true });
    render(<Profile />);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("renders error state with retry", () => {
    useProfileStore.setState({
      error: "Network error",
      fetchProfile: vi.fn(),
    });
    render(<Profile />);
    expect(screen.getByText("Network error")).toBeInTheDocument();
    expect(screen.getByText("common.retry")).toBeInTheDocument();
  });

  it("renders profile info when loaded", () => {
    useProfileStore.setState({ profile: mockProfile });
    render(<Profile />);
    expect(screen.getByTestId("profile-info")).toBeInTheDocument();
    expect(screen.getByTestId("profile-status")).toBeInTheDocument();
    expect(screen.getByTestId("profile-verification")).toBeInTheDocument();
    expect(screen.getByTestId("profile-availability")).toBeInTheDocument();
  });

  it("shows suspension reason when suspended", () => {
    useProfileStore.setState({
      profile: { ...mockProfile, status: "suspended", suspension_reason_code: "policy_violation" },
    });
    render(<Profile />);
    expect(screen.getByTestId("profile-suspension")).toBeInTheDocument();
  });

  it("renders profile form with editable fields", () => {
    useProfileStore.setState({ profile: mockProfile });
    render(<Profile />);
    expect(screen.getByTestId("profile-form")).toBeInTheDocument();
    expect(screen.getByTestId("form-display_name")).toBeInTheDocument();
    expect(screen.getByTestId("form-preferred_locale")).toBeInTheDocument();
    expect(screen.getByTestId("form-work_city_zone_id")).toBeInTheDocument();
  });

  it("shows service kind checkboxes", () => {
    useProfileStore.setState({ profile: mockProfile });
    render(<Profile />);
    expect(screen.getByTestId("service-kind-ride")).toBeInTheDocument();
    expect(screen.getByTestId("service-kind-delivery")).toBeInTheDocument();
  });

  it("toggles service kind on checkbox click", () => {
    useProfileStore.setState({ profile: mockProfile });
    render(<Profile />);
    const checkbox = screen.getByTestId("service-kind-checkbox-delivery");
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
  });

  it("calls updateProfile on save button", async () => {
    const updateProfile = vi.fn().mockResolvedValue(true);
    useProfileStore.setState({ profile: mockProfile, updateProfile });
    render(<Profile />);
    fireEvent.change(screen.getByTestId("form-display_name"), {
      target: { value: "Ali" },
    });
    fireEvent.click(screen.getByTestId("save-profile"));
    await waitFor(() => {
      expect(updateProfile).toHaveBeenCalled();
    });
  });

  it("shows save error when present", () => {
    useProfileStore.setState({
      profile: mockProfile,
      saveError: "Failed to save",
    });
    render(<Profile />);
    expect(screen.getByTestId("save-error")).toBeInTheDocument();
  });

  it("shows save success when saveSuccess is true", () => {
    useProfileStore.setState({
      profile: mockProfile,
      saveSuccess: true,
    });
    render(<Profile />);
    expect(screen.getByTestId("save-success")).toBeInTheDocument();
  });

  it("save button shows submitting text when saving", () => {
    useProfileStore.setState({
      profile: mockProfile,
      saving: true,
    });
    render(<Profile />);
    expect(screen.getByTestId("save-profile").textContent).toBe("common.submitting");
  });

  it("disables save button while saving", () => {
    useProfileStore.setState({
      profile: mockProfile,
      saving: true,
    });
    render(<Profile />);
    const saveBtn = screen.getByTestId("save-profile") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });
});

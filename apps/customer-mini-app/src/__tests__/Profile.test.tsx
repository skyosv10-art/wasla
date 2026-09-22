import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Profile } from "../screens/Profile";
import { useSessionStore } from "../store/session";
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

const mockedGet = apiClient.get as ReturnType<typeof vi.fn>;
const mockedPut = apiClient.put as ReturnType<typeof vi.fn>;

describe("Profile screen", () => {
  beforeEach(() => {
    useSessionStore.setState({ token: "test-token", customerId: "WS-1234567890", expiresAt: Date.now() + 3600000 });
    vi.clearAllMocks();
  });

  it("loads profile on mount", async () => {
    mockedGet.mockResolvedValueOnce({
      display_name: "Ahmed",
      phone_number: "+966500000000",
      email: "ahmed@example.com",
      preferred_language: "ar",
    });

    render(<Profile />);

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith("/customers/WS-1234567890/profile");
    });
  });

  it("renders profile form with loaded data", async () => {
    mockedGet.mockResolvedValueOnce({
      display_name: "Ahmed",
      phone_number: "+966500000000",
      email: "ahmed@example.com",
      preferred_language: "ar",
    });

    render(<Profile />);

    await waitFor(() => {
      expect(screen.getByTestId("display-name-input")).toHaveValue("Ahmed");
    });
    expect(screen.getByTestId("phone-number-input")).toHaveValue("+966500000000");
    expect(screen.getByTestId("email-input")).toHaveValue("ahmed@example.com");
  });

  it("saves profile via PUT", async () => {
    mockedGet.mockResolvedValueOnce({ display_name: null, phone_number: null, email: null, preferred_language: null });
    mockedPut.mockResolvedValueOnce({ display_name: "Test User" });

    render(<Profile />);

    await waitFor(() => {
      expect(screen.getByTestId("display-name-input")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("display-name-input"), { target: { value: "Test User" } });
    fireEvent.click(screen.getByTestId("save-profile-button"));

    await waitFor(() => {
      expect(mockedPut).toHaveBeenCalledWith(
        "/customers/WS-1234567890/profile",
        expect.objectContaining({ display_name: "Test User" })
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("profile-saved")).toBeInTheDocument();
    });
  });

  it("shows error on save failure", async () => {
    mockedGet.mockResolvedValueOnce({ display_name: null, phone_number: null, email: null, preferred_language: null });
    mockedPut.mockRejectedValueOnce(new Error("save_failed"));

    render(<Profile />);

    await waitFor(() => {
      expect(screen.getByTestId("display-name-input")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("save-profile-button"));

    await waitFor(() => {
      expect(screen.getByTestId("profile-error")).toBeInTheDocument();
    });
  });

  it("allows changing preferred language", async () => {
    mockedGet.mockResolvedValueOnce({ display_name: null, phone_number: null, email: null, preferred_language: null });

    render(<Profile />);

    await waitFor(() => {
      expect(screen.getByTestId("preferred-language-select")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("preferred-language-select"), { target: { value: "en" } });

    expect(screen.getByTestId("preferred-language-select")).toHaveValue("en");
  });
});

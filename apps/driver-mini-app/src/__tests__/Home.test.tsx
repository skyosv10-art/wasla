import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { useSessionStore } from "../store/session";
import { useProfileStore } from "../store/profile";
import { Home } from "../screens/Home";
import { apiClient } from "../api/client";
import "../i18n";

vi.mock("../api/client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));

const get = vi.mocked(apiClient.get);
const put = vi.mocked(apiClient.put);

function profile(declared: "available" | "offline") {
  return {
    wasla_public_id: "drv-1", display_name: "x", preferred_locale: "ar", status: "active",
    verification_status: "verified", declared_availability: declared, work_city_zone_id: null,
    service_kinds: ["ride"], suspension_reason_code: null, eligibility_policy_version: 1,
    eligibility_recheck_at: null, last_published_state: null, last_published_at: null,
    created_at: "", updated_at: "",
  };
}

function eligibility(state: string, reason_codes: string[] = []) {
  return { wasla_public_id: "drv-1", eligibility_state: state, reason_codes, policy_version: 1, evaluated_at: "" };
}

function serve(declared: "available" | "offline", elig: unknown) {
  get.mockImplementation(async (path: string) => {
    if (path === "/drivers/drv-1") return profile(declared);
    if (path === "/drivers/drv-1/eligibility") {
      if (elig instanceof Error) throw elig;
      return elig;
    }
    throw new Error(`unexpected ${path}`);
  });
}

describe("Home screen", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useSessionStore.getState().setSession("tok", "drv-1", Date.now() + 3600_000);
    useProfileStore.setState({
      profile: null, eligibility: null, eligibilityError: null, eligibilityLoading: false,
      availabilityUpdating: false, availabilityError: null,
    });
    serve("available", eligibility("eligible"));
  });

  it("renders the app name", () => {
    render(<Home />);
    expect(screen.getByText("وَصْلة — السائق")).toBeDefined();
  });

  it("renders navigation items", () => {
    render(<Home />);
    expect(screen.getByText("المهام النشطة")).toBeDefined();
    expect(screen.getByText("أرباحي")).toBeDefined();
    expect(screen.getByText("مركباتي")).toBeDefined();
    expect(screen.getByText("مناطق عملي")).toBeDefined();
    expect(screen.getByText("وثائقي")).toBeDefined();
    expect(screen.getByText("حسابي")).toBeDefined();
  });

  it("renders links with correct hrefs", () => {
    render(<Home />);
    const earningsLink = screen.getByText("أرباحي").closest("a");
    expect(earningsLink?.getAttribute("href")).toBe("#/earnings");
    const vehiclesLink = screen.getByText("مركباتي").closest("a");
    expect(vehiclesLink?.getAttribute("href")).toBe("#/vehicles");
  });

  // ── G-S10 (CLM-0613) ────────────────────────────────────────────────────
  it("loads the profile and the eligibility verdict on mount", async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getByTestId("home-eligibility-state")).toHaveTextContent("مؤهل للعمل"));
    expect(get).toHaveBeenCalledWith("/drivers/drv-1");
    expect(get).toHaveBeenCalledWith("/drivers/drv-1/eligibility");
    expect(screen.getByTestId("home-availability-state")).toHaveTextContent("متاح لاستقبال العروض");
    expect(screen.queryByTestId("home-eligibility-documents")).toBeNull();
  });

  it("toggling while available declares offline and shows what the server returned", async () => {
    put.mockResolvedValueOnce(profile("offline"));
    render(<Home />);
    const toggle = await screen.findByRole("button", { name: "توقّف عن استقبال العروض" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(screen.getByTestId("home-availability-state")).toHaveTextContent("غير متصل — لا تصلك عروض"),
    );
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith("/drivers/drv-1/availability", { declared_availability: "offline" });
    expect(screen.getByTestId("home-availability-toggle")).toHaveAttribute("aria-pressed", "false");
  });

  it("toggling while offline declares available — never busy", async () => {
    serve("offline", eligibility("eligible"));
    put.mockResolvedValueOnce(profile("available"));
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: "ابدأ استقبال العروض" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![1]).toEqual({ declared_availability: "available" });
    expect(JSON.stringify(put.mock.calls)).not.toContain("busy");
  });

  it("a failed toggle shows an error and keeps the previous state", async () => {
    put.mockRejectedValueOnce(new Error("503"));
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: "توقّف عن استقبال العروض" }));
    expect(await screen.findByTestId("home-availability-error")).toHaveTextContent("تعذّر تحديث حالة التوفر");
    expect(screen.getByTestId("home-availability-state")).toHaveTextContent("متاح لاستقبال العروض");
  });

  it("does not send a second toggle while one is in flight", async () => {
    let release: (v: unknown) => void = () => undefined;
    put.mockReturnValueOnce(new Promise((r) => { release = r; }) as never);
    render(<Home />);
    const toggle = await screen.findByRole("button", { name: "توقّف عن استقبال العروض" });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeDisabled());
    fireEvent.click(toggle);
    expect(put).toHaveBeenCalledTimes(1);
    release(profile("offline"));
    await waitFor(() => expect(toggle).not.toBeDisabled());
  });

  it("an ineligible driver sees every reason, in order, and a link to Documents", async () => {
    serve("available", eligibility("ineligible", ["NO_PRIMARY_VEHICLE", "NO_SERVICE_ZONE", "DOCUMENT_MISSING"]));
    render(<Home />);
    const blocked = await screen.findByTestId("home-eligibility-blocked");
    expect(blocked).toHaveAttribute("role", "alert");
    expect(within(blocked).getByTestId("home-eligibility-state")).toHaveTextContent("غير مؤهل حاليًا");
    const reasons = within(blocked).getAllByRole("listitem").map((li) => li.getAttribute("data-reason"));
    expect(reasons).toEqual(["NO_PRIMARY_VEHICLE", "NO_SERVICE_ZONE", "DOCUMENT_MISSING"]);
    expect(within(blocked).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "لا توجد مركبة أساسية", "لم تُحدَّد منطقة عمل", "وثيقة مطلوبة غير مرفوعة",
    ]);
    expect(within(blocked).getByTestId("home-eligibility-documents")).toHaveAttribute("href", "#/documents");
  });

  it("a suspended driver gets the same blocked path", async () => {
    serve("offline", eligibility("suspended", ["PROFILE_SUSPENDED"]));
    render(<Home />);
    const blocked = await screen.findByTestId("home-eligibility-blocked");
    expect(within(blocked).getByTestId("home-eligibility-state")).toHaveTextContent("الحساب موقوف");
    expect(within(blocked).getAllByRole("listitem")).toHaveLength(1);
  });

  it("an undecided verdict (unknown) is shown as such, not as eligible or blocked", async () => {
    serve("available", eligibility("unknown"));
    render(<Home />);
    await waitFor(() => expect(screen.getByTestId("home-eligibility-state")).toHaveTextContent("لم تُحسم الأهلية بعد"));
    expect(screen.queryByTestId("home-eligibility-blocked")).toBeNull();
  });

  it("an eligibility fetch failure shows an error with a retry that refetches", async () => {
    serve("available", new Error("503"));
    render(<Home />);
    expect(await screen.findByTestId("home-eligibility-error")).toHaveTextContent("تعذّر جلب حالة الأهلية");
    serve("available", eligibility("eligible"));
    fireEvent.click(screen.getByTestId("home-eligibility-retry"));
    await waitFor(() => expect(screen.getByTestId("home-eligibility-state")).toHaveTextContent("مؤهل للعمل"));
    expect(get.mock.calls.filter(([p]) => p === "/drivers/drv-1/eligibility")).toHaveLength(2);
  });
});

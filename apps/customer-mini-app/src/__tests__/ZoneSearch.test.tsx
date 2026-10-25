// G-S9.3 (CLM-0647): zone text search — component behaviour and its wiring
// into the ride order form (source "text_search", zone_id from the result).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ZoneSearch, type ZoneSearchResult } from "../components/ZoneSearch";
import { RideOrder } from "../screens/RideOrder";
import { useOrderFormStore } from "../store/order-form";
import { useSessionStore } from "../store/session";
import { usePlacesStore } from "../store/places";
import i18n from "../i18n";

vi.mock("../api/client", () => ({
  apiClient: { post: vi.fn(), get: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

import { apiClient } from "../api/client";

const mockedGet = apiClient.get as ReturnType<typeof vi.fn>;
const mockedPost = apiClient.post as ReturnType<typeof vi.fn>;

const zone = (id: string, name: string): ZoneSearchResult => ({
  id,
  code: id.toUpperCase(),
  status: "active",
  name,
  path: {
    country: { id: "c", code: "SA", name: "السعودية" },
    region: { id: "r", code: "MD", name: "منطقة المدينة المنورة" },
    city: { id: "ci", code: "MED", name: "المدينة المنورة" },
    district: { id: "d", code: "QBA", name: "حي قباء" },
  },
});
const QBN = zone("zone-qbn", "قباء الشمالية");
const HRE = zone("zone-hre", "الحرة الشرقية");

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function type(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(`${testId}-input`), { target: { value } });
}

describe("ZoneSearch component", () => {
  beforeEach(async () => {
    useSessionStore.setState({ token: "t", customerId: "WS-1234567890", expiresAt: Date.now() + 3600000 });
    vi.clearAllMocks();
    await i18n.changeLanguage("ar");
  });

  it("calls the contract path with the trimmed, encoded query and the UI locale", async () => {
    mockedGet.mockResolvedValue([QBN]);
    render(<ZoneSearch id="z" label="بحث" testId="zs" onSelect={() => undefined} />);
    type("zs", "  قباء ");
    fireEvent.click(screen.getByTestId("zs-button"));
    await screen.findByTestId("zs-results");
    expect(mockedGet).toHaveBeenCalledWith(`/geo/zones/search?q=${encodeURIComponent("قباء")}&locale=ar`);
  });

  it("does not call the service for a query shorter than 2 characters", async () => {
    render(<ZoneSearch id="z" label="بحث" testId="zs" onSelect={() => undefined} />);
    type("zs", " ق ");
    fireEvent.click(screen.getByTestId("zs-button"));
    expect(await screen.findByTestId("zs-too-short")).toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("Enter runs the search; results show the zone with its district and city", async () => {
    mockedGet.mockResolvedValue([QBN]);
    render(<ZoneSearch id="z" label="بحث" testId="zs" onSelect={() => undefined} />);
    type("zs", "قباء");
    fireEvent.keyDown(screen.getByTestId("zs-input"), { key: "Enter" });
    const item = await screen.findByTestId("zs-result-zone-qbn");
    expect(item.textContent).toContain("قباء الشمالية");
    expect(item.textContent).toContain("حي قباء");
    expect(item.textContent).toContain("المدينة المنورة");
  });

  it("no match → an empty-state message (not an error)", async () => {
    mockedGet.mockResolvedValue([]);
    render(<ZoneSearch id="z" label="بحث" testId="zs" onSelect={() => undefined} />);
    type("zs", "zzzz");
    fireEvent.click(screen.getByTestId("zs-button"));
    expect(await screen.findByTestId("zs-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("zs-error")).toBeNull();
  });

  it("a failed request → an error message, no results", async () => {
    mockedGet.mockRejectedValue(new Error("network"));
    render(<ZoneSearch id="z" label="بحث" testId="zs" onSelect={() => undefined} />);
    type("zs", "قباء");
    fireEvent.click(screen.getByTestId("zs-button"));
    expect(await screen.findByTestId("zs-error")).toBeInTheDocument();
    expect(screen.queryByTestId("zs-results")).toBeNull();
  });

  it("choosing a result reports it and clears the search", async () => {
    mockedGet.mockResolvedValue([HRE, QBN]);
    const onSelect = vi.fn();
    render(<ZoneSearch id="z" label="بحث" testId="zs" onSelect={onSelect} />);
    type("zs", "ال");
    fireEvent.click(screen.getByTestId("zs-button"));
    fireEvent.click(await screen.findByTestId("zs-result-zone-qbn"));
    expect(onSelect).toHaveBeenCalledWith(QBN);
    expect(screen.queryByTestId("zs-results")).toBeNull();
    expect((screen.getByTestId("zs-input") as HTMLInputElement).value).toBe("");
  });

  it("a late response to an older search never replaces a newer one", async () => {
    const first = deferred<ZoneSearchResult[]>();
    mockedGet.mockImplementation((url: string) =>
      url.includes(encodeURIComponent("الحرة")) ? first.promise : Promise.resolve([QBN])
    );
    render(<ZoneSearch id="z" label="بحث" testId="zs" onSelect={() => undefined} />);
    type("zs", "الحرة");
    fireEvent.click(screen.getByTestId("zs-button"));
    type("zs", "قباء");
    fireEvent.keyDown(screen.getByTestId("zs-input"), { key: "Enter" });
    await screen.findByTestId("zs-result-zone-qbn");
    first.resolve([HRE]);
    await first.promise;
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("zs-result-zone-hre")).toBeNull();
    expect(screen.getByTestId("zs-result-zone-qbn")).toBeInTheDocument();
  });

  it("uses the UI language as locale (en)", async () => {
    await i18n.changeLanguage("en");
    mockedGet.mockResolvedValue([]);
    render(<ZoneSearch id="z" label="Search" testId="zs" onSelect={() => undefined} />);
    type("zs", "quba");
    fireEvent.click(screen.getByTestId("zs-button"));
    await screen.findByTestId("zs-empty");
    expect(mockedGet).toHaveBeenCalledWith("/geo/zones/search?q=quba&locale=en");
    await i18n.changeLanguage("ar");
  });
});

describe("RideOrder — zone text search wiring (G-S9.3)", () => {
  beforeEach(async () => {
    useOrderFormStore.getState().resetForm();
    usePlacesStore.setState({ places: [], status: "success", error: null });
    useSessionStore.setState({ token: "t", customerId: "WS-1234567890", expiresAt: Date.now() + 3600000 });
    vi.clearAllMocks();
    await i18n.changeLanguage("ar");
  });

  it("a chosen result fills zone_id and label and submits source text_search", async () => {
    mockedGet.mockImplementation((url: string) =>
      Promise.resolve(url.includes(encodeURIComponent("قباء")) ? [QBN] : [HRE])
    );
    mockedPost.mockResolvedValue({} as never);
    render(<RideOrder />);

    type("pickup-zone-search", "قباء");
    fireEvent.click(screen.getByTestId("pickup-zone-search-button"));
    fireEvent.click(await screen.findByTestId("pickup-zone-search-result-zone-qbn"));
    expect((screen.getByTestId("pickup-zone-input") as HTMLInputElement).value).toBe("zone-qbn");
    expect((screen.getByTestId("pickup-label-input") as HTMLInputElement).value).toBe("قباء الشمالية");

    type("dropoff-zone-search", "الحرة");
    fireEvent.click(screen.getByTestId("dropoff-zone-search-button"));
    fireEvent.click(await screen.findByTestId("dropoff-zone-search-result-zone-hre"));

    fireEvent.change(screen.getByTestId("price-mode-select"), { target: { value: "customer_offer" } });
    fireEvent.change(screen.getByTestId("offered-price-input"), { target: { value: "25" } });
    fireEvent.click(screen.getByTestId("submit-button"));
    await waitFor(() => expect(mockedPost).toHaveBeenCalled());

    const body = mockedPost.mock.calls[0][1] as {
      stops: Array<{ kind: string; zone_id: string; source: string; label: string | null }>;
    };
    expect(body.stops[0]).toMatchObject({ kind: "pickup", zone_id: "zone-qbn", source: "text_search", label: "قباء الشمالية" });
    expect(body.stops[1]).toMatchObject({ kind: "dropoff", zone_id: "zone-hre", source: "text_search", label: "الحرة الشرقية" });
  });

  it("editing the zone by hand after a search drops the search label and reverts to manual_zone", async () => {
    mockedGet.mockResolvedValue([QBN]);
    mockedPost.mockResolvedValue({} as never);
    render(<RideOrder />);

    type("pickup-zone-search", "قباء");
    fireEvent.click(screen.getByTestId("pickup-zone-search-button"));
    fireEvent.click(await screen.findByTestId("pickup-zone-search-result-zone-qbn"));
    fireEvent.change(screen.getByTestId("pickup-zone-input"), { target: { value: "zone-typed" } });
    expect((screen.getByTestId("pickup-label-input") as HTMLInputElement).value).toBe("");
    expect(useOrderFormStore.getState().pickupSource).toBe("manual_zone");
    expect(useOrderFormStore.getState().pickupZoneId).toBe("zone-typed");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MyOrders, STATUS_POLL_INTERVAL_MS } from "../screens/MyOrders";
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

import { apiClient, ApiError } from "../api/client";

const mockedGet = apiClient.get as ReturnType<typeof vi.fn>;

describe("MyOrders screen", () => {
  beforeEach(() => {
    useSessionStore.setState({ token: "test-token", customerId: "WS-1234567890", expiresAt: Date.now() + 3600000 });
    vi.clearAllMocks();
  });

  it("loads orders on mount", async () => {
    mockedGet.mockResolvedValueOnce({ items: [], limit: 20 });

    render(<MyOrders />);

    await waitFor(() => {
      // G-S9.10 (CLM-0616): CMS §3.6 L90 `?limit=5`. (Was the bare path — no limit.)
      expect(mockedGet).toHaveBeenCalledWith("/customers/WS-1234567890/order-requests?limit=5");
    });
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it("renders orders list", async () => {
    mockedGet.mockResolvedValueOnce({
      items: [
        { id: "req-1", order_type: "ride", status: "submitted", vehicle_class: "sedan", created_at: "2026-09-22T00:00:00Z" },
        { id: "req-2", order_type: "delivery", status: "completed", vehicle_class: "van", created_at: "2026-09-21T00:00:00Z" },
      ],
      limit: 20,
    });

    render(<MyOrders />);

    await waitFor(() => {
      expect(screen.getByTestId("orders-list")).toBeInTheDocument();
    });
    expect(screen.getByTestId("order-req-1")).toBeInTheDocument();
    expect(screen.getByTestId("order-req-2")).toBeInTheDocument();
  });

  it("shows empty state when no orders", async () => {
    mockedGet.mockResolvedValueOnce({ items: [], limit: 20 });

    render(<MyOrders />);

    await waitFor(() => {
      expect(screen.getByTestId("orders-empty")).toBeInTheDocument();
    });
  });

  it("filters orders by status", async () => {
    mockedGet.mockResolvedValueOnce({ items: [], limit: 20 });
    mockedGet.mockResolvedValueOnce({ items: [], limit: 20 });

    render(<MyOrders />);

    await waitFor(() => {
      expect(screen.getByTestId("status-filter-select")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("status-filter-select"), { target: { value: "submitted" } });

    await waitFor(() => {
      // G-S9.10 (CLM-0616): the filter is kept and `limit=5` rides along.
      // (Was `?status=submitted` — no limit.)
      expect(mockedGet).toHaveBeenCalledWith(
        "/customers/WS-1234567890/order-requests?status=submitted&limit=5",
      );
    });
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect((screen.getByTestId("status-filter-select") as HTMLSelectElement).value).toBe("submitted");
  });

  it("sends limit=5 on every load: mount, filter change and filter reset (G-S9.10)", async () => {
    mockedGet.mockResolvedValue({ items: [] });

    render(<MyOrders />);
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByTestId("status-filter-select"), { target: { value: "submitted" } });
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByTestId("status-filter-select"), { target: { value: "" } });
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(3));

    const calls = mockedGet.mock.calls.map(([url]) => new URL(url as string, "http://x"));
    for (const url of calls) {
      expect(url.pathname).toBe("/customers/WS-1234567890/order-requests");
      expect(url.searchParams.getAll("limit")).toEqual(["5"]);
    }
    expect(calls.map((url) => url.searchParams.get("status"))).toEqual([null, "submitted", null]);
    expect((screen.getByTestId("status-filter-select") as HTMLSelectElement).value).toBe("");
  });

  it("shows error on failure", async () => {
    mockedGet.mockRejectedValueOnce(new Error("load_failed"));

    render(<MyOrders />);

    await waitFor(() => {
      expect(screen.getByTestId("orders-error")).toBeInTheDocument();
    });
  });

  // G-S9.11 (CLM-0638): CMS §3.6 L87 — click a request → «تفاصيل الحالة والمسار».
  it("opens the detail view with status and route when an order is clicked", async () => {
    mockedGet.mockResolvedValueOnce({
      items: [
        { id: "req-1", order_type: "ride", status: "submitted", vehicle_class: "sedan", created_at: "2026-09-22T00:00:00Z" },
      ],
      limit: 5,
    });
    mockedGet.mockResolvedValueOnce({
      id: "req-1",
      wasla_public_id: "WS-1234567890",
      status: "submitted",
      order_type: "ride",
      vehicle_class: "sedan",
      price_mode: "fixed",
      offered_price: { amount: 25.5, currency: "SAR" },
      created_at: "2026-09-22T00:00:00Z",
      stops: [
        { kind: "pickup", sequence: 1, zone_id: "zone-a", zone_path: "المدينة المنورة / العزيزية", label: "المنزل" },
        { kind: "dropoff", sequence: 2, zone_id: "zone-b", zone_path: "المدينة المنورة / الحرم", label: null },
      ],
    });

    render(<MyOrders />);

    await waitFor(() => {
      expect(screen.getByTestId("order-req-1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("order-detail-open-req-1"));

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith("/customers/WS-1234567890/order-requests/req-1");
    });
    await waitFor(() => {
      expect(screen.getByTestId("order-detail")).toBeInTheDocument();
    });
    expect(screen.getByTestId("order-detail-req-1")).toBeInTheDocument();
    expect(screen.getByTestId("order-detail-status").textContent).toContain(
      "مُرسل",
    );
    expect(screen.getByTestId("order-detail-price").textContent).toContain("25.5");
    expect(screen.getByTestId("order-detail-stops")).toBeInTheDocument();
    expect(screen.getByTestId("order-detail-stop-1").textContent).toContain("الالتقاط");
    expect(screen.getByTestId("order-detail-stop-2").textContent).toContain("التسليم");
  });

  it("returns to the list from the detail view", async () => {
    mockedGet.mockResolvedValueOnce({
      items: [
        { id: "req-1", order_type: "ride", status: "submitted", vehicle_class: "sedan", created_at: "2026-09-22T00:00:00Z" },
      ],
      limit: 5,
    });
    mockedGet.mockResolvedValueOnce({
      id: "req-1",
      wasla_public_id: "WS-1234567890",
      status: "submitted",
      order_type: "ride",
      vehicle_class: "sedan",
      price_mode: "fixed",
      offered_price: null,
      created_at: "2026-09-22T00:00:00Z",
      stops: [
        { kind: "pickup", sequence: 1, zone_id: "zone-a", zone_path: null, label: null },
        { kind: "dropoff", sequence: 2, zone_id: "zone-b", zone_path: null, label: null },
      ],
    });

    render(<MyOrders />);

    await waitFor(() => {
      expect(screen.getByTestId("order-req-1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("order-detail-open-req-1"));
    await waitFor(() => {
      expect(screen.getByTestId("order-detail")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("order-detail-back"));

    await waitFor(() => {
      expect(screen.getByTestId("orders-list")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("order-detail")).toBeNull();
  });

  it("shows the not-found message when the detail request returns 404", async () => {
    mockedGet.mockResolvedValueOnce({
      items: [
        { id: "req-1", order_type: "ride", status: "submitted", vehicle_class: "sedan", created_at: "2026-09-22T00:00:00Z" },
      ],
      limit: 5,
    });
    mockedGet.mockRejectedValueOnce(new ApiError(404, "طلب العميل غير موجود"));

    render(<MyOrders />);

    await waitFor(() => {
      expect(screen.getByTestId("order-req-1")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("order-detail-open-req-1"));

    await waitFor(() => {
      expect(screen.getByTestId("order-detail-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("order-detail-error").textContent).toContain(
      "الطلب غير موجود",
    );
  });

  // G-S9.12 (CLM-0640): CMS §3.6 L88 — live status via polling.
  it("polls the list every STATUS_POLL_INTERVAL_MS while the screen is open", async () => {
    vi.useFakeTimers();
    try {
      mockedGet.mockResolvedValue({ items: [], limit: 5 });
      render(<MyOrders />);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockedGet).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(STATUS_POLL_INTERVAL_MS);
      expect(mockedGet).toHaveBeenCalledTimes(2);
      expect(mockedGet).toHaveBeenLastCalledWith("/customers/WS-1234567890/order-requests?limit=5");

      await vi.advanceTimersByTimeAsync(STATUS_POLL_INTERVAL_MS);
      expect(mockedGet).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not poll while the tab is hidden", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    try {
      mockedGet.mockResolvedValue({ items: [], limit: 5 });
      render(<MyOrders />);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockedGet).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(STATUS_POLL_INTERVAL_MS * 2);
      expect(mockedGet).toHaveBeenCalledTimes(1); // لا نداءَ في الخلفيةِ
    } finally {
      visibility.mockRestore();
      vi.useRealTimers();
    }
  });

  it("refreshes the open detail view periodically", async () => {
    vi.useFakeTimers();
    try {
      mockedGet.mockResolvedValueOnce({
        items: [
          { id: "req-1", order_type: "ride", status: "submitted", vehicle_class: "sedan", created_at: "2026-09-22T00:00:00Z" },
        ],
        limit: 5,
      });
      mockedGet.mockResolvedValueOnce({
        id: "req-1",
        wasla_public_id: "WS-1234567890",
        status: "submitted",
        order_type: "ride",
        vehicle_class: "sedan",
        price_mode: "fixed",
        created_at: "2026-09-22T00:00:00Z",
        stops: [
          { kind: "pickup", sequence: 1, zone_id: "zone-a" },
          { kind: "dropoff", sequence: 2, zone_id: "zone-b" },
        ],
      });
      render(<MyOrders />);
      await vi.advanceTimersByTimeAsync(0);
      fireEvent.click(screen.getByTestId("order-detail-open-req-1"));
      await vi.advanceTimersByTimeAsync(0);
      expect(mockedGet).toHaveBeenCalledTimes(2);

      // نداءا الدورةِ: القائمةُ (نداءٌ 3) ثمّ التفاصيلُ المفتوحةُ (نداءٌ 4) بحالةٍ محدَّثةٍ.
      mockedGet.mockResolvedValueOnce({
        items: [
          { id: "req-1", order_type: "ride", status: "accepted", vehicle_class: "sedan", created_at: "2026-09-22T00:00:00Z" },
        ],
        limit: 5,
      });
      mockedGet.mockResolvedValueOnce({
        id: "req-1",
        wasla_public_id: "WS-1234567890",
        status: "accepted",
        order_type: "ride",
        vehicle_class: "sedan",
        price_mode: "fixed",
        created_at: "2026-09-22T00:00:00Z",
        stops: [
          { kind: "pickup", sequence: 1, zone_id: "zone-a" },
          { kind: "dropoff", sequence: 2, zone_id: "zone-b" },
        ],
      });
      await vi.advanceTimersByTimeAsync(STATUS_POLL_INTERVAL_MS);
      // نداءانِ في الدورةِ: القائمةُ + التفاصيلُ المفتوحةُ.
      expect(mockedGet).toHaveBeenCalledTimes(4);
      expect(mockedGet).toHaveBeenNthCalledWith(3, "/customers/WS-1234567890/order-requests?limit=5");
      expect(mockedGet).toHaveBeenNthCalledWith(4, "/customers/WS-1234567890/order-requests/req-1");
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByTestId("order-detail-status").textContent).toContain("مقبول");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the previous list when a poll fails (silent refresh)", async () => {
    vi.useFakeTimers();
    try {
      mockedGet.mockResolvedValueOnce({
        items: [
          { id: "req-1", order_type: "ride", status: "submitted", vehicle_class: "sedan", created_at: "2026-09-22T00:00:00Z" },
        ],
        limit: 5,
      });
      render(<MyOrders />);
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByTestId("order-req-1")).toBeInTheDocument();

      mockedGet.mockRejectedValueOnce(new ApiError(500, "تعذر الاتصال"));
      await vi.advanceTimersByTimeAsync(STATUS_POLL_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(0);
      // القائمةُ السابقةُ باقيةٌ ولا خطأَ ظاهرًا.
      expect(screen.getByTestId("order-req-1")).toBeInTheDocument();
      expect(screen.queryByTestId("orders-error")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// CLM-0643 (review follow-up): a detail response — initial open or periodic
// refresh — may only reach the UI if its order is still the one selected.
describe("MyOrders detail — stale responses", () => {
  const LIST = "/customers/WS-1234567890/order-requests?limit=5";
  const DETAIL = (id: string) => `/customers/WS-1234567890/order-requests/${id}`;
  const listBody = {
    items: [
      { id: "req-a", order_type: "ride", status: "submitted", vehicle_class: "sedan", created_at: "2026-09-22T00:00:00Z" },
      { id: "req-b", order_type: "ride", status: "submitted", vehicle_class: "sedan", created_at: "2026-09-21T00:00:00Z" },
    ],
    limit: 5,
  };
  const detailBody = (id: string, status = "submitted") => ({
    id,
    wasla_public_id: "WS-1234567890",
    status,
    order_type: "ride",
    vehicle_class: "sedan",
    price_mode: "fixed",
    created_at: "2026-09-22T00:00:00Z",
    stops: [
      { kind: "pickup", sequence: 1, zone_id: `${id}-from` },
      { kind: "dropoff", sequence: 2, zone_id: `${id}-to` },
    ],
  });
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  beforeEach(() => {
    useSessionStore.setState({ token: "test-token", customerId: "WS-1234567890", expiresAt: Date.now() + 3600000 });
    vi.clearAllMocks();
  });

  it("A→B: a late response for A does not replace B's details", async () => {
    const a = deferred<unknown>();
    mockedGet.mockImplementation((url: string) => {
      if (url === LIST) return Promise.resolve(listBody);
      if (url === DETAIL("req-a")) return a.promise;
      if (url === DETAIL("req-b")) return Promise.resolve(detailBody("req-b"));
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<MyOrders />);
    await waitFor(() => expect(screen.getByTestId("order-req-a")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("order-detail-open-req-a"));
    fireEvent.click(screen.getByTestId("order-detail-back"));
    fireEvent.click(screen.getByTestId("order-detail-open-req-b"));
    await waitFor(() => expect(screen.getByTestId("order-detail-req-b")).toBeInTheDocument());

    a.resolve(detailBody("req-a", "accepted"));
    await a.promise;
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("order-detail-req-a")).toBeNull();
    expect(screen.getByTestId("order-detail-req-b")).toBeInTheDocument();
  });

  it("A→B with B still loading: A's late response neither shows A nor ends B's loading", async () => {
    const a = deferred<unknown>();
    const b = deferred<unknown>();
    mockedGet.mockImplementation((url: string) => {
      if (url === LIST) return Promise.resolve(listBody);
      if (url === DETAIL("req-a")) return a.promise;
      if (url === DETAIL("req-b")) return b.promise;
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<MyOrders />);
    await waitFor(() => expect(screen.getByTestId("order-req-a")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("order-detail-open-req-a"));
    fireEvent.click(screen.getByTestId("order-detail-back"));
    fireEvent.click(screen.getByTestId("order-detail-open-req-b"));

    a.resolve(detailBody("req-a"));
    await a.promise;
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("order-detail-req-a")).toBeNull();
    expect(screen.getByTestId("order-detail-loading")).toBeInTheDocument();

    b.resolve(detailBody("req-b"));
    await waitFor(() => expect(screen.getByTestId("order-detail-req-b")).toBeInTheDocument());
  });

  it("A→B: a late 404 for A does not put an error on B", async () => {
    const a = deferred<unknown>();
    mockedGet.mockImplementation((url: string) => {
      if (url === LIST) return Promise.resolve(listBody);
      if (url === DETAIL("req-a")) return a.promise;
      if (url === DETAIL("req-b")) return Promise.resolve(detailBody("req-b"));
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<MyOrders />);
    await waitFor(() => expect(screen.getByTestId("order-req-a")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("order-detail-open-req-a"));
    fireEvent.click(screen.getByTestId("order-detail-back"));
    fireEvent.click(screen.getByTestId("order-detail-open-req-b"));
    await waitFor(() => expect(screen.getByTestId("order-detail-req-b")).toBeInTheDocument());

    a.reject(new ApiError(404, "طلب العميل غير موجود"));
    await a.promise.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("order-detail-error")).toBeNull();
    expect(screen.getByTestId("order-detail-req-b")).toBeInTheDocument();
  });

  it("closing before the response arrives: the late response neither reopens the view nor answers a later open", async () => {
    const a1 = deferred<unknown>();
    const a2 = deferred<unknown>();
    let calls = 0;
    mockedGet.mockImplementation((url: string) => {
      if (url === LIST) return Promise.resolve(listBody);
      if (url === DETAIL("req-a")) { calls += 1; return calls === 1 ? a1.promise : a2.promise; }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<MyOrders />);
    await waitFor(() => expect(screen.getByTestId("order-req-a")).toBeInTheDocument());

    // open A → close → re-open A while the first request is still in flight.
    fireEvent.click(screen.getByTestId("order-detail-open-req-a"));
    fireEvent.click(screen.getByTestId("order-detail-back"));
    expect(screen.queryByTestId("order-detail")).toBeNull();
    fireEvent.click(screen.getByTestId("order-detail-open-req-a"));

    // The closed request answers late: it belongs to a selection that no longer exists.
    a1.resolve(detailBody("req-a", "cancelled"));
    await a1.promise;
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("order-detail-req-a")).toBeNull();
    expect(screen.getByTestId("order-detail-loading")).toBeInTheDocument();

    a2.resolve(detailBody("req-a", "accepted"));
    await waitFor(() => expect(screen.getByTestId("order-detail-status").textContent).toContain("مقبول"));
  });

  it("closing before the response arrives: the list stays and no detail view appears", async () => {
    const a = deferred<unknown>();
    mockedGet.mockImplementation((url: string) => {
      if (url === LIST) return Promise.resolve(listBody);
      if (url === DETAIL("req-a")) return a.promise;
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<MyOrders />);
    await waitFor(() => expect(screen.getByTestId("order-req-a")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("order-detail-open-req-a"));
    fireEvent.click(screen.getByTestId("order-detail-back"));
    a.resolve(detailBody("req-a"));
    await a.promise;
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("order-detail")).toBeNull();
    expect(screen.getByTestId("orders-list")).toBeInTheDocument();
  });

  it("a periodic refresh for A that lands after switching to B does not replace B", async () => {
    vi.useFakeTimers();
    try {
      const poll = deferred<unknown>();
      let aCalls = 0;
      mockedGet.mockImplementation((url: string) => {
        if (url === LIST) return Promise.resolve(listBody);
        if (url === DETAIL("req-a")) { aCalls += 1; return aCalls === 1 ? Promise.resolve(detailBody("req-a")) : poll.promise; }
        if (url === DETAIL("req-b")) return Promise.resolve(detailBody("req-b"));
        return Promise.reject(new Error(`unexpected ${url}`));
      });
      render(<MyOrders />);
      await vi.advanceTimersByTimeAsync(0);
      fireEvent.click(screen.getByTestId("order-detail-open-req-a"));
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByTestId("order-detail-req-a")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(STATUS_POLL_INTERVAL_MS); // poll for A in flight
      expect(aCalls).toBe(2);
      fireEvent.click(screen.getByTestId("order-detail-back"));
      fireEvent.click(screen.getByTestId("order-detail-open-req-b"));
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByTestId("order-detail-req-b")).toBeInTheDocument();

      poll.resolve(detailBody("req-a", "accepted"));
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.queryByTestId("order-detail-req-a")).toBeNull();
      expect(screen.getByTestId("order-detail-req-b")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

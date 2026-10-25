/**
 * G-S8 (CLM-0610): direct tests for `session-init.ts` — init outcomes, expiry
 * and 401 re-init, the loop budget, single-flight, manual retry, and logout.
 * `fetch` and `Telegram.WebApp` are stubbed; time is faked (no real waiting).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSessionStore } from "../store/session";
import {
  initSessionFromTelegram,
  retrySession,
  startSessionLifecycle,
  logoutSession,
} from "../session/session-init";

const T0 = new Date("2026-10-18T06:00:00.000Z").getTime();

function sessionResponse(token: string, expiresInMs: number): Response {
  return new Response(
    JSON.stringify({
      token,
      wasla_public_id: "WS-1234567890",
      expires_at: new Date(Date.now() + expiresInMs).toISOString(),
      session_id: `s-${token}`,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function setTelegram(initData: string | null) {
  const w = window as unknown as { Telegram?: unknown };
  if (initData === null) delete w.Telegram;
  else w.Telegram = { WebApp: { initData, ready: vi.fn() } };
}

let fetchMock: ReturnType<typeof vi.fn>;
let stop: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  useSessionStore.setState({
    token: null, customerId: null, expiresAt: null, initStatus: "idle", initError: null,
  } as never);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  setTelegram("query_id=1&user=%7B%7D&hash=abc");
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setTelegram(null);
});

describe("initSessionFromTelegram", () => {
  it("outside Telegram fails as not_in_telegram without any network call", async () => {
    setTelegram(null);
    await expect(initSessionFromTelegram()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useSessionStore.getState().initStatus).toBe("failed");
    expect(useSessionStore.getState().initError).toBe("not_in_telegram");
  });

  it("posts init_data to /edge/session and stores the session in memory as ready", async () => {
    fetchMock.mockResolvedValueOnce(sessionResponse("tok-1", 3_600_000));
    await expect(initSessionFromTelegram()).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/edge\/session$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ init_data: "query_id=1&user=%7B%7D&hash=abc" });
    const s = useSessionStore.getState();
    expect(s.token).toBe("tok-1");
    expect(s.customerId).toBe("WS-1234567890");
    expect(s.expiresAt).toBe(T0 + 3_600_000);
    expect(s.initStatus).toBe("ready");
    expect(s.isAuthenticated()).toBe(true);
  });

  it("an edge rejection fails as edge_rejected and stores no session", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "INIT_DATA_INVALID", message: "x" }), { status: 401 }),
    );
    await expect(initSessionFromTelegram()).resolves.toBe(false);
    expect(useSessionStore.getState().token).toBeNull();
    expect(useSessionStore.getState().initError).toBe("edge_rejected");
  });

  it("a network error fails as network instead of rejecting", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(initSessionFromTelegram()).resolves.toBe(false);
    expect(useSessionStore.getState().initStatus).toBe("failed");
    expect(useSessionStore.getState().initError).toBe("network");
  });

  it("an unparseable expires_at fails as invalid_response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "t", wasla_public_id: "WS-1", expires_at: "nope", session_id: "s" }), { status: 200 }),
    );
    await expect(initSessionFromTelegram()).resolves.toBe(false);
    expect(useSessionStore.getState().token).toBeNull();
    expect(useSessionStore.getState().initError).toBe("invalid_response");
  });

  it("concurrent calls share a single request", async () => {
    fetchMock.mockResolvedValueOnce(sessionResponse("tok-1", 3_600_000));
    const [a, b] = await Promise.all([initSessionFromTelegram(), initSessionFromTelegram()]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("startSessionLifecycle", () => {
  it("re-initializes automatically when the session expires", async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse("tok-1", 60_000))
      .mockResolvedValueOnce(sessionResponse("tok-2", 3_600_000));
    stop = startSessionLifecycle();
    await vi.waitFor(() => expect(useSessionStore.getState().token).toBe("tok-1"));
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(useSessionStore.getState().token).toBe("tok-2"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useSessionStore.getState().initStatus).toBe("ready");
  });

  it("re-initializes once when a 401 clears the session", async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse("tok-1", 3_600_000))
      .mockResolvedValueOnce(sessionResponse("tok-2", 3_600_000));
    stop = startSessionLifecycle();
    await vi.waitFor(() => expect(useSessionStore.getState().token).toBe("tok-1"));
    useSessionStore.getState().clearSession(); // what api/client does on 401
    await vi.waitFor(() => expect(useSessionStore.getState().token).toBe("tok-2"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops re-initializing after the budget and fails as retry_limit (no loop)", async () => {
    fetchMock.mockImplementation(async () => sessionResponse(`tok-${fetchMock.mock.calls.length}`, 3_600_000));
    stop = startSessionLifecycle({ maxAutoReinit: 3, windowMs: 300_000 });
    await vi.waitFor(() => expect(useSessionStore.getState().initStatus).toBe("ready"));
    for (let i = 0; i < 6; i++) {
      useSessionStore.getState().clearSession();
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1 + 3);
    expect(useSessionStore.getState().initStatus).toBe("failed");
    expect(useSessionStore.getState().initError).toBe("retry_limit");
    expect(useSessionStore.getState().token).toBeNull();
  });

  it("does not retry on its own after a failed init", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));
    stop = startSessionLifecycle();
    await vi.waitFor(() => expect(useSessionStore.getState().initStatus).toBe("failed"));
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a manual retry after failure starts a new session", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(sessionResponse("tok-ok", 3_600_000));
    stop = startSessionLifecycle();
    await vi.waitFor(() => expect(useSessionStore.getState().initStatus).toBe("failed"));
    await expect(retrySession()).resolves.toBe(true);
    expect(useSessionStore.getState().token).toBe("tok-ok");
    expect(useSessionStore.getState().initStatus).toBe("ready");
  });

  it("logout clears the session without re-initializing", async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse("tok-1", 3_600_000))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    stop = startSessionLifecycle();
    await vi.waitFor(() => expect(useSessionStore.getState().token).toBe("tok-1"));
    await logoutSession();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(useSessionStore.getState().token).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toMatch(/\/edge\/session\/logout$/);
  });
});

// ADR-047: API client using fetch (reuses ADR-044/045 pattern).
// Adds Authorization: Bearer to every request.
// Handles 401 by triggering session re-initialization.

import { useSessionStore } from "../store/session";

const DEFAULT_TIMEOUT_MS = 10_000;

interface ApiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const { token } = useSessionStore.getState();
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 401) {
        useSessionStore.getState().clearSession();
        throw new ApiError(401, "Session expired");
      }

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message = (body as { message?: string }).message ?? `Error ${response.status}`;
        throw new ApiError(response.status, message);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return response.json() as Promise<T>;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof ApiError) throw err;
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ApiError(408, "Request timeout");
      }
      throw err;
    }
  }

  return {
    get: <T>(path: string) => request<T>(path, { method: "GET" }),
    post: <T>(path: string, body?: unknown, extraHeaders?: Record<string, string>) =>
      request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined, headers: extraHeaders }),
    put: <T>(path: string, body?: unknown, extraHeaders?: Record<string, string>) =>
      request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined, headers: extraHeaders }),
    patch: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
    del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  };
}

export const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? "",
});
export { ApiError };

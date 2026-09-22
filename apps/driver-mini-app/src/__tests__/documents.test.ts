import { describe, it, expect, vi, beforeEach } from "vitest";
import { useDocumentsStore } from "../store/documents";
import { useSessionStore } from "../store/session";
import { apiClient } from "../api/client";

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

const mockApi = vi.mocked(apiClient);

describe("Documents store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDocumentsStore.setState({
      documents: [],
      loading: false,
      error: null,
      actionLoading: false,
      actionError: null,
      fetchDocuments: useDocumentsStore.getState().fetchDocuments,
      submitDocument: useDocumentsStore.getState().submitDocument,
      clearErrors: useDocumentsStore.getState().clearErrors,
    });
    useSessionStore.getState().setSession("token-123", "drv-123", Date.now() + 3_600_000);
  });

  it("fetchDocuments populates documents on success", async () => {
    const mockDocs = [
      { id: "doc-1", document_type: "national_id", status: "verified", vehicle_id: null, storage_ref: "ref-1", issued_at: null, expires_at: null, reviewed_at: null, reviewed_by: "admin", rejection_reason_code: null, created_at: "", updated_at: "" },
    ];
    mockApi.get.mockResolvedValue({ documents: mockDocs });
    await useDocumentsStore.getState().fetchDocuments();
    expect(useDocumentsStore.getState().documents).toEqual(mockDocs);
    expect(useDocumentsStore.getState().loading).toBe(false);
  });

  it("fetchDocuments sets error on failure", async () => {
    mockApi.get.mockRejectedValue(new Error("Network error"));
    await useDocumentsStore.getState().fetchDocuments();
    expect(useDocumentsStore.getState().error).toBe("fetch_documents_failed");
    expect(useDocumentsStore.getState().loading).toBe(false);
  });

  it("submitDocument sends POST with Idempotency-Key", async () => {
    const mockDoc = { id: "doc-new", document_type: "driving_license" as const, status: "pending" as const, vehicle_id: null, storage_ref: "ref-2", issued_at: null, expires_at: null, reviewed_at: null, reviewed_by: null, rejection_reason_code: null, created_at: "", updated_at: "" };
    mockApi.post.mockResolvedValue(mockDoc);
    const result = await useDocumentsStore.getState().submitDocument({ document_type: "driving_license", storage_ref: "ref-2" });
    expect(result).toBe(true);
    expect(mockApi.post).toHaveBeenCalledWith(
      "/drivers/drv-123/documents",
      { document_type: "driving_license", storage_ref: "ref-2" },
      expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
    );
    expect(useDocumentsStore.getState().documents).toContain(mockDoc);
  });

  it("submitDocument sets actionError on failure", async () => {
    mockApi.post.mockRejectedValue(new Error("Validation failed"));
    const result = await useDocumentsStore.getState().submitDocument({ document_type: "national_id", storage_ref: "ref-3" });
    expect(result).toBe(false);
    expect(useDocumentsStore.getState().actionError).toBe("submit_document_failed");
  });

  it("clearErrors resets error states", () => {
    useDocumentsStore.setState({ error: "some error", actionError: "action error" });
    useDocumentsStore.getState().clearErrors();
    expect(useDocumentsStore.getState().error).toBeNull();
    expect(useDocumentsStore.getState().actionError).toBeNull();
  });

  it("submitDocument returns false when no driverId", async () => {
    useSessionStore.getState().clearSession();
    const result = await useDocumentsStore.getState().submitDocument({ document_type: "national_id", storage_ref: "ref-4" });
    expect(result).toBe(false);
  });
});

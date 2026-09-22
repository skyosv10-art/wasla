import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Documents } from "../screens/Documents";
import { useDocumentsStore } from "../store/documents";
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

const mockDocument = {
  id: "doc-1",
  document_type: "national_id" as const,
  status: "verified" as const,
  vehicle_id: null,
  storage_ref: "ref-1",
  issued_at: "2024-01-01",
  expires_at: "2025-01-01",
  reviewed_at: "2024-01-05",
  reviewed_by: "admin",
  rejection_reason_code: null,
  created_at: "",
  updated_at: "",
};

const mockRejectedDoc = {
  ...mockDocument,
  id: "doc-2",
  document_type: "driving_license" as const,
  status: "rejected" as const,
  rejection_reason_code: "expired",
};

describe("Documents screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDocumentsStore.setState({
      documents: [],
      loading: false,
      error: null,
      actionLoading: false,
      actionError: null,
      fetchDocuments: vi.fn(),
      submitDocument: vi.fn(),
      clearErrors: vi.fn(),
    });
    useSessionStore.getState().setSession("token-123", "drv-123", Date.now() + 3_600_000);
  });

  it("renders loading state", () => {
    useDocumentsStore.setState({ loading: true });
    render(<Documents />);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("renders error state with retry", () => {
    useDocumentsStore.setState({
      error: "Network error",
      fetchDocuments: vi.fn(),
    });
    render(<Documents />);
    expect(screen.getByText("Network error")).toBeInTheDocument();
    expect(screen.getByText("common.retry")).toBeInTheDocument();
  });

  it("renders empty state when no documents", () => {
    render(<Documents />);
    expect(screen.getByText("common.empty")).toBeInTheDocument();
    expect(screen.getByTestId("add-document-btn")).toBeInTheDocument();
  });

  it("renders document cards", () => {
    useDocumentsStore.setState({ documents: [mockDocument, mockRejectedDoc] });
    render(<Documents />);
    expect(screen.getByTestId("document-doc-1")).toBeInTheDocument();
    expect(screen.getByTestId("document-doc-2")).toBeInTheDocument();
  });

  it("shows document status", () => {
    useDocumentsStore.setState({ documents: [mockDocument] });
    render(<Documents />);
    expect(screen.getByTestId("doc-status-doc-1")).toBeInTheDocument();
  });

  it("shows rejection reason for rejected documents", () => {
    useDocumentsStore.setState({ documents: [mockRejectedDoc] });
    render(<Documents />);
    expect(screen.getByTestId("doc-rejection-doc-2")).toBeInTheDocument();
  });

  it("shows add document form when button clicked", () => {
    render(<Documents />);
    fireEvent.click(screen.getByTestId("add-document-btn"));
    expect(screen.getByTestId("document-form")).toBeInTheDocument();
    expect(screen.getByTestId("form-document_type")).toBeInTheDocument();
    expect(screen.getByTestId("form-storage_ref")).toBeInTheDocument();
  });

  it("calls submitDocument on form submit", async () => {
    const submitDocument = vi.fn().mockResolvedValue(true);
    useDocumentsStore.setState({ submitDocument });
    render(<Documents />);
    fireEvent.click(screen.getByTestId("add-document-btn"));
    fireEvent.change(screen.getByTestId("form-storage_ref"), {
      target: { value: "ref-new" },
    });
    fireEvent.click(screen.getByTestId("submit-document"));
    await waitFor(() => {
      expect(submitDocument).toHaveBeenCalled();
    });
  });

  it("shows action error when present", () => {
    useDocumentsStore.setState({
      documents: [mockDocument],
      actionError: "Failed to submit",
    });
    render(<Documents />);
    expect(screen.getByTestId("action-error")).toBeInTheDocument();
  });

  it("disables submit button when storage_ref is empty", () => {
    render(<Documents />);
    fireEvent.click(screen.getByTestId("add-document-btn"));
    const submitBtn = screen.getByTestId("submit-document") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });
});

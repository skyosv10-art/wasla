import { create } from "zustand";
import { apiClient } from "../api/client";
import type { DriverDocument, DocumentSubmission } from "../types/documents";
import { useSessionStore } from "./session";

interface DocumentsState {
  documents: DriverDocument[];
  loading: boolean;
  error: string | null;
  actionLoading: boolean;
  actionError: string | null;
  fetchDocuments: () => Promise<void>;
  submitDocument: (submission: DocumentSubmission) => Promise<boolean>;
  clearErrors: () => void;
}

export const useDocumentsStore = create<DocumentsState>((set) => ({
  documents: [],
  loading: false,
  error: null,
  actionLoading: false,
  actionError: null,

  fetchDocuments: async () => {
    const { driverId } = useSessionStore.getState();
    if (!driverId) return;
    set({ loading: true, error: null });
    try {
      const result = await apiClient.get<{ documents: DriverDocument[] }>(
        `/drivers/${driverId}/documents`,
      );
      set({ documents: result.documents ?? [], loading: false });
    } catch {
      set({ error: "fetch_documents_failed", loading: false });
    }
  },

  submitDocument: async (submission: DocumentSubmission) => {
    const { driverId } = useSessionStore.getState();
    if (!driverId) return false;
    set({ actionLoading: true, actionError: null });
    try {
      const idempotencyKey = crypto.randomUUID();
      const document = await apiClient.post<DriverDocument>(
        `/drivers/${driverId}/documents`,
        submission,
        { "Idempotency-Key": idempotencyKey },
      );
      set((state) => ({
        documents: [...state.documents, document],
        actionLoading: false,
      }));
      return true;
    } catch {
      set({ actionError: "submit_document_failed", actionLoading: false });
      return false;
    }
  },

  clearErrors: () => set({ error: null, actionError: null }),
}));

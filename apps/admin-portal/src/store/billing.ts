/**
 * Billing store for admin portal.
 *
 * Manages billing invoice and settlement state and API calls to the billing service.
 * Uses the admin API client with Bearer token authentication.
 *
 * M5-17 review 6/N: Billing admin screen — list invoices (with store filter +
 * cursor pagination), list settlements (with state filter + cursor pagination),
 * view invoice details, issue, void, record payment.
 */

import { create } from "zustand";
import { apiClient } from "../api/client";
import type {
  BillingInvoiceResource,
  BillingSettlementResource,
  InvoiceListResponse,
  SettlementListResponse,
  BillingInvoiceState,
  BillingSettlementState,
  RecordPaymentRequest,
} from "../types/billing";

type InvoiceList = readonly BillingInvoiceResource[];
type SettlementList = readonly BillingSettlementResource[];

interface BillingState {
  invoices: InvoiceList;
  invoiceNextCursor: string | null;
  settlements: SettlementList;
  settlementNextCursor: string | null;
  selectedInvoice: BillingInvoiceResource | null;
  loading: boolean;
  error: string | null;
  invoiceStateFilter: BillingInvoiceState | null;
  settlementStateFilter: BillingSettlementState | null;

  fetchInvoices: (storePublicId?: string) => Promise<void>;
  fetchMoreInvoices: () => Promise<void>;
  fetchInvoice: (invoiceId: string) => Promise<void>;
  issueInvoice: (invoiceId: string) => Promise<void>;
  voidInvoice: (invoiceId: string) => Promise<void>;
  recordPayment: (invoiceId: string, request: RecordPaymentRequest) => Promise<void>;
  fetchSettlements: (state?: BillingSettlementState | null) => Promise<void>;
  fetchMoreSettlements: () => Promise<void>;
  setInvoiceStateFilter: (state: BillingInvoiceState | null) => void;
  setSettlementStateFilter: (state: BillingSettlementState | null) => void;
  clearSelected: () => void;
  clearError: () => void;
}

export const useBillingStore = create<BillingState>((set, get) => ({
  invoices: [],
  invoiceNextCursor: null,
  settlements: [],
  settlementNextCursor: null,
  selectedInvoice: null,
  loading: false,
  error: null,
  invoiceStateFilter: null,
  settlementStateFilter: null,

  fetchInvoices: async (storePublicId?: string) => {
    set({ loading: true, error: null });
    try {
      const params = storePublicId ? `?store_public_id=${encodeURIComponent(storePublicId)}` : "";
      const data = await apiClient.get<InvoiceListResponse>(`/billing/invoices${params}`);
      set({ invoices: data.items, invoiceNextCursor: data.next_cursor, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch invoices",
      });
    }
  },

  fetchMoreInvoices: async () => {
    const { invoiceNextCursor, invoices } = get();
    if (!invoiceNextCursor) return;
    set({ loading: true, error: null });
    try {
      const data = await apiClient.get<InvoiceListResponse>(
        `/billing/invoices?cursor=${encodeURIComponent(invoiceNextCursor)}`,
      );
      set({
        invoices: [...invoices, ...data.items] as InvoiceList,
        invoiceNextCursor: data.next_cursor,
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch more invoices",
      });
    }
  },

  fetchInvoice: async (invoiceId: string) => {
    set({ loading: true, error: null });
    try {
      const invoice = await apiClient.get<BillingInvoiceResource>(`/billing/invoices/${invoiceId}`);
      set({ selectedInvoice: invoice, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch invoice",
      });
    }
  },

  issueInvoice: async (invoiceId: string) => {
    set({ loading: true, error: null });
    try {
      const invoice = await apiClient.post<BillingInvoiceResource>(`/billing/invoices/${invoiceId}/issue`);
      set({ selectedInvoice: invoice, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to issue invoice",
      });
    }
  },

  voidInvoice: async (invoiceId: string) => {
    set({ loading: true, error: null });
    try {
      const invoice = await apiClient.post<BillingInvoiceResource>(`/billing/invoices/${invoiceId}/void`);
      set({ selectedInvoice: invoice, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to void invoice",
      });
    }
  },

  recordPayment: async (invoiceId: string, request: RecordPaymentRequest) => {
    set({ loading: true, error: null });
    try {
      const invoice = await apiClient.post<BillingInvoiceResource>(
        `/billing/invoices/${invoiceId}/payment`,
        request,
      );
      set({ selectedInvoice: invoice, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to record payment",
      });
    }
  },

  fetchSettlements: async (state?: BillingSettlementState | null) => {
    const filter = state ?? get().settlementStateFilter;
    set({ loading: true, error: null });
    try {
      const params = filter ? `?state=${filter}` : "";
      const data = await apiClient.get<SettlementListResponse>(`/billing/settlements${params}`);
      set({ settlements: data.items, settlementNextCursor: data.next_cursor, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch settlements",
      });
    }
  },

  fetchMoreSettlements: async () => {
    const { settlementNextCursor, settlements } = get();
    if (!settlementNextCursor) return;
    set({ loading: true, error: null });
    try {
      const data = await apiClient.get<SettlementListResponse>(
        `/billing/settlements?cursor=${encodeURIComponent(settlementNextCursor)}`,
      );
      set({
        settlements: [...settlements, ...data.items] as SettlementList,
        settlementNextCursor: data.next_cursor,
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch more settlements",
      });
    }
  },

  setInvoiceStateFilter: (state: BillingInvoiceState | null) => {
    set({ invoiceStateFilter: state });
  },

  setSettlementStateFilter: (state: BillingSettlementState | null) => {
    set({ settlementStateFilter: state });
  },

  clearSelected: () => {
    set({ selectedInvoice: null });
  },

  clearError: () => {
    set({ error: null });
  },
}));

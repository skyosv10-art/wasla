import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useSessionStore } from "./store/session";
import "./i18n";
import "./index.css";

// E2E test support — compile-time gated, tree-shaken in production.
// When VITE_E2E is not set, this entire block is removed by the bundler.
// Provides session seeding for Playwright tests without a production backdoor.
if (import.meta.env.VITE_E2E === "true") {
  // Seed session from page init script if provided (for authenticated tests)
  const e2eSession = (
    window as unknown as {
      __waslaE2ESession?: {
        token: string;
        customerId: string;
        expiresAt: number;
      };
    }
  ).__waslaE2ESession;
  if (e2eSession) {
    useSessionStore.getState().setSession(
      e2eSession.token,
      e2eSession.customerId,
      e2eSession.expiresAt
    );
  }
  // Expose runtime controls for E2E tests
  (
    window as unknown as { __waslaE2E?: unknown }
  ).__waslaE2E = {
    setSession: (token: string, customerId: string, expiresAt: number) =>
      useSessionStore.getState().setSession(token, customerId, expiresAt),
    clearSession: () => useSessionStore.getState().clearSession(),
  };
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);

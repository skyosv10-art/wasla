import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useSessionStore } from "./store/session";
import "./i18n";
import "./index.css";

// E2E test support — compile-time gated, tree-shaken in production.
// When VITE_E2E is not set, this entire block is removed by the bundler.
if (import.meta.env.VITE_E2E === "true") {
  const e2eSession = (
    window as unknown as {
      __waslaE2ESession?: {
        token: string;
        driverId: string;
        expiresAt: number;
      };
    }
  ).__waslaE2ESession;
  if (e2eSession) {
    useSessionStore.getState().setSession(
      e2eSession.token,
      e2eSession.driverId,
      e2eSession.expiresAt
    );
  }
  (
    window as unknown as { __waslaE2E?: unknown }
  ).__waslaE2E = {
    setSession: (token: string, driverId: string, expiresAt: number) =>
      useSessionStore.getState().setSession(token, driverId, expiresAt),
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

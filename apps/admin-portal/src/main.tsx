import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./i18n";
import "./styles.css";

// E2E test hook: set session from window.__waslaE2ESession
declare const window: { __waslaE2ESession?: { token: string; userId: string; role: string; expiresAt: number } };

if (import.meta.env.VITE_E2E === "true" && window.__waslaE2ESession) {
  const { useSessionStore } = await import("./store/session");
  useSessionStore.getState().setSession(
    window.__waslaE2ESession.token,
    window.__waslaE2ESession.userId,
    window.__waslaE2ESession.role,
    window.__waslaE2ESession.expiresAt,
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

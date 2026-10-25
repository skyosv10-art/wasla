import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useSessionStore } from "./store/session";
import { startSessionLifecycle } from "./session/session-init";
import "./i18n";
import "./index.css";

// ADR-069 · CLM-0524 (المرحلة 2 الجزء 2): تهيئةُ الجلسةِ من `Telegram.WebApp.initData`
// في زمنِ التشغيلِ لا خلفَ خطافِ E2E وحدهُ — الشاشةُ «جارٍ التحميل» لم تعد نهائيةً
// في الإنتاجِ. لا تُخزَّنُ الجلسةُ في أيِّ تخزينٍ محليٍّ (ADR-045 §4).
// G-S8 (CLM-0610): تهيئةٌ أولى + إعادةٌ محدودةٌ عندَ الانتهاءِ/401.
startSessionLifecycle();

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

// Simple hash-based navigation helper (ADR-045 Decision 2).
// No router framework — Telegram WebView doesn't support history API reliably.

export function navigate(route: string): void {
  window.location.hash = `/${route}`;
}

import { useEffect, useState } from "react";

// M3-06: network status from the browser (navigator.onLine + online/offline events).
// Kept per-app (ADR-045 defers a shared UI package) — no production backdoor.

export interface NetworkStatus {
  online: boolean;
}

export function useNetworkStatus(): NetworkStatus {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return { online };
}

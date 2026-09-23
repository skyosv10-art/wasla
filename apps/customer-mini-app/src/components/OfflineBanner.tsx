import { useTranslation } from "react-i18next";
import { useNetworkStatus } from "../hooks/useNetworkStatus";

// M3-06: global offline indicator. role="status" announces it politely to
// screen readers; rendered only while the browser reports no connection.

export function OfflineBanner() {
  const { t } = useTranslation();
  const { online } = useNetworkStatus();

  if (online) return null;

  return (
    <div className="offline-banner" role="status" data-testid="offline-banner">
      {t("offline.banner")}
    </div>
  );
}

import { useTranslation } from "react-i18next";

// ADR-044: Home screen with navigation placeholders.
// Full screen implementations come in later waves.

export function Home() {
  const { t } = useTranslation();

  const menuItems = [
    { key: "ride", label: t("home.ride"), emoji: "🚗", hash: "#/ride" },
    { key: "delivery", label: t("home.delivery"), emoji: "📦", hash: "#/delivery" },
    { key: "places", label: t("places.title"), emoji: "📍", hash: "#/places" },
    { key: "marketplace", label: t("home.marketplace"), emoji: "🛍", hash: "#/marketplace" },
    { key: "search", label: t("home.search"), emoji: "🔎", hash: "#/search" },
    { key: "myOrders", label: t("home.myOrders"), emoji: "📋", hash: "#/orders" },
    { key: "reputation", label: t("home.reputation"), emoji: "⭐", hash: "#/reputation" },
    { key: "profile", label: t("home.profile"), emoji: "👤", hash: "#/profile" },
  ];

  return (
    <div className="home">
      <h1>{t("appName")}</h1>
      <nav>
        <ul role="list">
          {menuItems.map((item) => (
            <li key={item.key}>
              <a href={item.hash} aria-label={item.label}>
                <span aria-hidden="true">{item.emoji}</span>
                <span>{item.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

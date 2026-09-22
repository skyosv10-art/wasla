import { useTranslation } from "react-i18next";

export function Home() {
  const { t } = useTranslation();

  const navItems = [
    { key: "activeJobs", href: "#/offers", icon: "📋" },
    { key: "earnings", href: "#/earnings", icon: "📊" },
    { key: "vehicles", href: "#/vehicles", icon: "🚗" },
    { key: "zones", href: "#/zones", icon: "📍" },
    { key: "documents", href: "#/documents", icon: "📄" },
    { key: "profile", href: "#/profile", icon: "👤" },
  ] as const;

  return (
    <div className="home">
      <h1>{t("appName")}</h1>
      <nav>
        <ul>
          {navItems.map((item) => (
            <li key={item.key}>
              <a href={item.href} aria-label={t(`home.${item.key}`)}>
                <span aria-hidden="true">{item.icon}</span>
                {t(`home.${item.key}`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useSessionStore } from "../store/session";
import { Home } from "../screens/Home";
import "../i18n";

describe("Home screen", () => {
  beforeEach(() => {
    cleanup();
    useSessionStore.getState().setSession("tok", "drv-1", Date.now() + 3600_000);
  });

  it("renders the app name", () => {
    render(<Home />);
    expect(screen.getByText("وَصْلة — السائق")).toBeDefined();
  });

  it("renders navigation items", () => {
    render(<Home />);
    expect(screen.getByText("المهام النشطة")).toBeDefined();
    expect(screen.getByText("أرباحي")).toBeDefined();
    expect(screen.getByText("مركباتي")).toBeDefined();
    expect(screen.getByText("مناطق عملي")).toBeDefined();
    expect(screen.getByText("وثائقي")).toBeDefined();
    expect(screen.getByText("حسابي")).toBeDefined();
  });

  it("renders links with correct hrefs", () => {
    render(<Home />);
    const earningsLink = screen.getByText("أرباحي").closest("a");
    expect(earningsLink?.getAttribute("href")).toBe("#/earnings");
    const vehiclesLink = screen.getByText("مركباتي").closest("a");
    expect(vehiclesLink?.getAttribute("href")).toBe("#/vehicles");
  });
});

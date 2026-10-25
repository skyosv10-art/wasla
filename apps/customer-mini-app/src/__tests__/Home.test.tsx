import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Home } from "../screens/Home";
import "../i18n";

describe("Home", () => {
  it("renders the app name", () => {
    render(<Home />);
    expect(screen.getByText("وَصْلة")).toBeInTheDocument();
  });

  it("renders each of the seven spec menu items (presence, not count)", () => {
    render(<Home />);
    expect(screen.getByText("اطلب مشوار")).toBeInTheDocument();
    expect(screen.getByText("اطلب توصيل")).toBeInTheDocument();
    expect(screen.getByText("تصفح المتاجر")).toBeInTheDocument();
    expect(screen.getByText("ابحث")).toBeInTheDocument();
    expect(screen.getByText("طلباتي")).toBeInTheDocument();
    expect(screen.getByText("سمعتي")).toBeInTheDocument();
    expect(screen.getByText("حسابي")).toBeInTheDocument();
  });

  // ADR-072 D1 (G-S7): the count and order are asserted, not just presence.
  it("renders exactly seven menu links, in spec order, with no saved-places entry", () => {
    render(<Home />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(7);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "#/ride",
      "#/delivery",
      "#/marketplace",
      "#/search",
      "#/orders",
      "#/reputation",
      "#/profile",
    ]);
    expect(screen.queryByText("الأماكن المحفوظة")).not.toBeInTheDocument();
    expect(links.some((a) => a.getAttribute("href") === "#/places")).toBe(false);
  });

  it("renders navigation links with correct hash routes", () => {
    render(<Home />);
    const rideLink = screen.getByText("اطلب مشوار").closest("a");
    expect(rideLink?.getAttribute("href")).toBe("#/ride");
  });
});

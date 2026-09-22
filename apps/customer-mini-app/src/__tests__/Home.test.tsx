import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Home } from "../screens/Home";
import "../i18n";

describe("Home", () => {
  it("renders the app name", () => {
    render(<Home />);
    expect(screen.getByText("وَصْلة")).toBeInTheDocument();
  });

  it("renders all seven menu items", () => {
    render(<Home />);
    expect(screen.getByText("اطلب مشوار")).toBeInTheDocument();
    expect(screen.getByText("اطلب توصيل")).toBeInTheDocument();
    expect(screen.getByText("تصفح المتاجر")).toBeInTheDocument();
    expect(screen.getByText("ابحث")).toBeInTheDocument();
    expect(screen.getByText("طلباتي")).toBeInTheDocument();
    expect(screen.getByText("سمعتي")).toBeInTheDocument();
    expect(screen.getByText("حسابي")).toBeInTheDocument();
  });

  it("renders navigation links with correct hash routes", () => {
    render(<Home />);
    const rideLink = screen.getByText("اطلب مشوار").closest("a");
    expect(rideLink?.getAttribute("href")).toBe("#/ride");
  });
});

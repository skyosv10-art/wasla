import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dashboard } from "../screens/Dashboard";

describe("Dashboard", () => {
  it("renders dashboard title", () => {
    render(<Dashboard />);
    expect(screen.getByText("لوحة التحكم")).toBeInTheDocument();
  });

  it("renders stat cards", () => {
    render(<Dashboard />);
    expect(screen.getByTestId("stat-active-users")).toBeInTheDocument();
    expect(screen.getByTestId("stat-available-drivers")).toBeInTheDocument();
    expect(screen.getByTestId("stat-today-orders")).toBeInTheDocument();
    expect(screen.getByTestId("stat-revenue")).toBeInTheDocument();
  });

  it("renders alert cards", () => {
    render(<Dashboard />);
    expect(screen.getByTestId("alert-pending-documents")).toBeInTheDocument();
    expect(screen.getByTestId("alert-open-disputes")).toBeInTheDocument();
  });
});

import { describe, it, expect } from "vitest";
import { resolveLocalizedName } from "../domain/locale.js";
import type { LocalizedName } from "../domain/model.js";

describe("resolveLocalizedName — locale fallback", () => {
  it("returns the requested locale when present", () => {
    const names: LocalizedName = { ar: "المدينة", en: "Madinah", ur: "مدینہ" };
    expect(resolveLocalizedName(names, "en")).toBe("Madinah");
    expect(resolveLocalizedName(names, "ur")).toBe("مدینہ");
    expect(resolveLocalizedName(names, "ar")).toBe("المدينة");
  });

  it("falls back to ar when the requested locale is missing", () => {
    const names: LocalizedName = { ar: "الحرة الشرقية", en: null, ur: null };
    expect(resolveLocalizedName(names, "en")).toBe("الحرة الشرقية");
    expect(resolveLocalizedName(names, "ur")).toBe("الحرة الشرقية");
  });

  it("falls back to ar when only the requested locale is missing (ur present)", () => {
    const names: LocalizedName = { ar: "حي الحرة", en: null, ur: "حره" };
    expect(resolveLocalizedName(names, "en")).toBe("حي الحرة");
    expect(resolveLocalizedName(names, "ur")).toBe("حره");
  });

  it("throws if neither the requested locale nor ar exists (invariant violation)", () => {
    // Cast: bypass the type's `ar: string` requirement to simulate corrupt data.
    const names = { ar: null, en: null, ur: null } as unknown as LocalizedName;
    expect(() => resolveLocalizedName(names, "en")).toThrow(/invariant/);
  });
});

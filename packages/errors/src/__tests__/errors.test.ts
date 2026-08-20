import { describe, expect, it } from "vitest";
import { WaslaError, isWaslaError } from "../index";

describe("@wasla/errors — smoke test", () => {
  it("يبني خطأً بالكود والرسالة", () => {
    const err = new WaslaError({ code: "IDENTITY_NOT_FOUND", message: "غير موجود" });
    expect(err.code).toBe("IDENTITY_NOT_FOUND");
    expect(err.message).toBe("غير موجود");
    expect(err.name).toBe("WaslaError");
  });

  it("isWaslaError يميّز WaslaError عن الأخطاء الأخرى", () => {
    const wasla = new WaslaError({ code: "X", message: "m" });
    const generic = new Error("generic");
    expect(isWaslaError(wasla)).toBe(true);
    expect(isWaslaError(generic)).toBe(false);
  });

  it("toJSON يُرجع الحقول الآمنة فقط", () => {
    const err = new WaslaError({
      code: "IDENTITY_LINK_ALREADY_LINKED",
      message: "تعارض",
      traceId: "trace-1",
    });
    expect(err.toJSON()).toEqual({
      code: "IDENTITY_LINK_ALREADY_LINKED",
      message: "تعارض",
      traceId: "trace-1",
    });
  });
});

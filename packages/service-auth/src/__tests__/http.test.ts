/**
 * جسرُ الترويسات (M1-03) — يُختبَر أنّ الغيابَ يُمثَّل ولا يُسكَت عنه.
 */

import { describe, expect, it } from "vitest";

import { ServiceAuthError } from "../errors.js";
import {
  authenticateServiceRequest,
  requireServiceCaller,
  SERVICE_AUTH_HEADER,
  serviceAuthHeaders,
} from "../http.js";
import { MIN_SECRET_BYTES, ServiceAuthKeyRegistry } from "../keys.js";
import { mintServiceToken } from "../token.js";

const SECRET = "h".repeat(MIN_SECRET_BYTES);
const keys = new ServiceAuthKeyRegistry({
  keys: [{ kid: "k1", secret: SECRET }],
  activeKid: "k1",
});
const NOW = new Date("2026-08-30T12:00:00.000Z");

const mintDefaults = {
  serviceName: "dispatch",
  audience: "matching",
  method: "POST",
  path: "/matching/offers",
  keys,
  now: NOW,
} as const;

const verifyDefaults = {
  audience: "matching",
  method: "POST",
  path: "/matching/offers",
  keys,
  now: NOW,
} as const;

describe("serviceAuthHeaders", () => {
  it("يُنتِج ترويسةً واحدةً باسمٍ صغيرِ الأحرف", () => {
    const headers = serviceAuthHeaders(mintDefaults);
    expect(Object.keys(headers)).toEqual([SERVICE_AUTH_HEADER]);
    expect(SERVICE_AUTH_HEADER).toBe(SERVICE_AUTH_HEADER.toLowerCase());
  });

  it("لا يستخدم Authorization — هويّةُ المستخدمِ لها ترويستُها", () => {
    expect(SERVICE_AUTH_HEADER).not.toBe("authorization");
    const headers = serviceAuthHeaders(mintDefaults);
    expect(headers).not.toHaveProperty("authorization");
    expect(headers).not.toHaveProperty("Authorization");
  });
});

describe("authenticateServiceRequest", () => {
  it("يُسلِّم ServicePrincipal عندَ ترويسةٍ صحيحةٍ", () => {
    const { principal, rejection } = authenticateServiceRequest(
      serviceAuthHeaders({ ...mintDefaults, scopes: ["matching:offers:write"] }),
      verifyDefaults,
    );
    expect(rejection).toBeUndefined();
    expect(principal.kind).toBe("service");
    if (principal.kind === "service") {
      expect(principal.serviceName).toBe("dispatch");
      expect(principal.scopes).toEqual(["matching:offers:write"]);
    }
  });

  it("يقرأ الترويسةَ بأيِّ حالةِ أحرفٍ", () => {
    const token = mintServiceToken(mintDefaults);
    for (const name of [
      SERVICE_AUTH_HEADER,
      SERVICE_AUTH_HEADER.toUpperCase(),
      "X-Wasla-Service-Auth",
    ]) {
      const { principal } = authenticateServiceRequest(
        { [name]: token },
        verifyDefaults,
      );
      expect(principal.kind).toBe("service");
    }
  });

  it("يُهمِل فراغاتَ الأطراف", () => {
    const token = mintServiceToken(mintDefaults);
    const { principal } = authenticateServiceRequest(
      { [SERVICE_AUTH_HEADER]: `  ${token}  ` },
      verifyDefaults,
    );
    expect(principal.kind).toBe("service");
  });

  it("غيابُ الترويسةِ = مجهولٌ بسببِ no_credentials، لا undefined", () => {
    for (const headers of [
      {},
      { [SERVICE_AUTH_HEADER]: "" },
      { [SERVICE_AUTH_HEADER]: "   " },
      { [SERVICE_AUTH_HEADER]: undefined },
      { "x-other": "value" },
    ]) {
      const { principal, rejection } = authenticateServiceRequest(
        headers,
        verifyDefaults,
      );
      expect(principal.kind).toBe("anonymous");
      if (principal.kind === "anonymous") {
        expect(principal.reason).toBe("no_credentials");
      }
      expect(rejection).toBeUndefined();
    }
  });

  it("ترويسةٌ أخفقَت = مجهولٌ بسببِ unverified_credentials مع سببٍ داخليٍّ", () => {
    const { principal, rejection } = authenticateServiceRequest(
      { [SERVICE_AUTH_HEADER]: "wsvc1.abc.def" },
      verifyDefaults,
    );
    expect(principal.kind).toBe("anonymous");
    if (principal.kind === "anonymous") {
      expect(principal.reason).toBe("unverified_credentials");
    }
    expect(rejection).toBeInstanceOf(ServiceAuthError);
  });

  it("يُفرِّق بينَ الغيابِ والإخفاقِ — وهذا الفرقُ هو ما يُرصَد أمنيّاً", () => {
    const absent = authenticateServiceRequest({}, verifyDefaults).principal;
    const failed = authenticateServiceRequest(
      { [SERVICE_AUTH_HEADER]: "garbage" },
      verifyDefaults,
    ).principal;
    expect(absent.kind).toBe("anonymous");
    expect(failed.kind).toBe("anonymous");
    if (absent.kind === "anonymous" && failed.kind === "anonymous") {
      expect(absent.reason).not.toBe(failed.reason);
    }
  });

  it("يرفض ترويسةً مكرَّرةً بدلَ اختيارِ إحداهما", () => {
    const token = mintServiceToken(mintDefaults);
    const { principal, rejection } = authenticateServiceRequest(
      { [SERVICE_AUTH_HEADER]: [token, token] },
      verifyDefaults,
    );
    expect(principal.kind).toBe("anonymous");
    expect(rejection?.reason).toBe("malformed_token");
  });

  it("يرفض رمزاً موجَّهاً لخدمةٍ أخرى ولا يُسلِّمه", () => {
    const headers = serviceAuthHeaders({ ...mintDefaults, audience: "orders" });
    const { principal, rejection } = authenticateServiceRequest(
      headers,
      verifyDefaults,
    );
    expect(principal.kind).toBe("anonymous");
    expect(rejection?.reason).toBe("audience_mismatch");
  });

  it("يرفض رمزاً مربوطاً بمسارٍ آخرَ", () => {
    const headers = serviceAuthHeaders(mintDefaults);
    const { rejection } = authenticateServiceRequest(headers, {
      ...verifyDefaults,
      path: "/matching/offers/999",
    });
    expect(rejection?.reason).toBe("request_binding_mismatch");
  });
});

describe("requireServiceCaller", () => {
  it("يردُّ المُنادي عندَ النجاح", () => {
    const principal = requireServiceCaller(
      serviceAuthHeaders(mintDefaults),
      verifyDefaults,
    );
    expect(principal.serviceName).toBe("dispatch");
  });

  it("يرمي missing_credentials عندَ غيابِ الترويسةِ", () => {
    try {
      requireServiceCaller({}, verifyDefaults);
      expect.unreachable("كان يجب أن يرمي");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceAuthError);
      expect((error as ServiceAuthError).reason).toBe("missing_credentials");
    }
  });

  it("يرمي بالسببِ الحقيقيِّ عندَ إخفاقِ التحقُّقِ", () => {
    try {
      requireServiceCaller(
        serviceAuthHeaders({ ...mintDefaults, audience: "orders" }),
        verifyDefaults,
      );
      expect.unreachable("كان يجب أن يرمي");
    } catch (error) {
      expect((error as ServiceAuthError).reason).toBe("audience_mismatch");
    }
  });
});

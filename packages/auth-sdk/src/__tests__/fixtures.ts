/**
 * أمثلةٌ مشتركةٌ للاختبارات. ملفٌّ **ليس** اختباراً بقصد: استيرادُ أمثلةٍ من ملفِّ
 * اختبارٍ يُعيد تسجيلَ حالاتِه في كلِّ ملفٍّ يستورده، فتُضخَّم الأعدادُ المُبلَّغة.
 */

import type { ServicePrincipal, UserPrincipal } from "../index.js";

const ISSUED = "2026-08-30T00:00:00.000Z";
const EXPIRES = "2026-08-30T01:00:00.000Z";

export const validUser: UserPrincipal = {
  kind: "user",
  waslaPublicId: "WSL-0000123",
  internalUuid: "3f0d5f6c-1f2a-4a9b-8c7d-9e1f2a3b4c5d",
  actor: "customer",
  channel: "telegram",
  sessionId: "sess_01HZX",
  roles: ["customer"],
  scopes: ["orders:order:create", "orders:order:read"],
  issuedAt: ISSUED,
  expiresAt: EXPIRES,
};

export const validService: ServicePrincipal = {
  kind: "service",
  serviceName: "dispatch",
  audience: "orders",
  scopes: ["orders:order:read"],
  issuedAt: ISSUED,
  expiresAt: EXPIRES,
};


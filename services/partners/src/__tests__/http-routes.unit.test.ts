/**
 * CLM-0685 — اختباراتُ مستوىِ HTTP للمساراتِ الثلاثةِ التي قاسَ
 * `PRODUCT_STATUS_2026-10-19.md` §3.4 أنّها قائمةٌ **بلا اختبارٍ**:
 *
 *   • `DELETE /partners/credentials/:id` (إبطالُ اعتمادِ API)
 *   • `POST /partners/lifecycle/suspend` (تعليقُ مستأجرٍ)
 *   • `POST /partners/lifecycle/reinstate` (إعادةُ تنشيطِ مستأجرٍ معلَّقٍ)
 *
 * طبقتانِ من الإثباتِ:
 *
 * 1. **السلوكُ بمخازنَ وهميّةٍ** (لا قاعدةَ ولا شبكةَ): النجاحُ الموجبُ
 *    (الحالةُ والانتقالُ وسجلُّ التدقيقِ) والرفضُ السالبُ (بلا فاعلٍ 401 ·
 *    غيرُ عضوٍ 403 `TENANT_ACCESS_DENIED` · دورٌ دونَ مديرٍ 403
 *    `TENANT_ROLE_DENIED` · انتقالٌ غيرُ مشروعٍ يُرفَضُ لا يُنفَّذُ).
 *
 * 2. **فرضُ هويّةِ الخدمةِ الحقيقيِّ** على المساراتِ الثلاثةِ بتوقيعٍ حقيقيٍّ
 *    (`serviceAuthHeaders` بمفتاحٍ نشطٍ في سجلٍّ حقيقيٍّ): بلا رمزٍ → 401،
 *    برمزٍ صالحٍ وصلاحيّةٍ ناقصةٍ → 403، وبالصلاحيّةِ المعلَنةِ للمسارِ →
 *    النجاحُ. التوقيعُ يُنشئُهُ المُنادي والتحققُ يُؤدّيهِ وسيطُ الحدِّ —
 *    لا ختمَ ولا تجاوزَ.
 *
 * لا تغييرَ في شيفرةِ الإنتاجِ: هذا الملفُّ اختبارٌ وحدَهُ يسدُّ فجوةَ قياسٍ
 * مُعلَنةً (قاعدةُ `0.2` من الخارطةِ الحاكمةِ: التنفيذَ يُثبتُهُ الدليلُ
 * المحالُ إليهِ حصرًا لا وجودُ المسارِ في الشيفرةِ).
 */
import { describe, expect, it } from "vitest";

import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  serviceAuthHeaders,
} from "@wasla/service-auth";

import { createPartnersApp } from "../http/app.js";
import { PARTNERS_SCOPES } from "../http/service-identity.js";
import type {
  ApiCredential,
  AuditEntry,
  LifecycleState,
  SlaTier,
} from "../domain/lifecycle.js";
import type {
  AuditStore,
  CredentialStore,
  LifecycleStore,
  PartnerLifecycleEntry,
  StoreStaffPort,
} from "../ports.js";

/* ── مخازنُ وهميّةٌ صادقةُ الوعدِ: تسجّلُ ما استُدعيَ ولا تُخمّنُ ── */

const STORE = "store-1";
const OWNER = "CUS-OWNER";
const MANAGER = "CUS-MANAGER";
const STAFF = "CUS-STAFF";
const OUTSIDER = "CUS-OUTSIDER";
const CRED_ID = "cred-1";

class FakeStaffPort implements StoreStaffPort {
  constructor(private readonly members: Map<string, string>) {}
  async isStoreStaff(storeId: string, memberPublicId: string) {
    const role = this.members.get(`${storeId}:${memberPublicId}`);
    if (!role) return null;
    return {
      storeId,
      memberPublicId,
      role: role as "owner" | "manager" | "staff",
      state: "active" as const,
    };
  }
}

class FakeCredentialStore implements CredentialStore {
  revoked: Array<{ id: string; at: string }> = [];
  constructor(private readonly known: Set<string> = new Set([CRED_ID])) {}
  async create(_input: import("../domain/lifecycle.js").CredentialCreateInput): Promise<ApiCredential> {
    throw new Error("لا يُستدعى في هذهِ الحالاتِ");
  }
  async listByTenant(_storeId: string): Promise<ApiCredential[]> {
    return [];
  }
  async revoke(credentialId: string, revokedAt: string) {
    if (!this.known.has(credentialId)) return null;
    this.revoked.push({ id: credentialId, at: revokedAt });
    return {
      credentialId,
      tenantStoreId: STORE,
      issuedByPublicId: OWNER,
      keyPrefix: "wsk_",
      scopes: [],
      state: "revoked" as const,
      createdAt: revokedAt,
      revokedAt,
    };
  }
  async findByHash(_keyHash: string): Promise<ApiCredential | null> {
    return null;
  }
}

class FakeAuditStore implements AuditStore {
  entries: Array<Omit<AuditEntry, "createdAt">> = [];
  async append(entry: Omit<AuditEntry, "createdAt">) {
    this.entries.push(entry);
    return { ...entry, createdAt: new Date().toISOString() };
  }
  async listByTenant(_storeId: string, _limit: number): Promise<AuditEntry[]> {
    return [];
  }
}

function lifecycleEntry(state: LifecycleState): PartnerLifecycleEntry {
  return {
    tenantStoreId: STORE,
    state,
    slaTier: "standard",
    suspendedReason: null,
    suspendedAt: null,
    offboardedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

class FakeLifecycleStore implements LifecycleStore {
  readonly states = new Map<string, PartnerLifecycleEntry>([
    [STORE, lifecycleEntry("active")],
  ]);
  transitions: Array<{ storeId: string; to: string; reason?: string }> = [];
  async get(storeId: string) {
    return this.states.get(storeId) ?? null;
  }
  async create(_storeId: string, _slaTier: SlaTier): Promise<PartnerLifecycleEntry> {
    throw new Error("لا يُستدعى في هذهِ الحالاتِ");
  }
  async transition(storeId: string, to: LifecycleState, reason?: string) {
    this.transitions.push({ storeId, to, reason });
    const current = this.states.get(storeId);
    const next = { ...(current ?? lifecycleEntry(to)), state: to, updatedAt: "2026-10-24T00:00:00.000Z" };
    this.states.set(storeId, next);
    return next;
  }
}

/* ── هويّةُ الخدمةِ: مفتاحٌ نشطٌ واحدٌ يُوقِّعُ بهِ المُنادي ويتحقّقُ بهِ الحدُّ ── */

const keys = new ServiceAuthKeyRegistry({
  activeKid: "test-active",
  keys: [{ kid: "test-active", secret: "partners-test-secret-0123456789abcdef", status: "active" }],
});

function signedHeaders(
  method: string,
  path: string,
  scopes: readonly string[],
): Record<string, string> {
  return serviceAuthHeaders({
    serviceName: "wasla-admin-portal",
    audience: "partners",
    method,
    path,
    scopes,
    keys,
    now: new Date(),
  });
}

/* ── التركيبُ ── */

interface Rig {
  readonly app: ReturnType<typeof createPartnersApp>;
  readonly audit: FakeAuditStore;
  readonly credentials: FakeCredentialStore;
  readonly lifecycle: FakeLifecycleStore;
}

function buildRig(withIdentity: boolean): Rig {
  const audit = new FakeAuditStore();
  const credentials = new FakeCredentialStore();
  const lifecycle = new FakeLifecycleStore();
  const app = createPartnersApp({
    logger: false,
    staffPort: new FakeStaffPort(
      new Map([
        [`${STORE}:${OWNER}`, "owner"],
        [`${STORE}:${MANAGER}`, "manager"],
        [`${STORE}:${STAFF}`, "staff"],
      ]),
    ),
    credentialStore: credentials,
    webhookStore: {
      async create(_webhook: never): Promise<never> {
        throw new Error("لا يُستدعى");
      },
      async listByTenant(_storeId: string): Promise<never[]> {
        return [];
      },
      async delete(_webhookId: string, _deletedAt: string): Promise<never | null> {
        return null;
      },
      async pause(_webhookId: string, _updatedAt: string): Promise<never | null> {
        return null;
      },
    },
    usageStore: {
      async incrementApiCalls(_storeId: string, _windowStart: string): Promise<never> {
        throw new Error("لا يُستدعى");
      },
      async incrementWebhookDeliveries(_storeId: string, _windowStart: string): Promise<never> {
        throw new Error("لا يُستدعى");
      },
      async get(_storeId: string, _windowStart: string): Promise<never | null> {
        return null;
      },
    },
    auditStore: audit,
    lifecycleStore: lifecycle,
    ...(withIdentity
      ? { serviceIdentity: { keys, replayGuard: new InMemoryServiceTokenReplayGuard() } }
      : {}),
  });
  return { app, audit, credentials, lifecycle };
}

/* ── الطبقةُ الأولى: السلوكُ بمخازنَ وهميّةٍ ── */

describe("مساراتُ الشركاءِ الثلاثةُ — السلوكُ (PRODUCT_STATUS §3.4)", () => {
  it("DELETE /partners/credentials/:id: مالكٌ يُبطلُ اعتمادًا → 204 والاعتمادُ مُعلَّمٌ والتدقيقُ مكتوبٌ", async () => {
    const rig = buildRig(false);
    const res = await rig.app.inject({
      method: "DELETE",
      url: `/partners/credentials/${CRED_ID}`,
      headers: { "x-wasla-principal": OWNER },
      payload: { storeId: STORE },
    });
    expect(res.statusCode).toBe(204);
    expect(rig.credentials.revoked).toHaveLength(1);
    expect(rig.credentials.revoked[0].id).toBe(CRED_ID);
    expect(rig.audit.entries).toHaveLength(1);
    expect(rig.audit.entries[0].action).toBe("credential.revoked");
    expect(rig.audit.entries[0].actorPublicId).toBe(OWNER);
  });

  it("بلا فاعلٍ (x-wasla-principal) → 401 من المسارِ قبلَ أيِّ مخزنٍ", async () => {
    const rig = buildRig(false);
    const res = await rig.app.inject({
      method: "DELETE",
      url: `/partners/credentials/${CRED_ID}`,
      payload: { storeId: STORE },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe("AUTHN_UNAUTHENTICATED");
    expect(rig.credentials.revoked).toHaveLength(0);
  });

  it("غيرُ عضوٍ في المتجرِ → 403 TENANT_ACCESS_DENIED ولا إبطالَ", async () => {
    const rig = buildRig(false);
    const res = await rig.app.inject({
      method: "DELETE",
      url: `/partners/credentials/${CRED_ID}`,
      headers: { "x-wasla-principal": OUTSIDER },
      payload: { storeId: STORE },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe("TENANT_ACCESS_DENIED");
    expect(rig.credentials.revoked).toHaveLength(0);
  });

  it("عضوٌ بدورِ staff (دونَ مديرٍ) → 403 TENANT_ROLE_DENIED — حارسُ الدورِ يُفرَضُ عندَ المسارِ", async () => {
    const rig = buildRig(false);
    const res = await rig.app.inject({
      method: "DELETE",
      url: `/partners/credentials/${CRED_ID}`,
      headers: { "x-wasla-principal": STAFF },
      payload: { storeId: STORE },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe("TENANT_ROLE_DENIED");
    expect(rig.credentials.revoked).toHaveLength(0);
  });

  it("اعتمادٌ غيرُ موجودٍ → فشلٌ ظاهرٌ لا نجاحٌ صامتٌ", async () => {
    const rig = buildRig(false);
    const res = await rig.app.inject({
      method: "DELETE",
      url: "/partners/credentials/cred-unknown",
      headers: { "x-wasla-principal": OWNER },
      payload: { storeId: STORE },
    });
    expect(res.statusCode).toBe(500);
    expect(rig.audit.entries).toHaveLength(0);
  });

  it("POST /partners/lifecycle/suspend: نشِطٌ → 200 suspended والانتقالُ والتدقيقُ بالسببِ", async () => {
    const rig = buildRig(false);
    const res = await rig.app.inject({
      method: "POST",
      url: "/partners/lifecycle/suspend",
      headers: { "x-wasla-principal": OWNER },
      payload: { storeId: STORE, reason: "مخالفةُ اتفاقيّةِ الاستعمالِ" },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe("suspended");
    expect(rig.lifecycle.transitions).toEqual([
      { storeId: STORE, to: "suspended", reason: "مخالفةُ اتفاقيّةِ الاستعمالِ" },
    ]);
    expect(rig.audit.entries[0].action).toBe("lifecycle.suspended");
    expect(rig.audit.entries[0].metadata).toEqual({ reason: "مخالفةُ اتفاقيّةِ الاستعمالِ" });
  });

  it("تعليقُ مستأجرٍ مُنهى (offboarded) → رفضُ الانتقالِ لا تنفيذُه", async () => {
    const rig = buildRig(false);
    rig.lifecycle.states.set(STORE, lifecycleEntry("offboarded"));
    const res = await rig.app.inject({
      method: "POST",
      url: "/partners/lifecycle/suspend",
      headers: { "x-wasla-principal": OWNER },
      payload: { storeId: STORE, reason: "x" },
    });
    expect(res.statusCode).toBe(500);
    expect(rig.lifecycle.transitions).toHaveLength(0);
    expect(rig.audit.entries).toHaveLength(0);
  });

  it("POST /partners/lifecycle/reinstate: معلَّقٌ → 200 active والتدقيقُ lifecycle.reinstated", async () => {
    const rig = buildRig(false);
    rig.lifecycle.states.set(STORE, lifecycleEntry("suspended"));
    const res = await rig.app.inject({
      method: "POST",
      url: "/partners/lifecycle/reinstate",
      headers: { "x-wasla-principal": OWNER },
      payload: { storeId: STORE },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe("active");
    expect(rig.lifecycle.transitions).toEqual([{ storeId: STORE, to: "active" }]);
    expect(rig.audit.entries[0].action).toBe("lifecycle.reinstated");
  });

  it("إعادةُ تنشيطِ مستأجرٍ نشِطٍ (انتقالٌ غيرُ مشروعٍ) → رفضٌ لا تنفيذَ", async () => {
    const rig = buildRig(false);
    const res = await rig.app.inject({
      method: "POST",
      url: "/partners/lifecycle/reinstate",
      headers: { "x-wasla-principal": OWNER },
      payload: { storeId: STORE },
    });
    expect(res.statusCode).toBe(500);
    expect(rig.lifecycle.transitions).toHaveLength(0);
  });

  it("مسارا دورةِ الحياةِ بلا فاعلٍ → 401 من كليهما", async () => {
    const rig = buildRig(false);
    const suspend = await rig.app.inject({
      method: "POST",
      url: "/partners/lifecycle/suspend",
      payload: { storeId: STORE, reason: "x" },
    });
    const reinstate = await rig.app.inject({
      method: "POST",
      url: "/partners/lifecycle/reinstate",
      payload: { storeId: STORE },
    });
    expect(suspend.statusCode).toBe(401);
    expect(reinstate.statusCode).toBe(401);
  });
});

/* ── الطبقةُ الثانية: فرضُ هويّةِ الخدمةِ الحقيقيِّ بتوقيعٍ حقيقيٍّ ── */

describe("مساراتُ الشركاءِ الثلاثةُ — هويّةُ الخدمةِ مُفرَضةٌ بتوقيعٍ حقيقيٍّ", () => {
  it("DELETE بلا رمزِ خدمةٍ → 401 من وسيطِ الحدِّ قبلَ منطقِ المسارِ", async () => {
    const rig = buildRig(true);
    const res = await rig.app.inject({
      method: "DELETE",
      url: `/partners/credentials/${CRED_ID}`,
      headers: { "x-wasla-principal": OWNER },
      payload: { storeId: STORE },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe("AUTHN_UNAUTHENTICATED");
    expect(rig.credentials.revoked).toHaveLength(0);
  });

  it("DELETE برمزٍ صالحٍ وصلاحيّةٍ ناقصةٍ → 403 (الصلاحيّةُ تُطالَبُ بالمعلَنِ للمسارِ)", async () => {
    const rig = buildRig(true);
    const res = await rig.app.inject({
      method: "DELETE",
      url: `/partners/credentials/${CRED_ID}`,
      headers: {
        "x-wasla-principal": OWNER,
        ...signedHeaders("DELETE", `/partners/credentials/${CRED_ID}`, [
          PARTNERS_SCOPES.credentialRead,
        ]),
      },
      payload: { storeId: STORE },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe("AUTHZ_FORBIDDEN");
    expect(rig.credentials.revoked).toHaveLength(0);
  });

  it("DELETE بصلاحيّةِ credential:revoke → 204 (التوقيعُ والتحققُ حقيقيّانِ)", async () => {
    const rig = buildRig(true);
    const res = await rig.app.inject({
      method: "DELETE",
      url: `/partners/credentials/${CRED_ID}`,
      headers: {
        "x-wasla-principal": OWNER,
        ...signedHeaders("DELETE", `/partners/credentials/${CRED_ID}`, [
          PARTNERS_SCOPES.credentialRevoke,
        ]),
      },
      payload: { storeId: STORE },
    });
    expect(res.statusCode).toBe(204);
    expect(rig.credentials.revoked).toHaveLength(1);
  });

  it("POST suspend بلا رمزٍ → 401، وبصلاحيّةٍ ناقصةٍ → 403، وبالمعلَنةِ → 200", async () => {
    const rig = buildRig(true);
    const noToken = await rig.app.inject({
      method: "POST",
      url: "/partners/lifecycle/suspend",
      headers: { "x-wasla-principal": OWNER },
      payload: { storeId: STORE, reason: "x" },
    });
    expect(noToken.statusCode).toBe(401);

    const wrongScope = await rig.app.inject({
      method: "POST",
      url: "/partners/lifecycle/suspend",
      headers: {
        "x-wasla-principal": OWNER,
        ...signedHeaders("POST", "/partners/lifecycle/suspend", [
          PARTNERS_SCOPES.lifecycleRead,
        ]),
      },
      payload: { storeId: STORE, reason: "x" },
    });
    expect(wrongScope.statusCode).toBe(403);
    expect(rig.lifecycle.transitions).toHaveLength(0);

    const ok = await rig.app.inject({
      method: "POST",
      url: "/partners/lifecycle/suspend",
      headers: {
        "x-wasla-principal": OWNER,
        ...signedHeaders("POST", "/partners/lifecycle/suspend", [
          PARTNERS_SCOPES.lifecycleSuspend,
        ]),
      },
      payload: { storeId: STORE, reason: "x" },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { status: string }).status).toBe("suspended");
  });

  it("POST reinstate بلا رمزٍ → 401 وبصلاحيّةِ lifecycle:reinstate → 200", async () => {
    const rig = buildRig(true);
    rig.lifecycle.states.set(STORE, lifecycleEntry("suspended"));
    const noToken = await rig.app.inject({
      method: "POST",
      url: "/partners/lifecycle/reinstate",
      headers: { "x-wasla-principal": OWNER },
      payload: { storeId: STORE },
    });
    expect(noToken.statusCode).toBe(401);

    const ok = await rig.app.inject({
      method: "POST",
      url: "/partners/lifecycle/reinstate",
      headers: {
        "x-wasla-principal": OWNER,
        ...signedHeaders("POST", "/partners/lifecycle/reinstate", [
          PARTNERS_SCOPES.lifecycleReinstate,
        ]),
      },
      payload: { storeId: STORE },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { status: string }).status).toBe("active");
  });
});

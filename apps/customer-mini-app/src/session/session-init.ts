/**
 * `session-init.ts` — تهيئةُ الجلسةِ من `Telegram.WebApp.initData` (ADR-069 §2.1).
 *
 * **لماذا ملفٌّ منفصلٌ لا تعديلٌ في `main.tsx`؟** التهيئةُ ليست ترتيبَ استيرادٍ
 * بل ترتيبَ تشغيلٍ — تُستدعى من `main.tsx` لا تُدرَجُ فيه. وهذا يسمحُ
 * للاختبارِ أن يستدعيَها بلا إقلاعِ التطبيقِ كاملًا.
 *
 * **لا تُخزَّنُ الجلسةُ في أيِّ تخزينٍ محليٍّ:** الرمزُ في الذاكرةِ وحدها
 * (ADR-044 §4 · ADR-019 §2.5)، وإعادةُ التحميلِ تُعيدُ التهيئةَ من `initData`.
 *
 * **لا يُستهلُّ التطبيقُ بلا جلسةٍ في الإنتاجِ:** يُرسلُ `initData` إلى الحدِّ
 * ويُستقبلُ رمزًا معتمًا، ولا يُقبلُ إلا من `WebApp` مُهيَّأٍ.
 *
 * **G-S8 (CLM-0610) — دورةُ الحياةِ:** نتيجةُ التهيئةِ حالةٌ في المخزنِ
 * (`initStatus`/`initError`) لا قيمةٌ تُهمَلُ، فالشاشةُ تعرضُ فشلًا بإعادةِ
 * محاولةٍ بدلَ «جارٍ التحميل» الدائمِ. `startSessionLifecycle` يعيدُ التهيئةَ
 * تلقائيًّا عندَ انتهاءِ الجلسةِ أو مسحِها بـ401 — **بميزانيةٍ** (3 مرّاتٍ في
 * 5 دقائقَ) تمنعُ الحلقةَ، ولا يعيدُ المحاولةَ تلقائيًّا بعدَ فشلٍ (الإعادةُ
 * يدويّةٌ)، ولا بعدَ `logoutSession`. محاولةٌ واحدةٌ في الطيرانِ في كلِّ وقتٍ.
 */

import { useSessionStore, type SessionInitError } from "../store/session";

/** `Telegram.WebApp` كما يراه الحدُّ — لا يُقرأُ إلا بعدَ `ready()`. */
interface TelegramWebApp {
  readonly initData: string;
  ready(): void;
}

/** يُقرأُ `Telegram.WebApp` من النافذةِ لا من أيِّ مصدرٍ آخر. */
function readWebApp(): TelegramWebApp | null {
  const w = window as unknown as { Telegram?: { WebApp?: TelegramWebApp } };
  return w.Telegram?.WebApp ?? null;
}

/** ردُّ الحدِّ على `POST /edge/session` — لا يحملُ إلا ما يُخزَّنُ في الذاكرةِ. */
interface EdgeSessionResponse {
  readonly token: string;
  readonly wasla_public_id: string;
  readonly expires_at: string;
  readonly session_id: string;
}

/** خطأُ الحدِّ — لا يحملُ رمزًا ولا بصمةَ ولا سرًّا. */
interface EdgeError {
  readonly code: string;
  readonly message: string;
}

/**
 * تهيئةُ الجلسةِ من `Telegram.WebApp.initData` عبرَ حدِّ القناةِ.
 *
 * **لا يُعيدُ الرمزَ ولا يُخزِّنُهُ في أيِّ مكانٍ غيرِ الذاكرةِ.** ويُرجعُ
 * `true` عندَ النجاحِ و`false` عندَ أيِّ فشلٍ (لا يرفعُ — ولا حتى خطأَ شبكةٍ)،
 * ويكتبُ النتيجةَ في `initStatus`/`initError`. نداءانِ متزامنانِ يشتركانِ في
 * طلبٍ واحدٍ.
 */
let inflight: Promise<boolean> | null = null;

export function initSessionFromTelegram(): Promise<boolean> {
  if (inflight) return inflight;
  inflight = runInit().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runInit(): Promise<boolean> {
  const store = useSessionStore.getState();
  const fail = (error: SessionInitError): false => {
    useSessionStore.getState().setInitState("failed", error);
    return false;
  };
  const webApp = readWebApp();
  if (!webApp || !webApp.initData) {
    // لا يُستهلُّ التطبيقُ من خارجِ تلغرامَ — ولا يُختَرَعُ مصدرُ جلسةٍ ثانٍ؛
    // الفشلُ ظاهرٌ بسببِه بدلَ تحميلٍ لا ينتهي.
    return fail("not_in_telegram");
  }
  store.setInitState("initializing");
  webApp.ready();
  const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/edge/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ init_data: webApp.initData }),
    });
  } catch {
    return fail("network");
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as EdgeError;
    console.warn("[session-init] فشل إصدار الجلسة:", error.code ?? response.status);
    return fail("edge_rejected");
  }
  let body: EdgeSessionResponse;
  try {
    body = (await response.json()) as EdgeSessionResponse;
  } catch {
    return fail("invalid_response");
  }
  const expiresAtMs = Date.parse(body.expires_at);
  if (!body.token || !body.wasla_public_id || !Number.isFinite(expiresAtMs)) {
    return fail("invalid_response");
  }
  useSessionStore.getState().setSession(body.token, body.wasla_public_id, expiresAtMs);
  useSessionStore.getState().setInitState("ready");
  return true;
}

/** إعادةُ محاولةٍ يدويّةٌ من شاشةِ الفشلِ — تُصفِّرُ ميزانيةَ الإعادةِ التلقائيّةِ. */
export function retrySession(): Promise<boolean> {
  autoReinitAt = [];
  return initSessionFromTelegram();
}

export interface SessionLifecycleOptions {
  /** أقصى إعاداتِ تهيئةٍ تلقائيّةٍ داخلَ النافذةِ (افتراضيًّا 3). */
  readonly maxAutoReinit?: number;
  /** طولُ النافذةِ بالمللي ثانية (افتراضيًّا 5 دقائق). */
  readonly windowMs?: number;
}

let autoReinitAt: number[] = [];
let loggedOut = false;

/**
 * يبدأُ دورةَ حياةِ الجلسةِ ويُعيدُ دالّةَ إيقافٍ: تهيئةٌ أولى · مؤقّتُ انتهاءٍ
 * يمسحُ الجلسةَ عندَ `expiresAt` · إعادةُ تهيئةٍ تلقائيّةٌ محدودةٌ كلّما مُسحتْ
 * جلسةٌ قائمةٌ (انتهاءٌ أو 401 من `api/client`) — لا بعدَ الخروجِ.
 */
export function startSessionLifecycle(options: SessionLifecycleOptions = {}): () => void {
  const maxAutoReinit = options.maxAutoReinit ?? 3;
  const windowMs = options.windowMs ?? 5 * 60_000;
  autoReinitAt = [];
  loggedOut = false;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;

  const armExpiry = (expiresAt: number | null) => {
    if (expiryTimer !== null) clearTimeout(expiryTimer);
    expiryTimer = null;
    if (expiresAt === null) return;
    expiryTimer = setTimeout(() => {
      expiryTimer = null;
      useSessionStore.getState().clearSession();
    }, Math.max(0, expiresAt - Date.now()));
  };

  const unsubscribe = useSessionStore.subscribe((state, prev) => {
    if (state.expiresAt !== prev.expiresAt) armExpiry(state.expiresAt);
    const lostSession = prev.token !== null && state.token === null;
    if (!lostSession) return;
    if (loggedOut) return;
    const now = Date.now();
    autoReinitAt = autoReinitAt.filter((t) => now - t < windowMs);
    if (autoReinitAt.length >= maxAutoReinit) {
      useSessionStore.getState().setInitState("failed", "retry_limit");
      return;
    }
    autoReinitAt.push(now);
    void initSessionFromTelegram();
  });

  armExpiry(useSessionStore.getState().expiresAt);
  void initSessionFromTelegram();

  return () => {
    unsubscribe();
    if (expiryTimer !== null) clearTimeout(expiryTimer);
  };
}

/** سحبُ الجلسةِ عبرَ `POST /edge/session/logout` — لا يُخزَّنُ شيءٌ هنا. */
export async function logoutSession(): Promise<void> {
  const { token, clearSession } = useSessionStore.getState();
  if (!token) return;
  // الخروجُ قصدٌ لا انتهاءٌ — لا إعادةَ تهيئةٍ تلقائيّةٌ بعدَه.
  loggedOut = true;
  const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
  await fetch(`${baseUrl}/edge/session/logout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  }).catch(() => undefined);
  clearSession();
}

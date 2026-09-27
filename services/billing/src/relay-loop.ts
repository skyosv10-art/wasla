/**
 * حلقةُ المُرحِّلِ داخلَ عمليةِ الخدمة (M5-17P · CLM-0375).
 *
 * دفعةٌ ثمَّ انتظارٌ ثمَّ دفعة — بلا تداخل: الدفعةُ التاليةُ تُجدوَلُ بعدَ انتهاءِ السابقةِ
 * لا بمؤقِّتٍ ثابتٍ، فدفعةٌ بطيئةٌ لا تتراكمُ فوقَها أخرى. وخطأُ دفعةٍ يُسجَّلُ ولا يُسقِطُ
 * العملية؛ الدفعةُ التاليةُ تُعيدُ المحاولةَ من نقطةِ التفتيشِ الدائمة. و`stop()` تنتظرُ
 * الدفعةَ الجاريةَ حتى تنتهي قبلَ أن يُغلَقَ المسبح.
 */

import type { RelayDeps } from "./ports.js";
import { runRelayBatch, type RelayBatchResult, type RelayConfig } from "./relay.js";

export interface RelayLoopOptions {
  readonly deps: RelayDeps;
  readonly config: RelayConfig;
  readonly intervalMs: number;
  readonly onBatch?: (result: RelayBatchResult) => void;
  readonly onError?: (err: unknown) => void;
}

export interface RelayLoopHandle {
  stop(): Promise<void>;
}

export function startRelayLoop(opts: RelayLoopOptions): RelayLoopHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;

  const tick = (): void => {
    timer = null;
    if (stopped) return;
    running = runRelayBatch(opts.deps, opts.config)
      .then((result) => opts.onBatch?.(result))
      .catch((err: unknown) => opts.onError?.(err))
      .finally(() => {
        running = null;
        if (!stopped) timer = setTimeout(tick, opts.intervalMs);
      });
  };

  timer = setTimeout(tick, 0);

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (running) await running;
    },
  };
}

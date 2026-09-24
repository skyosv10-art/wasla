/**
 * main.ts — مدخلُ تشغيلِ Render Cron Job (G8 · M2-09A · CLM-0330).
 * يُقلِعُهُ مدخلُ الصورةِ عبرَ `scripts.start` حينَ `WASLA_SERVICE=@wasla/tick-scheduler`.
 * لا منطقَ هنا: كلُّهُ في `scheduler.ts` المُختبَرِ بالاستيرادِ.
 */
import { runTicks } from "./scheduler.js";

const result = await runTicks({
  env: process.env,
  fetch: globalThis.fetch,
  now: () => new Date(),
  log: (level, message) => process.stderr.write(`[${new Date().toISOString()}] ${level} ${message}\n`),
});
process.exitCode = result.exitCode;

// entry-dryrun.mjs — يُقاسُ داخلَ الصورةِ: هل الحزمةُ محلولةٌ وملفُّ مدخلِها موجودٌ؟ (M2-01)
//
// يُشغَّلُ بعدَ أن يَحلَّ المدخلُ الحزمةَ بـ`resolve-package.mjs` ويدخلَ دليلَها،
// فمجرّدُ وصولِهِ إلى التنفيذِ يُثبِتُ أنَّ الحزمةَ موجودةٌ داخلَ الصورةِ ومحلولةٌ
// من بيانِ فضاءِ العملِ نفسِهِ لا من قائمةٍ مكتوبةٍ. ثمَّ يقرأُ `start`
// ويتحقّقُ من وجودِ الملفِّ الذي تُشيرُ إليهِ — لا من صحّةِ منطقِهِ.
//
// رموزُ الخروجِ مُفرَّقةٌ بقصدٍ: «لا أمرَ start» ≠ «أمرٌ غيرُ مفهومٍ» ≠ «ملفٌّ
// مفقودٌ»، فالفشلُ الواحدُ الغامضُ يُخفي ثلاثةَ أسبابٍ مختلفةِ العلاجِ.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve(process.cwd(), "package.json");
if (!existsSync(manifestPath)) {
  console.error(`dryrun: لا package.json في ${process.cwd()}`);
  process.exit(69);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const start = manifest.scripts?.start;
if (!start) {
  console.error(`dryrun: ${manifest.name}: لا أمرَ start`);
  process.exit(70);
}

const match = start.match(/([\w./-]+\.(?:ts|mts|js|mjs|cjs))/);
if (!match) {
  console.error(`dryrun: ${manifest.name}: تعذّرَ استخراجُ ملفِّ المدخلِ من «${start}»`);
  process.exit(71);
}

const entry = resolve(process.cwd(), match[1]);
if (!existsSync(entry)) {
  console.error(`dryrun: ${manifest.name}: ملفُّ المدخلِ مفقودٌ داخلَ الصورةِ — ${match[1]}`);
  process.exit(72);
}

console.log(`dryrun ok: ${manifest.name} → ${match[1]}`);

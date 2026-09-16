// resolve-package.mjs — يحلُّ اسمَ حزمةِ فضاءِ العملِ إلى مسارِها وأمرِ `start`. (M2-01)
//
// ── العيبُ المقيسُ الذي عولِجَ هنا ─────────────────────────────────────────
// كانَ المدخلُ يُقلِعُ بـ`pnpm --filter <حزمة> run start`، فكانتْ الصورةُ تشحنُ
// مديرَ حِزَمٍ كاملاً في طبقةِ التشغيلِ. أوّلُ مسحِ ثغراتٍ حقيقيٍّ (الشوطُ
// 35145160740) قاسَ 49 ثغرةً HIGH/CRITICAL قابلةً للإصلاحِ **مصدرُها كلُّهُ**
// ذاكرةُ `corepack` المنسوخةُ إلى التشغيلِ: pnpm · pacote · sigstore · tar ·
// ip-address · glob · minimatch · cross-spawn · brace-expansion. وصورةُ خدمةٍ
// لا تُنصِّبُ شيئاً بعدَ البناءِ لا تحتاجُ مديرَ حِزَمٍ: أداةٌ زائدةٌ = سطحُ
// هجومٍ زائدٌ. فحُذِفَ من طبقةِ التشغيلِ، وحلُّ الحزمةِ يجري هنا بـ`node` وحدَهُ.
//
// ── مصدرُ الحقيقةِ ────────────────────────────────────────────────────────
// أنماطُ فضاءِ العملِ تُقرأُ من `pnpm-workspace.yaml`، وأمرُ الإقلاعِ من
// `scripts.start` في بيانِ الحزمةِ — لا قائمةَ أدلّةٍ مكتوبةً هنا تفترقُ عن
// المستودعِ بصمتٍ. المُخرَجُ سطرٌ واحدٌ: `<الدليلُ>\t<أمرُ start>`.
//
// رموزُ الخروجِ مُفرَّقةٌ بقصدٍ: 65 بيانُ فضاءِ عملٍ مفقودٌ · 66 لا حزمةَ بهذا
// الاسمِ · 70 حزمةٌ بلا `start`، فالفشلُ الواحدُ الغامضُ يُخفي أسباباً مختلفةَ العلاجِ.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const wanted = process.argv[2];

const wsPath = join(ROOT, "pnpm-workspace.yaml");
if (!existsSync(wsPath)) {
  console.error(`resolve-package: لا pnpm-workspace.yaml في ${ROOT}`);
  process.exit(65);
}

// قارئٌ ضيّقٌ بقصدٍ: قائمةُ `packages:` من أنماطٍ من شكلِ `dir/*` أو `dir`.
// لا مكتبةَ YAML في طبقةِ التشغيلِ، ونطاقُ ما يُقرأُ مُعلَنٌ لا مُخمَّنٌ.
const patterns = [];
let inPackages = false;
for (const raw of readFileSync(wsPath, "utf8").split("\n")) {
  const line = raw.replace(/#.*$/, "").trimEnd();
  if (/^packages:\s*$/.test(line)) {
    inPackages = true;
    continue;
  }
  if (inPackages) {
    const m = line.match(/^\s+-\s*['"]?([^'"]+?)['"]?\s*$/);
    if (m) patterns.push(m[1]);
    else if (line.trim() !== "") break;
  }
}

const dirs = [];
for (const pattern of patterns) {
  if (pattern.endsWith("/*")) {
    const parent = join(ROOT, pattern.slice(0, -2));
    if (!existsSync(parent)) continue;
    for (const name of readdirSync(parent)) {
      const dir = join(parent, name);
      if (statSync(dir).isDirectory()) dirs.push(dir);
    }
  } else {
    const dir = join(ROOT, pattern);
    if (existsSync(dir)) dirs.push(dir);
  }
}

for (const dir of dirs) {
  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath)) continue;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    continue;
  }
  if (manifest.name !== wanted) continue;
  const start = manifest.scripts?.start;
  if (!start) {
    console.error(`resolve-package: ${wanted}: لا أمرَ start في بيانِها`);
    process.exit(70);
  }
  process.stdout.write(`${dir}\t${start}\n`);
  process.exit(0);
}

console.error(`resolve-package: لا حزمةَ بالاسمِ «${wanted}» في فضاءِ العملِ داخلَ الصورةِ`);
process.exit(66);

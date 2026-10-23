#!/usr/bin/env bash
# CLM-0671 — قياسٌ مقارِنٌ فقط (MEASUREMENT-ONLY — يُحذَفُ قبلَ أيِّ اقتراحِ دمجٍ لتغييرِ CI).
#
# بعدَ أن تُثبِّتَ المهمّةُ اعتماديّاتِ Playwright من archive.ubuntu.com (الخيار B)،
# ينزِّلُ هذا السكربتُ **الحزمَ نفسَها بإصداراتِها نفسِها** من azure.archive.ubuntu.com
# على المشغّلِ نفسِهِ، ليُعرَفَ في كلِّ تشغيلٍ هل كانت azure بطيئةً لحظتَها.
#
# معزولٌ عن apt النظامِ: قائمةُ مصادرَ وفهارسُ وذاكرةٌ في دليلٍ مؤقّتٍ؛ لا يثبّتُ شيئًا.
# محدودٌ زمنيًّا: PROBE_SECONDS (افتراضيًّا 90) للتنزيلِ، و 30 ث للفهارس.
# لا يفشلُ المهمّةَ أبدًا (exit 0 دائمًا)؛ يطبعُ سطرًا واحدًا قابلًا للتحليل:
#   CLM0671-PROBE host=azure.archive.ubuntu.com pkgs=<n> bytes=<b> seconds=<s> kBps=<r> complete=<yes|no|skipped> reason=<...>
set -uo pipefail

PROBE_SECONDS="${PROBE_SECONDS:-90}"
HIST="${APT_HISTORY:-/var/log/apt/history.log}"
W="$(mktemp -d)"
trap 'sudo rm -rf "$W" 2>/dev/null || rm -rf "$W"' EXIT

emit() { echo "CLM0671-PROBE host=azure.archive.ubuntu.com $*"; exit 0; }

# لا يدفعُ المهمّةَ إلى حدِّ `timeout-minutes: 10`: CLM0671_JOB_T0 يُسجَّلُ قبلَ خطوةِ التثبيتِ
# (بعدَ checkout/setup/pnpm install بنحوِ 30–60 ث من بدءِ المهمّة). الميزانيةُ تنتهي عندَ T0+480 ث
# مخصومًا منها 30 ث للفهارس ⇒ المهمّةُ تنتهي قبلَ نحوِ 540 ث من بدئِها في أسوأِ تقدير.
if [[ -n "${CLM0671_JOB_T0:-}" ]]; then
  left=$(( 480 - ($(date +%s) - CLM0671_JOB_T0) - 30 ))
  (( left < PROBE_SECONDS )) && PROBE_SECONDS=$left
  (( PROBE_SECONDS < 10 )) && emit "pkgs=0 bytes=0 seconds=0 kBps=0 complete=skipped reason=job-time-budget"
fi

[[ -r "$HIST" ]] || emit "pkgs=0 bytes=0 seconds=0 kBps=0 complete=skipped reason=no-apt-history"

# آخرُ سطرِ «Install:» في سجلِّ apt = ما ثبّتَهُ `playwright install --with-deps` للتوّ.
# الصيغة: Install: name:arch (ver, automatic), name:arch (ver), ...
mapfile -t PKGS < <(grep '^Install: ' "$HIST" | tail -1 | sed 's/^Install: //' \
  | python3 -c '
import re, sys
for m in re.finditer(r"([a-z0-9][a-z0-9.+-]*):([a-z0-9]+) \(([^,)]+)", sys.stdin.read()):
    name = m.group(1) if m.group(2) in ("all", "amd64") else f"{m.group(1)}:{m.group(2)}"
    print(f"{name}={m.group(3)}")')
(( ${#PKGS[@]} > 0 )) || emit "pkgs=0 bytes=0 seconds=0 kBps=0 complete=skipped reason=no-install-line"
# للاختبار: يطبعُ القائمةَ المستخرجةَ ويخرجُ دونَ أيِّ اتّصالٍ شبكيّ.
if [[ "${PROBE_DRY_RUN:-}" == 1 ]]; then printf 'pkg %s\n' "${PKGS[@]}"; emit "pkgs=${#PKGS[@]} complete=skipped reason=dry-run"; fi

mkdir -p "$W/lists/partial" "$W/cache/archives/partial" "$W/dl" "$W/parts"
cat > "$W/azure.sources" <<'EOF'
Types: deb
URIs: http://azure.archive.ubuntu.com/ubuntu/
Suites: noble noble-updates noble-security
Components: main universe
Architectures: amd64
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF
APTOPTS=(-o "Dir::Etc::SourceList=/dev/null" -o "Dir::Etc::SourceParts=$W/parts"
         -o "Dir::State::Lists=$W/lists" -o "Dir::Cache=$W/cache" -o "APT::Sandbox::User=root"
         -o "Acquire::Retries=0" -o "Acquire::http::Timeout=15")
cp "$W/azure.sources" "$W/parts/azure.sources"

if ! sudo timeout 30 apt-get "${APTOPTS[@]}" update -qq >"$W/update.log" 2>&1; then
  emit "pkgs=${#PKGS[@]} bytes=0 seconds=0 kBps=0 complete=no reason=index-update-failed-or-30s"
fi

# حزمةً حزمةً ضمنَ موعدٍ نهائيٍّ مشترك: تعذُّرُ اسمٍ واحدٍ لا يُسقطُ القياسَ كلَّه.
start=$(date +%s.%N); deadline=$(( $(date +%s) + PROBE_SECONDS )); ok=0; failed=0; c=yes; r=ok
for p in "${PKGS[@]}"; do
  left=$(( deadline - $(date +%s) ))
  if (( left <= 0 )); then c=no; r="timeout-${PROBE_SECONDS}s"; break; fi
  ( cd "$W/dl" && sudo timeout "$left" apt-get "${APTOPTS[@]}" download "$p" >>"$W/dl.log" 2>&1 )
  case $? in
    0) ok=$((ok + 1)) ;;
    124) c=no; r="timeout-${PROBE_SECONDS}s"; break ;;
    *) failed=$((failed + 1)) ;;
  esac
done
end=$(date +%s.%N)
(( failed > 0 )) && [[ "$r" == ok ]] && r="pkg-failures-$failed"
# البايتاتُ كلُّها، بما فيها الملفُّ الجزئيُّ عندَ انتهاءِ المهلة.
bytes=$(sudo find "$W/dl" -type f -printf '%s\n' | awk '{s+=$1} END {print s+0}')
secs=$(python3 -c "print(round($end-$start,1))")
kbps=$(python3 -c "print(round(($bytes/1000)/max($end-$start,0.001),1))")
tail -3 "$W/dl.log" | sed 's/^/  probe: /'
emit "pkgs=${#PKGS[@]} ok=$ok failed=$failed bytes=$bytes seconds=$secs kBps=$kbps complete=$c reason=$r"

#!/usr/bin/env bash
# CLM-0671 — جولاتُ القياس: يعيدُ تشغيلَ مهامِّ e2e الثلاثِ **دونَ أيِّ تغيير** على تشغيلٍ مكتملٍ،
# مهمّةً تلوَ أخرى (GitHub لا يقبلُ إعادةَ مهمّةٍ بينما محاولةٌ أخرى من التشغيلِ نفسِهِ جارية)،
# ويسجّلُ لكلِّ محاولةٍ سطرًا في TSV. **ليسَ قراءةً فقط**: يُطلقُ إعاداتِ تشغيلٍ لمهامِّ e2e وحدَها.
#
# الاستعمال: bash rounds.sh <run_id> <rounds> <out.tsv>   (gh مُصادَق؛ المستودع skyosv10-art/wasla)
# يُلحِقُ بالملفِّ إن وُجد (للاستئناف)؛ أوّلُ سطرٍ رأسُ الأعمدة.
set -uo pipefail
R="${REPO:-skyosv10-art/wasla}"; RUN="$1"; ROUNDS="$2"; OUT="$3"
JOBS=(customer-mini-app-e2e driver-mini-app-e2e admin-portal-e2e)
[[ -s "$OUT" ]] || printf 'attempt\tjob\tjob_id\tconclusion\tstarted\tinstall_s\ttest\tb_need\tb_index\tb_archives\tb_hosts\tprobe\n' > "$OUT"

wait_run() { local s; for _ in $(seq 1 60); do s=$(gh run view "$RUN" --repo "$R" --json status --jq .status); [[ "$s" == completed ]] && return 0; sleep 20; done; return 1; }

record() { # $1 = job id
  local j="$1" meta log
  meta=$(gh api "repos/$R/actions/jobs/$j" --jq '[.run_attempt,.name,.id,.conclusion,.started_at,
    ([.steps[]|select(.name=="Install Playwright browsers")|((.completed_at|fromdate)-(.started_at|fromdate))]|first // ""),
    ([.steps[]|select(.name=="Run E2E + accessibility tests")|.conclusion]|first // "")]|@tsv')
  log=$(gh api --allow-escape-sequences "repos/$R/actions/jobs/$j/logs" | sed 's/\x1b\[[0-9;]*m//g')
  local sect; sect=$(sed -n '/Run npx playwright install/,/Run pnpm --filter/p' <<<"$log")
  local need idx arc hosts probe
  need=$(grep -oE 'Need to get [0-9.]+ [kM]B' <<<"$sect" | head -1)
  idx=$(grep -oE 'Fetched [0-9.]+ [kM]B in [^)]*\)' <<<"$sect" | sed -n 1p)
  arc=$(grep -oE 'Fetched [0-9.]+ [kM]B in [^)]*\)' <<<"$sect" | sed -n 2p)
  hosts=$(grep -oE 'Get:[0-9]+ https?://[^/ ]+' <<<"$sect" | awk '{print $2}' | sort -u | tr '\n' ',')
  probe=$(grep -oE 'CLM0671-PROBE .*' <<<"$log" | tail -1)
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$meta" "$need" "$idx" "$arc" "$hosts" "$probe" >> "$OUT"
  echo "$(cut -f1-7 <<<"$meta" | tr '\t' ' ') | $arc | ${probe#CLM0671-PROBE host=azure.archive.ubuntu.com }"
}

wait_run || { echo "run $RUN not completed" >&2; exit 1; }
for r in $(seq 1 "$ROUNDS"); do
  for name in "${JOBS[@]}"; do
    id=$(gh api "repos/$R/actions/runs/$RUN/jobs?per_page=100" --jq ".jobs[]|select(.name==\"$name\")|.id")
    gh run rerun "$RUN" --repo "$R" --job "$id" >/dev/null 2>&1 || { sleep 30; gh run rerun "$RUN" --repo "$R" --job "$id" >/dev/null || exit 1; }
    sleep 15; wait_run || exit 1
    nid=$(gh api "repos/$R/actions/runs/$RUN/jobs?per_page=100" --jq ".jobs[]|select(.name==\"$name\")|.id")
    [[ "$nid" != "$id" ]] || { echo "rerun of $name did not create a new job" >&2; exit 1; }
    record "$nid"
  done
done

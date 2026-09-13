#!/usr/bin/env bash
# validate-merge-blocking.sh — أيمنعُ الخطُّ الدمجَ فعلاً؟ (M0-25)
#
# ── لماذا يوجد هذا الملف ──────────────────────────────────────────────────
# فحصُ الحوكمةِ الثامنُ («CI مانعٌ») كان يُحتسَب **جزئيّاً دائماً**: يقرأ نصوصَ
# المستودعِ ويُعلِن صراحةً أنّه **لا يسأل عن رفضِ الدمجِ عندَ الإخفاقِ**، لأنّ ذلك
# إعدادٌ خارجَ المستودعِ كان `false` مقيساً في 2026-08-27 على GitLab.
#
# وقد تغيّرت الحقيقةُ تحتَه: الخطُّ الحيُّ GitHub Actions، والحمايةُ **27 سياقاً
# مطلوباً**، **والمنعُ مُبرهَنٌ بمحاولتَي دمجٍ حقيقيّتَينِ رُفِضتا بـ`405`** (M0-22E).
# فبقاءُ الفحصِ «جزئيّاً دائماً» صارَ **بخساً للحقيقةِ** بعدَ أن كان صدقاً فيها.
#
# ── وما الذي يُقاس هنا حقّاً ───────────────────────────────────────────────
# لا يُقاس «أنّ الحمايةَ مفعَّلةٌ» — فذلك إعدادٌ خارجَ المستودعِ لا يملكُ سكربتٌ
# محلّيٌّ إثباتَه. يُقاس ما **يملكُ المستودعُ إثباتَه**:
#
#   1) لقطةٌ مؤرَّخةٌ للحمايةِ مأخوذةٌ من الواجهةِ، بصيغةٍ معلومةٍ.
#   2) **والبابُ الحيُّ:** سياقاتُ اللقطةِ **تساوي** وظائفَ `ci.yml` بعدَ فردِ
#      المصفوفاتِ. فمَن أضافَ وظيفةً ولم يُسجِّلْها في الحمايةِ **يُرفَض دفعُه** —
#      وهذا بابٌ يُخفِق على تغييرٍ حقيقيٍّ لا على مرورِ زمنٍ.
#   3) `strict` و`enforce_admins` مُعلَنانِ صادقَينِ.
#   4) **برهانُ رفضٍ**: محاولةُ دمجٍ فعليّةٌ رُدَّت بـ`405`، بمرجعٍ خامٍّ حَيٍّ.
#
# والخروجُ `2` (جزئيٌّ مُعلَنٌ) حين تكون اللقطةُ **مؤرَّخةً لا حيّةً** — وهو الأصلُ.
# ويُصبح `0` إذا وُفِّرَ ملفُّ حمايةٍ حيٌّ في `WASLA_PROTECTION_JSON` وطابقَ اللقطةَ.
# **فالتخطّي لا يُجمَّل نجاحاً، والنجاحُ لا يُدَّعى بلا سؤالٍ حَيٍّ.**

set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 1

SNAP="docs/12-testing/MERGE_BLOCKING.json"
WF=".github/workflows/ci.yml"
RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'

fail() { printf '%s  - %s%s\n' "$RED" "$1" "$RST"; FAILS=$((FAILS+1)); }
FAILS=0

[[ -f "$SNAP" ]] || { printf '%s✗ منعُ الدمجِ:%s لا لقطةَ حمايةٍ — «%s» غيرُ موجودةٍ (سجلٌّ بلا قياسٍ).\n' "$RED" "$RST" "$SNAP"; exit 1; }
[[ -f "$WF"   ]] || { printf '%s✗ منعُ الدمجِ:%s لا خطَّ حيًّا — «%s» غيرُ موجودٍ.\n' "$RED" "$RST" "$WF"; exit 1; }

REG="docs/07-security/RISK_REGISTER.md"

OUT="$(python3 - "$SNAP" "$WF" "${WASLA_PROTECTION_JSON:-}" "$REG" <<'PY'
import json,sys,os,re,datetime
snap_p,wf_p,live_p=sys.argv[1],sys.argv[2],sys.argv[3]
reg_p=sys.argv[4] if len(sys.argv)>4 else ""
errs=[]; notes=[]
try: snap=json.load(open(snap_p,encoding='utf-8'))
except Exception as e: print("ERR|اللقطةُ ليست JSON صالحاً: %s"%e); sys.exit(0)

# البابُ 1: الصيغةُ
if snap.get("schema")!="wasla.merge-blocking/v1": errs.append("صيغةُ اللقطةِ غيرُ معلومةٍ (schema)")
for k in ("provider","repository","branch","measured_at","measured_from","protection","blocking_proofs"):
    if not snap.get(k): errs.append("حقلٌ ناقصٌ في اللقطةِ: %s"%k)
prot=snap.get("protection",{}) or {}
rsc=prot.get("required_status_checks",{}) or {}
ctx=rsc.get("contexts")
if not isinstance(ctx,list) or not ctx: errs.append("اللقطةُ بلا سياقاتٍ مطلوبةٍ")

# البابُ 2 — الحيُّ: سياقاتُ اللقطةِ = وظائفُ الخطِّ بعدَ فردِ المصفوفاتِ
try:
    import yaml
    wf=yaml.safe_load(open(wf_p,encoding='utf-8'))
    exp=[]
    for jid,j in (wf.get("jobs") or {}).items():
        base=j.get("name",jid)
        inc=((j.get("strategy") or {}).get("matrix") or {}).get("include")
        if inc: exp+= [ "%s (%s)"%(base,", ".join(str(v) for v in e.values())) for e in inc ]
        else: exp.append(base)
    if isinstance(ctx,list):
        miss=sorted(set(exp)-set(ctx)); extra=sorted(set(ctx)-set(exp))
        if miss: errs.append("وظائفُ في الخطِّ ليست سياقاتٍ مطلوبةً (%d): %s"%(len(miss)," · ".join(miss[:4])))
        if extra: errs.append("سياقاتٌ مطلوبةٌ لا وظيفةَ لها في الخطِّ (%d): %s"%(len(extra)," · ".join(extra[:4])))
        if not miss and not extra: notes.append("%d سياقاً مطلوباً تُطابق وظائفَ الخطِّ حرفاً بحرفٍ"%len(ctx))
except ImportError:
    notes.append("تعذّر فردُ المصفوفاتِ: وحدةُ yaml غيرُ متاحةٍ — البابُ الثاني لم يُقَسْ")
    errs.append("__PARTIAL_NO_YAML__")

# البابُ 3
if rsc.get("strict") is not True: errs.append("strict ليس true في اللقطةِ (الفرعُ قد يُدمَج قديماً)")
if prot.get("enforce_admins") is not True: errs.append("enforce_admins ليس true (المالكُ يتجاوزُ الحارسَ)")

# البابُ 4: برهانُ رفضٍ
proofs=[p for p in (snap.get("blocking_proofs") or []) if p.get("http_status")==405 and p.get("message") and p.get("raw")]
if not proofs: errs.append("لا برهانَ رفضٍ: لا محاولةَ دمجٍ رُدَّت بـ405 بمرجعٍ خامٍّ")
for p in proofs:
    if not os.path.exists(p["raw"]): errs.append("مرجعُ برهانِ الرفضِ ميتٌ: %s"%p["raw"])
if proofs: notes.append("%d محاولةَ دمجٍ رُدَّت فعلاً بـ405"%len(proofs))

# البابُ 5: السؤالُ الحيُّ إن وُفِّر
live_ok=False
# العيبُ المقيسُ (M0-29): طلبُ سؤالٍ حيٍّ **يُهمَلُ صامتاً** إن ضاعَ ملفُّه:
# من صدَّرَ WASLA_PROTECTION_JSON طالباً قياساً حيّاً ثمَّ فشلَ جلبُهُ كانَ يُكافَأُ بـ«جزئيٍّ
# مُعلَنٍ» المُطمئنِّ لا بـ«لم أقدرْ أن أقيسَ». فطلبُ القياسِ صارَ مُلزِماً لطالبِه.
if live_p and not os.path.exists(live_p):
    errs.append("طُلِبَ سؤالٌ حيٌّ ولم يُوجدْ ملفُّه: WASLA_PROTECTION_JSON=%s — لا يُكافَأُ قياسٌ مفقودٌ بتخطٍّ"%live_p)
elif live_p and os.path.exists(live_p):
    try:
        live=json.load(open(live_p,encoding='utf-8'))
        # جوابُ خطأٍ من الواجهةِ (403/404/…) ليسَ «انحرافاً» بل **تعذُّرَ قياسٍ**: يُسمَّى باسمِه.
        if isinstance(live,dict) and live.get("message") and not live.get("required_status_checks"):
            errs.append("الجوابُ الحيُّ جوابُ خطأٍ لا حمايةٌ [%s]: %s"%(live.get("status","?"),str(live.get("message"))[:160]))
        else:
            lctx=sorted((live.get("required_status_checks") or {}).get("contexts") or [])
            if lctx and isinstance(ctx,list) and lctx==sorted(ctx) and \
               (live.get("enforce_admins") or {}).get("enabled") is True:
                live_ok=True; notes.append("سُئلت الواجهةُ حيّاً وطابقت اللقطةَ")
            else: errs.append("الحمايةُ الحيّةُ لا تطابقُ اللقطةَ — انحرافٌ في إعدادٍ خارجَ المستودعِ")
    except Exception as e: errs.append("ملفُّ الحمايةِ الحيُّ غيرُ مقروءٍ: %s"%e)

# البابُ 6: قياساتٌ حيّةٌ مُسجَّلةٌ في اللقطةِ — أدلّةُ النفيِ لا تُطرَحُ
# العيبُ المقيسُ (M0-29 · 2026-09-13): قُيِسَ أنَّ الحمايةَ **اختفت**
# (GET /branches/main → "protected": false · /protection → 403 «ارقَ إلى Pro»)، ولم يكنِ
# للحارسِ **موضعٌ يقرأُ فيه قياساً مُسجَّلاً**، فكانَ يطمأنُّ بـ«لم تُسألِ الواجهةُ»
# حينَ الحقُّ أنَّها سُئلت وأجابت بالنفيِ. فصارَ `live_checks` حقلاً أوّليّاً:
# أحدَثُ قياسٍ يحكمُ. وقياسٌ سلبيٌّ يُسقِطُ البوّابةَ **إلّا** أن يكونَ مقبولاً
# بسطرِ خطرٍ مالكٍ مؤرَّخٍ غيرِ منتهٍ — وهي الصيغةُ القائمةُ نفسُها لقبولِ المخاطرِ
# لا صيغةٌ ثانيةٌ، وهي تنقضي بنفسِها بـ`review:`. لا بابَ إسكاتٍ عُرياً.
live_checks=snap.get("live_checks")
live_neg=None
if live_checks is not None:
    if not isinstance(live_checks,list) or not live_checks:
        errs.append("live_checks موجودٌ وليسَ قائمةً غيرَ فارغةٍ")
    else:
        for i,c in enumerate(live_checks):
            if not isinstance(c,dict): errs.append("live_checks[%d] ليسَ كائناً"%i); continue
            for k in ("measured_at","measured_from","protected","raw"):
                if c.get(k) is None: errs.append("live_checks[%d] حقلٌ ناقصٌ: %s"%(i,k))
            if c.get("raw") and not os.path.exists(c["raw"]):
                errs.append("مرجعُ القياسِ الحيِّ ميتٌ: %s"%c["raw"])
        dated=[c for c in live_checks if isinstance(c,dict) and c.get("measured_at")]
        if dated:
            newest=sorted(dated,key=lambda c:str(c["measured_at"]))[-1]
            if newest.get("protected") is True:
                notes.append("أحدثُ قياسٍ حيٍّ مُسجَّلٍ (%s): الفرعُ محميٌّ"%newest["measured_at"])
            else:
                live_neg=newest
        else:
            errs.append("live_checks بلا أيِّ قياسٍ مؤرَّخٍ")

if live_neg is not None:
    rid=live_neg.get("accepted_risk")
    why="أحدثُ قياسٍ حيٍّ مُسجَّلٍ (%s) يقولُ: **الفرعُ غيرُ محميٍّ** — %s"%(
        live_neg.get("measured_at"),str(live_neg.get("note") or live_neg.get("measured_from") or "")[:120])
    if not rid:
        errs.append(why+" · ولا سطرَ خطرٍ يقبلُه (accepted_risk)")
    else:
        line=None
        try:
            for ln in open(reg_p,encoding='utf-8'):
                if ln.strip().startswith(rid+" |"): line=ln.strip(); break
        except Exception as e:
            errs.append("تعذَّرَ قراءةُ سجلِّ المخاطرِ: %s"%e)
        if line is None:
            errs.append(why+" · والخطرُ المُحالُ عليه ليسَ في السجلِّ: %s"%rid)
        else:
            m=re.search(r'review:(\d{4}-\d{2}-\d{2})',line)
            st=re.search(r'status:(\w+)',line)
            today=datetime.date.today().isoformat()
            if st and st.group(1)=="closed":
                errs.append(why+" · والخطرُ %s مُغلَقٌ: لا يقبلُ شيئاً"%rid)
            elif not m:
                errs.append(why+" · وسطرُ الخطرِ %s بلا review:"%rid)
            elif m.group(1) < today:
                errs.append(why+" · ومهلةُ الخطرِ %s انتهت (review:%s)"%(rid,m.group(1)))
            else:
                print("NEG|"+why+" · مقبولٌ مؤقَّتاً بـ%s حتّى %s"%(rid,m.group(1)))

for e in errs: print("ERR|"+e)
for n in notes: print("OK|"+n)
print("LIVE|%s"%("1" if live_ok else "0"))
print("AT|%s"%snap.get("measured_at",""))
PY
)"

PARTIAL_NO_YAML=0
while IFS='|' read -r kind msg; do
  case "$kind" in
    ERR) if [[ "$msg" == "__PARTIAL_NO_YAML__" ]]; then PARTIAL_NO_YAML=1; else fail "$msg"; fi ;;
    OK)  printf '%s  ✓ %s%s\n' "$GRN" "$msg" "$RST" ;;
    NEG) NEG=1; NEG_MSG="$msg" ;;
    LIVE) LIVE="$msg" ;;
    AT)  AT="$msg" ;;
  esac
done <<< "$OUT"

if (( FAILS > 0 )); then
  printf '%s✗ منعُ الدمجِ:%s %d عيباً — الحمايةُ المُعلَنةُ لا تُطابق ما تدّعيه الوثائقُ.\n' "$RED" "$RST" "$FAILS"
  printf '%s  المرجع: %s · docs/12-testing/M0-22E_GATE.md%s\n' "$DIM" "$SNAP" "$RST"
  exit 1
fi

if (( PARTIAL_NO_YAML == 1 )); then
  printf '%s⊘ منعُ الدمجِ — جزئيٌّ:%s البابُ الحيُّ (مطابقةُ الوظائفِ بالسياقاتِ) لم يُقَسْ: وحدةُ yaml غيرُ متاحةٍ.\n' "$YLW" "$RST"
  exit 2
fi

# قياسٌ سلبيٌّ مقبولٌ بخطرٍ سارٍ: لا يُجمَّلُ نجاحاً أبداً — ولا يُقالُ «لم تُسألِ الواجهةُ».
if (( ${NEG:-0} == 1 )); then
  printf '%s⊘ منعُ الدمجِ — الحمايةُ مقيسةٌ غائبةً:%s %s\n' "$YLW" "$RST" "${NEG_MSG:-}"
  printf '%s  فلا يُدّعَى أنَّ الدمجَ ممنوعٌ اليومَ: الأبوابُ أعلاهُ تقيسُ اتّساقَ لقطةٍ مؤرَّخةٍ بالخطِّ لا سريانَها.%s\n' "$DIM" "$RST"
  exit 2
fi

if [[ "${LIVE:-0}" == "1" ]]; then
  printf '%s✓ منعُ الدمجِ:%s الحمايةُ مطابقةٌ للخطِّ · مُبرهَنةٌ بردٍّ 405 · **وسُئلت حيّاً**.\n' "$GRN" "$RST"
  exit 0
fi

printf '%s⊘ منعُ الدمجِ — جزئيٌّ مُعلَنٌ:%s الأبوابُ الأربعةُ نجحت على **لقطةٍ مؤرَّخةٍ** (%s)، ولم تُسأل الواجهةُ حيّاً.\n' "$YLW" "$RST" "${AT:-?}"
printf '%s  والحيُّ يُسأل بتصدير WASLA_PROTECTION_JSON إلى ملفِّ ردِّ /branches/main/protection.%s\n' "$DIM" "$RST"
exit 2

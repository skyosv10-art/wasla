# T2 — Webhook Telegram إلى بوتِ العميلِ محلّيًّا، بلا Render (CLM-0635)

> **الحالة:** إجراءٌ جاهزٌ وفحوصُه آليّةٌ — **لا يُنفَّذُ الشقُّ الذي يلمسُ Telegram** (`register` · `info`) قبلَ أن يعتمدَ المالكُ البندَ T2 صراحةً (`test_plan_items.T2.approved=true` + `approval` في `infra/render/deploy-target.json` بـPR مُراجَعٍ). الأداةُ ترفضُ قبلَ ذلك ولا ترسلُ شيئًا.
> **الأداة:** [`scripts/test-env/t2_local.py`](../../scripts/test-env/t2_local.py) · فحصُها الذاتيُّ (16 حالةً، بلا شبكة) جزءٌ من `validate-render-deploy-target.sh` المُلزِم.
> **T1 مؤجَّلٌ** حتى يُوصَلَ `buildAppWithEdge` في `bots/customer-bot/src/main.ts` ويُصحَّحَ `allowlistUrl` وتنجحَ اختباراتُهما.
> **تحديثٌ مؤرَّخٌ (CLM-0691 · 2026-10-25):** وصَلَ الترطيبُ (وحدةُ D6) وقُيِسَ بالحارسِ 29 (`validate-edge-wiring.sh` وطفراتُه M1–M4)، و`allowlistUrl` كانَ قد أُصلِحَ في CLM-0662 (#809). المتبقي لاعتمادِ T1 قرارُ المالكِ (`approved=false` + `approval=null`) وقياسٌ من البيئةِ الحيّةِ — لا اختبارٌ محلّيٌّ بديلٌ عنها.

## ما يُثبتُه T2 وما لا يُثبتُه

| يُثبتُ | لا يُثبتُ |
|---|---|
| أنّ Telegram الحقيقيَّ يسلّمُ تحديثًا إلى عنوانِ HTTPS عامٍّ (نفقٌ) فيصلُ إلى بوتٍ يعملُ على هذا الجهاز | أيَّ شيءٍ عن Render أو قاعدةِ الإنتاج |
| أنّ البوتَ يرفضُ بـ`401 CHANNEL_UNAUTHORIZED_WEBHOOK` طلبًا بلا `X-Telegram-Bot-Api-Secret-Token` أو بقيمةٍ خاطئة، ويقبلُ طلبَ Telegram الذي يحملُ القيمةَ المسجَّلة | الـMini App أو حدَّ القناة (T1) |
| أنّ البوتَ يصلُ إلى خدمةِ الهويّةِ المحلّيّةِ بمفتاحِ خدمةٍ مولَّدٍ للاختبار | أنّ رمزَ البوتِ رمزُ اختبارٍ — هذا تصريحُ المالكِ |

## المتطلّبات

Node 20 + pnpm 9 (`pnpm install`) · Docker أو PostgreSQL 17 محلّيّ · أداةُ نفقِ HTTPS مجّانيّةٌ تعملُ بلا حساب (مثلًا `cloudflared tunnel --url http://127.0.0.1:18083`) · رمزُ **بوتِ اختبارٍ** من المالك.

**تنبيهٌ عن الرمز:** تسجيلُ Webhook لرمزٍ يستبدلُ أيَّ Webhook سابقٍ له. إن كان الرمزُ نفسُه مستعمَلًا في خدمةِ Render `wasla-customer-bot`، فسيتوقّفُ تسليمُ Telegram إليها، واستعادتُها تحتاجُ سرَّ Render (لا يقرؤه هذا الإجراء). **المفضَّلُ:** بوتُ اختبارٍ مخصَّصٌ لـT2 — وهذا قرارُ المالك.

## الخطوات

```bash
# 1) ملفّاتُ الاختبار (خارجَ المستودع، صلاحيّة 600): مفتاحُ خدمةٍ t2test-* جديدٌ، سرُّ Webhook عشوائيٌّ (48)، كلمةُ مرورِ PG عشوائيّة
python3 scripts/test-env/t2_local.py init ~/.wasla-t2
#    ثمّ ضعْ رمزَ بوتِ الاختبارِ في ~/.wasla-t2/bot.env  (CUSTOMER_BOT_TOKEN=)

# 2) PostgreSQL مؤقّتٌ معزولٌ على 127.0.0.1 فقط
docker run -d --name wasla-t2-pg --env-file ~/.wasla-t2/pg.env -p 127.0.0.1:55432:5432 postgres:17

# 3) فحصُ ما قبلَ التشغيل — يرفضُ أيَّ قاعدةٍ غيرِ محلّيّةٍ أو مشروعِ Supabase، ومفاتيحَ غيرِ t2test-*، و NODE_ENV=production،
#    وعنوانَ Render، ومفتاحَ توقيعِ T1. لا يطبعُ أيَّ قيمة.
python3 scripts/test-env/t2_local.py preflight ~/.wasla-t2

# 4) ترحيلُ الهويّةِ ثمّ تشغيلُها (نافذةٌ أولى)
(set -a; . ~/.wasla-t2/identity.env; set +a; pnpm --filter @wasla/identity-service db:migrate && pnpm --filter @wasla/identity-service start)

# 5) تشغيلُ البوت (نافذةٌ ثانية) — يستمعُ على 18083
(set -a; . ~/.wasla-t2/bot.env; set +a; cd bots/customer-bot && node --import tsx src/main.ts)

# 6) النفق (نافذةٌ ثالثة) → يطبعُ https://<random>.trycloudflare.com
cloudflared tunnel --url http://127.0.0.1:18083

# 7) فحصٌ سلبيٌّ عبرَ النفقِ (لا يلمسُ Telegram): بلا سرٍّ وبسرٍّ خاطئٍ → 401 كلاهما
python3 scripts/test-env/t2_local.py probe https://<random>.trycloudflare.com ~/.wasla-t2

# ── يتوقّفُ هنا حتى اعتمادِ T2 ──
# 8) تسجيلُ Webhook (يرفضُ ما لم يُعتمَدْ T2 ويَنجحِ الفحصُ ويكنِ العنوانُ https غيرَ Render)
python3 scripts/test-env/t2_local.py register https://<random>.trycloudflare.com ~/.wasla-t2
# 9) أرسلْ /start إلى بوتِ الاختبارِ من حسابِ Telegram، ثمّ:
python3 scripts/test-env/t2_local.py info ~/.wasla-t2      # pending_update_count=0 · last_error_message=null

# 10) التنظيف
curl -s "https://api.telegram.org/bot$(grep ^CUSTOMER_BOT_TOKEN= ~/.wasla-t2/bot.env | cut -d= -f2)/deleteWebhook" >/dev/null
docker rm -f wasla-t2-pg && rm -rf ~/.wasla-t2
```

## معيارُ النجاحِ والدليلُ المطلوب

1. `preflight: PASS`.
2. `probe`: HTTP 401 للحالتين.
3. سجلُّ البوتِ يُظهرُ `POST /channel/customer/webhook` بـ200 لتحديثِ Telegram الحقيقيِّ، وردٌّ وصلَ إلى المحادثة.
4. `info`: `last_error_message=null`.
5. لا قيمةَ سرّيّةً في أيِّ سجلٍّ يُحفَظ (رمزٌ · سرٌّ · كلمةُ مرورٍ · رابطُ اتصالٍ).

يُحفَظُ الدليلُ في `docs/12-testing/ci-evidence/<ts>-t2-local/` مع رأسِ main المستعمَل.

## ما جُرِّبَ فعلًا في CLM-0635

[تشغيلٌ جافٌّ](ci-evidence/2026-10-19T200000Z-clm-0635-deploy-purpose-gate/raw/t2-local-dry-run.txt) في بيئةِ الوكيلِ بلا PostgreSQL، ولذلك البوتُ وحدَه، بمخزنِ إعادةِ التشغيلِ في الذاكرةِ وبرمزٍ مزيّفٍ:
- `preflight` PASS؛
- طلبٌ بلا سرٍّ وبسرٍّ خاطئٍ → 401 كلاهما؛
- `/health` → 200؛
- `register` مرفوضٌ لأنّ T2 غيرُ معتمَد.

**لم يُجرَّبْ** ترحيلُ الهويّةِ على PostgreSQL، ولا النفقُ، ولا أيُّ تسليمٍ من Telegram.

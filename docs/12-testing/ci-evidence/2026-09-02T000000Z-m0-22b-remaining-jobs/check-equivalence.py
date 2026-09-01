#!/usr/bin/env python3
"""مُدقِّقُ تكافؤِ الوظائفِ العشرينَ بينَ `.gitlab-ci.yml` و`.github/workflows/ci.yml`.

يُشغَّلُ من جذرِ المستودعِ:  python3 docs/12-testing/ci-evidence/2026-09-02T000000Z-m0-22b-remaining-jobs/check-equivalence.py
ويُخرِجُ الجدولَ المحفوظَ في `equivalence.txt`. يُوقِفُ نفسَه إن اختلَّ الاقترانُ
بينَ المجموعتَين، فلا تمرُّ وظيفةٌ منسيّةٌ ولا ساقٌ زائدةٌ. رمزُ الخروجِ 1 عندَ أيِّ فرق.
"""
import sys, yaml

gl = yaml.safe_load(open('.gitlab-ci.yml', encoding='utf-8'))
gh = yaml.safe_load(open('.github/workflows/ci.yml', encoding='utf-8'))

src = {}
for k, v in gl.items():
    if isinstance(v, dict) and v.get('extends') == '.db-integration-base':
        sv = v['services'][0]['variables']
        var, url = list(v['variables'].items())[0]
        src[k] = {'db': sv['POSTGRES_DB'], 'img': v['services'][0]['name'],
                  'var': var, 'url': url, 'script': v['script']}

tgt = {}
for jn in ('db-integration', 'exit-gate-e2e'):
    j = gh['jobs'][jn]
    cmd = 'test:integration' if jn == 'db-integration' else 'test'
    for m in j['strategy']['matrix']['include']:
        tgt[(jn, m['leg'])] = {
            'db': m['db'], 'img': j['services']['postgres']['image'],
            'var': m.get('var', 'DATABASE_URL'),
            'url': f"postgres://postgres:postgres@postgres:5432/{m['db']}",
            'script': ['pnpm install --frozen-lockfile', f"pnpm --filter {m['pkg']} {cmd}"]}

PAIR = {
    'db-integration': ('db-integration', 'identity'),
    'geography-db-integration': ('db-integration', 'geography'),
    'channel-db-integration': ('db-integration', 'channel'),
    'customer-db-integration': ('db-integration', 'customer'),
    'order-db-integration': ('db-integration', 'order'),
    'matching-db-integration': ('db-integration', 'matching'),
    'dispatch-db-integration': ('db-integration', 'dispatch'),
    'drivers-db-integration': ('db-integration', 'drivers'),
    'negotiations-db-integration': ('db-integration', 'negotiations'),
    'reputation-db-integration': ('db-integration', 'reputation'),
    'subscriptions-db-integration': ('db-integration', 'subscriptions'),
    'marketplace-db-integration': ('db-integration', 'marketplace'),
    'channel-exit-gate-e2e': ('exit-gate-e2e', 'channel'),
    'customer-exit-gate-e2e': ('exit-gate-e2e', 'customer'),
    'order-exit-gate-e2e': ('exit-gate-e2e', 'order'),
    'dispatch-exit-gate-e2e': ('exit-gate-e2e', 'dispatch'),
    'driver-exit-gate-e2e': ('exit-gate-e2e', 'driver'),
    'negotiations-exit-gate-e2e': ('exit-gate-e2e', 'negotiation'),
    'subscription-exit-gate-e2e': ('exit-gate-e2e', 'subscription'),
    'marketplace-exit-gate-e2e': ('exit-gate-e2e', 'marketplace'),
}
assert set(PAIR) == set(src), f"اختلَّ الاقترانُ من جهةِ GitLab: {set(src) ^ set(PAIR)}"
assert set(PAIR.values()) == set(tgt), f"اختلَّ الاقترانُ من جهةِ GitHub: {set(tgt) ^ set(PAIR.values())}"

FIELDS = ('db', 'img', 'var', 'url', 'script')
bad = 0
print(f"{'GitLab job':32} {'GitHub leg':28} db  img  var  url  script")
for g, t in PAIR.items():
    a, b = src[g], tgt[t]
    r = [a[f] == b[f] for f in FIELDS]
    bad += not all(r)
    print(f"{g:32} {t[0]+'/'+t[1]:28} " + "  ".join('OK ' if x else 'DIFF' for x in r))
    for f, ok in zip(FIELDS, r):
        if not ok:
            print(f"     {f}: gitlab={a[f]!r}  github={b[f]!r}")
print(f"\n{len(PAIR)} وظيفةً · {len(PAIR)-bad} مطابقةٌ في الحقولِ الخمسةِ · {bad} مختلفةٌ")
sys.exit(1 if bad else 0)

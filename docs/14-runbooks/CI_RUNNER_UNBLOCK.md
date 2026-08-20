# Runbook — فكّ عائق CI (Shared Runners)

> **Scope:** كيفية حلّ العائق الوحيد المتبقّي لـ Phase 00 Exit Gate: «CI passes».
>
> **المشكلة:** GitLab shared runners غير متاحة للـ namespace المجاني غير المُتحقَّق منه. pipelines تفشل فوراً بـ0 وظائف منفّذة (created_at == finished_at). مؤكد منذ 2026-08-19.
>
> **Last Updated:** 2026-08-20 · **Status:** Active · **Related Team:** Team 10 — DevOps · مالك المشروع

---

## 1. ملخّص الحالة

- جميع معايير Phase 00 Exit Gate **مكتملة هندسياً** (لا أسرار، clone/build/test، Docs structure، main محمي، MR template) — مدمجة في main.
- المعيار الوحيد المتبقّي **«CI passes»** يتطلب تشغيل pipeline فعلياً على GitLab، وهذا محجوب بعدم توفّر runners.
- **محاولة runner خاص من بيئة التنفيذ الحالية فشلت**: Docker يُثبَّت والـ daemon يبدأ بـ`--bridge=none`، لكن (1) بيئة التنفيذ تُنهي العمليات الخلفية بين الأوامر فلا يستمر الـ daemon، و(2) bridge networking / iptables غير مدعوم. لذا **لا يمكن استضافة runner دائم من هذه البيئة** — يتطلب جهازاً مستمراً.

---

## 2. مسارا الحلّ الدائمان

### المسار 1 — التحقق من الـ namespace (الأبسط، موصى به)

تفعيل shared runners بشكل دائم عبر التحقق من namespace:

1. افتح https://gitlab.com/-/user_settings/billing
2. أضف وسيلة دفع (payment method) — **لا تُخصم رسوم** على الخطة المجانية؛ الهدف التحقق فقط.
3. أكّد التحقق إن طُلب: https://gitlab.com/users/namespace/verify
4. بعد التحقق، تعمل shared runners تلقائياً على كل pipelines.

بعد ذلك: شغّل pipeline على `main` (أو افتح MR) — يجب أن تجتاز jobs الـ `validate` و`build-test`.

### المسار 2 — runner خاص مستضاف على جهاز مستمر

إذا لم ترغب بالتحقق من namespace، شغّل runner خاص على جهاز دائم (وليس بيئة تنفيذ مؤقتة):

1. على جهاز به Docker مثبّت ويعمل بشكل دائم:
   ```bash
   docker run -d --name gitlab-runner --restart always \
     -v /srv/gitlab-runner/config:/etc/gitlab-runner \
     -v /var/run/docker.sock:/var/run/docker.sock \
     gitlab/gitlab-runner:latest
   ```
2. سجّل الـ runner للمنفذ `https://gitlab.com/` باستخدام **registration token** الخاص بالمشروع
   (إعدادات المشروع → Settings → CI/CD → Runners → «New project runner»).
3. فعّل الـ runner ليعمل على الـ jobs غير الموسومة (untagged jobs).
4. شغّل pipeline على `main` — يتولّى الـ runner تنفيذ jobs الـ `validate` و`build-test`.

> ملاحظة: registration token يُسترجع من إعدادات المشروع (يتطلب صلاحية Maintainer/Owner). لا يُخزَّن في المستودع.

---

## 3. التحقق من نجاح الحلّ

بعد تطبيق أحد المسارين، شغّل pipeline على `main` وتأكّد:

| Job | المرحلة | المتوقّع |
|---|---|---|
| `repo-structure` | validate | ✅ pass (فحص الملفات الإلزامية + الأسرار) |
| `doc-coverage` | validate | ✅ pass (على merge_request_event) |
| `markdown-lint` | validate | allow_failure |
| `build-test` | build | ✅ pass (typecheck + test عبر pnpm) |

عند اجتياز الـ pipeline فعلياً على `main` → اعتماد **Phase 00 = Completed** → يبدأ **W0** رسمياً.

---

## 4. ما لا يجب فعله

- ❌ تخطّي Exit Gate دون اجتياز CI فعلي (مخالف لـ [ENGINEERING_DOCUMENTATION_LAW.md §4](../00-rules/ENGINEERING_DOCUMENTATION_LAW.md)).
- ❌ تعديل jobs الـ CI لاستيعاب قيود بيئة التنفيذ المؤقتة (الـ jobs مصمّمة لصور alpine/node القياسية).
- ❌ اعتبار «الكود يعمل محلياً» اجتيازاً للـ Exit Gate — CI يجب أن يجتاز فعلياً على GitLab.

---

## 5. العلاقة مع خارطة الطريق

المسار الحرج ([ROADMAP §4](../16-progress/ROADMAP.md)): `00 → 01 → 02 → 04 → 06 → 07 → 09 → 20 (Launch)`.
العائق الحالي يحجب انتقال Phase 00 → Completed فقط. بمجرد حلّه، يُتابع التنفيذ وفق التسلسل الطبيعي.

راجع: [HANDOFF_NEXT_STEPS.md](../16-progress/HANDOFF_NEXT_STEPS.md) · [ADR-003](../15-decisions/ADR-003-monorepo-tooling.md) · [MASTER_PROGRESS.md](../16-progress/MASTER_PROGRESS.md)

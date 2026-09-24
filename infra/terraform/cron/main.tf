# ── WASLA tick scheduler — Render Cron Jobs (G8 · CLM-0328) ─────────────
#
# ينشرُ خمسَ وظائفَ مجدوَلةٍ (Render Cron Jobs) تشغّلُ `scripts/tick-scheduler.mjs`
# على فتراتٍ منتظمةٍ. كلُّ وظيفةٍ تنفِّذُ دورةَ نبضةٍ واحدةٍ لخدمةٍ واحدةٍ.
#
# لماذا جذرٌ مستقلٌّ (مثل apps/)؟ لأنَّ حالةَ terraform للجذرِ الأصليِّ
# (`infra/terraform/render.tf`) كانت محليّةً ولم تُحفَظ (انظر apps/main.tf).
# إضافةُ مواردٍ جديدةٍ إلى `render.tf` ستُحاول إنشاءَ الخدماتِ الـ16 الموجودةِ
# أصلًا. فبدلَ ذلك، هذا الجذرُ ينشرُ وظائفِ cron الجديدةَ وحدَها.
#
# Render Cron Jobs (Free tier):
#   - الحدُّ الأدنى للفاصلِ: ساعةٌ واحدةٌ
#   - تُحسَبُ ضمنَ ساعاتِ المثيلِ المجانيّةِ (750 ساعة/شهر)
#   - تُشغَّلُ من نفسِ صورةِ Docker المستخدَمةِ للخدماتِ
#
# المفاتيحُ من البيئةِ فقط (RENDER_API_KEY · RENDER_OWNER_ID) — لا تُكتب هنا أبدًا.

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    render = {
      source  = "render-oss/render"
      version = "1.9.1"
    }
  }
}

provider "render" {}

locals {
  source_repo = "https://github.com/skyosv10-art/wasla"
  branch      = "main"

  # كلُّ النبضاتِ الـ5 — مقيسٌ من packages/authz-policy/src/operations.ts
  ticks = [
    { service = "dispatch",      schedule = "*/5 * * * *", command = "node scripts/tick-scheduler.mjs" },
    { service = "negotiations",  schedule = "*/5 * * * *", command = "node scripts/tick-scheduler.mjs" },
    { service = "reputation",    schedule = "*/10 * * * *", command = "node scripts/tick-scheduler.mjs" },
    { service = "subscriptions", schedule = "*/10 * * * *", command = "node scripts/tick-scheduler.mjs" },
    { service = "drivers",       schedule = "*/5 * * * *", command = "node scripts/tick-scheduler.mjs" },
  ]
}

# ─ـ Render Cron Jobs ───────────────────────────────────────────────────

resource "render_cron_job" "tick_scheduler" {
  for_each = { for t in local.ticks : t.service => t }

  name     = "wasla-tick-${each.value.service}"
  region   = var.render_region
  plan     = var.render_plan
  schedule = each.value.schedule

  runtime_source = {
    docker = {
      repo_url        = local.source_repo
      branch          = local.branch
      dockerfile_path = "Dockerfile"
      context         = "."
      auto_deploy     = true
    }
  }

  # ينفِّذُ مُجدوِلَ النبضاتِ لخدمةٍ واحدةٍ في كلِّ مرّةٍ
  docker_command = each.value.command

  env_vars = {
    NODE_ENV                          = { value = var.environment == "staging" ? "staging" : "production" }
    WASLA_SERVICE                     = { value = "@wasla/tick-scheduler" }
    WASLA_SERVICE_AUTH_KEYS           = { value = var.wasla_service_auth_keys }
    WASLA_SERVICE_AUTH_ACTIVE_KID    = { value = var.wasla_service_auth_active_kid }
    WASLA_TICK_SERVICES               = { value = each.value.service }
    WASLA_TICK_BASE_URL_DISPATCH      = { value = "https://wasla-dispatch.onrender.com" }
    WASLA_TICK_BASE_URL_NEGOTIATIONS  = { value = "https://wasla-negotiations.onrender.com" }
    WASLA_TICK_BASE_URL_REPUTATION    = { value = "https://wasla-reputation.onrender.com" }
    WASLA_TICK_BASE_URL_SUBSCRIPTIONS = { value = "https://wasla-subscriptions.onrender.com" }
    WASLA_TICK_BASE_URL_DRIVERS       = { value = "https://wasla-drivers.onrender.com" }
    WASLA_TICK_TIMEOUT_MS             = { value = "30000" }
    WASLA_TICK_LOG_LEVEL              = { value = "info" }
  }
}

variable "render_region" {
  type    = string
  default = "oregon"
}

variable "render_plan" {
  type    = string
  default = "free"
}

variable "environment" {
  type    = string
  default = "staging"
}

variable "wasla_service_auth_keys" {
  type      = string
  sensitive = true
}

variable "wasla_service_auth_active_kid" {
  type      = string
  sensitive = true
}

output "cron_job_names" {
  value       = [for job in render_cron_job.tick_scheduler : job.name]
  description = "أسماءُ وظائفِ cron المنشورةِ — يجب أن يطابقَها حارسُ الحوكمةِ."
}

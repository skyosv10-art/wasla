# LEGACY-ONLY (CLM-0502): outputs are legacy hosts; never applied. The live source of observability targets is infra/observability/targets/ (ADR-068)
# ── WASLA Observability — M2-08 Stage B (ADR-041) ──────────────────────────
#
# ينشرُ بنيةَ المراقبةِ القابلةِ للرصدِ على Render staging:
#   1. Prometheus — يجمعُ مقاييسَ /metrics من الخدماتِ الأربعَ عشرةَ
#   2. Alertmanager — يُقيِّمُ قواعدَ الإنذارِ (PromQL من SLI_BASELINE)
#   3. OTLP Collector — يستقبلُ آثارَ OpenTelemetry من الخدماتِ
#
# لماذا جذرٌ مستقلٌّ (مثل apps/ وcron/)؟ لأنَّ حالةَ terraform للجذرِ
# الأصليِّ (render.tf) كانت محليّةً ولم تُحفَظ — إضافةُ مواردَ جديدةٍ
# ستُحاول إنشاءَ الخدماتِ الموجودةِ. هذا الجذرُ ينشرُ مواردَ المراقبةِ وحدَها.
#
# Render: خدماتُ Docker على الخطّةِ المجانيّةِ (free) — تكفي للقياسِ التركيبيِّ.
# القيودُ المعلَنةٌ (ADR-039): لا شبكةٌ خاصّةٌ، ينامُ بعدَ 15 دقيقةِ خمولٍ،
# لا قرصٌ ثابتٌ (البياناتُ تُفقدُ عندَ إعادةِ التشغيلِ).
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

# ── M6-18C (CLM-0403): alert destination + Alertmanager authentication ──────
# The containers now fail closed without these values (see the entrypoints in
# infra/observability/). They are passed in at apply time and never written here.
variable "telegram_bot_token" {
  description = "Telegram bot token of the primary on-call bot (driver bot)."
  type        = string
  sensitive   = true
}
variable "telegram_chat_id" {
  description = "Telegram chat id of the primary on-call recipient (integer)."
  type        = string
  sensitive   = true
}
variable "am_basic_auth_password" {
  description = "Password Prometheus uses to reach Alertmanager (user wasla-prometheus)."
  type        = string
  sensitive   = true
}
variable "am_basic_auth_hash" {
  description = "bcrypt hash of am_basic_auth_password for Alertmanager web.yml."
  type        = string
  sensitive   = true
}

locals {
  source_repo = "https://github.com/skyosv10-art/wasla"
  branch      = "main"
  region      = "oregon"

  # بنيةُ المصدرِ المشتركةُ لكلِّ خدمةٍ
  docker_source = {
    repo_url        = local.source_repo
    branch          = local.branch
    auto_deploy     = true
  }
}

# ── 1) Prometheus — يجمعُ /metrics من 14 خدمةً ────────────────────────────
# يستخدمُ Dockerfile.prometheus الذي يبني صورةً من prom/prometheus
# وينسخُ prometheus.yml وalert-rules.yml.
#
# ملاحظةُ المنفذِ: Prometheus يستمعُ على 9090 افتراضيًّا. Render يضبطُ PORT
# تلقائيًّا، لكنَّ Prometheus لا يقرأُه. نمررُ --web.listen-address=:9090
# ونعيّنُ PORT=9090 في متغيّراتِ البيئةِ كي يطابقَ.
#
# Render Free: لا قرصٌ ثابتٌ — تُفقدُ المقاييسُ عندَ إعادةِ التشغيلِ.
# هذا مقبولٌ للقياسِ التركيبيِّ (Stage B acceptance: synthetic trace/dashboard).

resource "render_web_service" "wasla_prometheus" {
  name   = "wasla-prometheus"
  region = local.region
  plan   = "free"

  runtime_source = {
    docker = {
      repo_url        = local.docker_source.repo_url
      branch          = local.docker_source.branch
      dockerfile_path = "infra/observability/Dockerfile.prometheus"
      context         = "infra/observability"
      auto_deploy     = true
    }
  }

  # Render sets PORT automatically — prometheus-entrypoint.sh passes it to --web.listen-address
  env_vars = {
    AM_BASIC_AUTH_PASSWORD = { value = var.am_basic_auth_password }
  }
}

# ── 2) Alertmanager — يُقيِّمُ قواعدَ الإنذارِ ويوجِّهُها ─────────────────────
# يستخدمُ Dockerfile.alertmanager من prom/alertmanager.
# منفذُ Alertmanager الافتراضيُّ 9093.

resource "render_web_service" "wasla_alertmanager" {
  name   = "wasla-alertmanager"
  region = local.region
  plan   = "free"

  runtime_source = {
    docker = {
      repo_url        = local.docker_source.repo_url
      branch          = local.docker_source.branch
      dockerfile_path = "infra/observability/Dockerfile.alertmanager"
      context         = "infra/observability"
      auto_deploy     = true
    }
  }

  # Render sets PORT automatically — alertmanager-entrypoint.sh passes it to --web.listen-address
  env_vars = {
    TELEGRAM_BOT_TOKEN = { value = var.telegram_bot_token }
    TELEGRAM_CHAT_ID   = { value = var.telegram_chat_id }
    AM_BASIC_AUTH_USER = { value = "wasla-prometheus" }
    AM_BASIC_AUTH_HASH = { value = var.am_basic_auth_hash }
  }
}

# ── 3) OTLP Collector — يستقبلُ آثارَ OpenTelemetry ────────────────────────
# يستخدمُ Dockerfile.otel-collector من otel/opentelemetry-collector-contrib.
# يستمعُ على المنفذِ 4318 (HTTP OTLP).

resource "render_web_service" "wasla_otel_collector" {
  name   = "wasla-otel-collector"
  region = local.region
  plan   = "free"

  runtime_source = {
    docker = {
      repo_url        = local.docker_source.repo_url
      branch          = local.docker_source.branch
      dockerfile_path = "infra/observability/Dockerfile.otel-collector"
      context         = "infra/observability"
      auto_deploy     = true
    }
  }

  # Render sets PORT automatically — the collector expands ${env:PORT} natively
  env_vars = {}
}

# ── Outputs ────────────────────────────────────────────────────────────────

output "prometheus_url" {
  value       = "https://wasla-prometheus.onrender.com"
  description = "Prometheus URL — لوحةُ المقاييسِ والاستعلامات."
}

output "alertmanager_url" {
  value       = "https://wasla-alertmanager.onrender.com"
  description = "Alertmanager URL — لوحةُ الإنذاراتِ."
}

output "otel_collector_url" {
  value       = "https://wasla-otel-collector.onrender.com"
  description = "OTLP Collector URL — نقطةُ استقبالِ الآثارِ (OTLP/HTTP)."
}

output "otel_exporter_endpoint" {
  value       = "https://wasla-otel-collector.onrender.com/v1/traces"
  description = "قيمةُ OTEL_EXPORTER_OTLP_ENDPOINT لتعيينها على الخدماتِ."
}

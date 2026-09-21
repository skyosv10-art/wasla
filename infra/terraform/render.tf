# ── Render service resources for WASLA ──────────────────────────────────
# ADR-039: Render Free as M2-02 experimental compute target.
# Supabase remains the database (ADR-038). Render is compute only.
#
# 13 HTTP services + 3 HTTP bots = 16 deployable units.
# All are Web Services on Render.
#
# CRITICAL LIMITATIONS (Render Free):
#   1. Free Web Services CANNOT receive private network traffic.
#      Inter-service calls must use public URLs. PoC only.
#   2. Free Web Services sleep after 15 min idle.
#   3. 16 services × continuous run exceeds 750 free instance hours/month.
#   4. Render sets PORT automatically — services must listen on $PORT.
#
# PORT COMPATIBILITY (measured from source):
#   Compatible (read PORT): customers, delivery, dispatch, drivers,
#     geography, identity, matching, negotiations, orders, reputation, search
#   NOT compatible (custom port var):
#     marketplace  → MARKETPLACE_SERVICE_PORT
#     subscriptions → SUBSCRIPTION_SERVICE_PORT
#     customer-bot → CUSTOMER_BOT_PORT
#     driver-bot   → DRIVER_BOT_PORT
#     partner-bot  → PARTNER_BOT_PORT
#   These 5 units need code changes to read PORT before they work on Render.
#   BLOCKED — CODE CHANGE REQUIRED for port compatibility.
#
# ENTRYPOINT: The Dockerfile uses WASLA_SERVICE env var (format: @wasla/<name>)
#   to select which package to run. See scripts/container/entrypoint.sh.
#
# Secrets (DATABASE_URL, BOT_TOKEN, etc.) are passed via environment
# variables on Render — never in this file.

locals {
  common_env = {
    NODE_ENV                   = { value = var.environment == "staging" ? "staging" : "production" }
    WASLA_SERVICE_AUTH_KEYS    = { value = var.wasla_service_auth_keys }
    WASLA_SERVICE_AUTH_ACTIVE_KID = { value = var.wasla_service_auth_active_kid }
  }

  docker_source = {
    repo_url        = "https://github.com/skyosv10-art/wasla"
    branch          = "main"
    dockerfile_path = "Dockerfile"
    context         = "."
    auto_deploy     = true
  }
}

# ── Web Services: PORT-compatible (11 services) ────────────────────────

resource "render_web_service" "wasla_customers" {
  name   = "wasla-customers"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = { docker = local.docker_source }

  env_vars = merge(local.common_env, {
    DATABASE_URL          = { value = var.supabase_database_url }
    WASLA_SERVICE         = { value = "@wasla/customers-service" }
    GEOGRAPHY_SERVICE_URL = { value = render_web_service.wasla_geography.url }
    IDENTITY_SERVICE_URL  = { value = render_web_service.wasla_identity.url }
    ORDER_SERVICE_URL     = { value = render_web_service.wasla_orders.url }
  })
}

resource "render_web_service" "wasla_delivery" {
  name   = "wasla-delivery"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = { docker = local.docker_source }

  env_vars = merge(local.common_env, {
    DATABASE_URL            = { value = var.supabase_database_url }
    WASLA_SERVICE           = { value = "@wasla/delivery-service" }
    MARKETPLACE_SERVICE_URL = { value = render_web_service.wasla_marketplace.url }
  })
}

resource "render_web_service" "wasla_dispatch" {
  name   = "wasla-dispatch"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = { docker = local.docker_source }

  env_vars = merge(local.common_env, {
    DATABASE_URL       = { value = var.supabase_database_url }
    WASLA_SERVICE      = { value = "@wasla/dispatch-service" }
    DISPATCH_WAVE_SIZE = { value = "2" }
    MATCHING_BASE_URL  = { value = render_web_service.wasla_matching.url }
    ORDERS_BASE_URL    = { value = render_web_service.wasla_orders.url }
  })
}

resource "render_web_service" "wasla_drivers" {
  name   = "wasla-drivers"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = { docker = local.docker_source }

  env_vars = merge(local.common_env, {
    DATABASE_URL  = { value = var.supabase_database_url }
    WASLA_SERVICE = { value = "@wasla/drivers-service" }
  })
}

resource "render_web_service" "wasla_geography" {
  name   = "wasla-geography"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = { docker = local.docker_source }

  env_vars = merge(local.common_env, {
    DATABASE_URL         = { value = var.supabase_database_url }
    WASLA_SERVICE        = { value = "@wasla/geography-service" }
    IDENTITY_SERVICE_URL = { value = render_web_service.wasla_identity.url }
  })
}

resource "render_web_service" "wasla_identity" {
  name   = "wasla-identity"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = { docker = local.docker_source }

  env_vars = merge(local.common_env, {
    DATABASE_URL  = { value = var.supabase_database_url }
    WASLA_SERVICE = { value = "@wasla/identity-service" }
  })
}

resource "render_web_service" "wasla_matching" {
  name   = "wasla-matching"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = { docker = local.docker_source }

  env_vars = merge(local.common_env, {
    DATABASE_URL       = { value = var.supabase_database_url }
    WASLA_SERVICE      = { value = "@wasla/matching-service" }
    GEOGRAPHY_BASE_URL = { value = render_web_service.wasla_geography.url }
  })
}

resource "render_web_service" "wasla_negotiations" {
  name   = "wasla-negotiations"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = { docker = local.docker_source }

  env_vars = merge(local.common_env, {
    DATABASE_URL  = { value = var.supabase_database_url }
    WASLA_SERVICE = { value = "@wasla/negotiations-service" }
  })
}

resource "render_web_service" "wasla_orders" {
  name   = "wasla-orders"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = { docker = local.docker_source }

  env_vars = merge(local.common_env, {
    DATABASE_URL  = { value = var.supabase_database_url }
    WASLA_SERVICE = { value = "@wasla/orders-service" }
  })
}

resource "render_web_service" "wasla_reputation" {
  name   = "wasla-reputation"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = { docker = local.docker_source }

  env_vars = merge(local.common_env, {
    DATABASE_URL  = { value = var.supabase_database_url }
    WASLA_SERVICE = { value = "@wasla/reputation-service" }
  })
}

resource "render_web_service" "wasla_search" {
  name   = "wasla-search"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = { docker = local.docker_source }

  env_vars = merge(local.common_env, {
    DATABASE_URL  = { value = var.supabase_database_url }
    WASLA_SERVICE = { value = "@wasla/search-service" }
  })
}

# ── Web Services: previously PORT-incompatible (2 services + 3 bots) ──
# marketplace and subscriptions now read PORT (fixed in CLM-0226).
# Bots already had PORT fallback via bot-runtime config.

resource "render_web_service" "wasla_marketplace" {
  name   = "wasla-marketplace"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = { docker = local.docker_source }

  env_vars = merge(local.common_env, {
    DATABASE_URL  = { value = var.supabase_database_url }
    WASLA_SERVICE = { value = "@wasla/marketplace-service" }
    # PORT-compatible (CLM-0226): reads PORT first, then MARKETPLACE_SERVICE_PORT.
  })
}

resource "render_web_service" "wasla_subscriptions" {
  name   = "wasla-subscriptions"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = { docker = local.docker_source }

  env_vars = merge(local.common_env, {
    DATABASE_URL  = { value = var.supabase_database_url }
    WASLA_SERVICE = { value = "@wasla/subscriptions-service" }
    # PORT-compatible (CLM-0226): reads PORT first, then SUBSCRIPTION_SERVICE_PORT.
  })
}

resource "render_web_service" "wasla_customer_bot" {
  name   = "wasla-customer-bot"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = { docker = local.docker_source }

  env_vars = merge(local.common_env, {
    WASLA_SERVICE         = { value = "@wasla/customer-bot" }
    CUSTOMER_DATABASE_URL = { value = var.supabase_database_url }
    # PORT-compatible: bot-runtime reads CUSTOMER_BOT_PORT then PORT fallback.
    # CUSTOMER_BOT_TOKEN, CUSTOMER_BOT_WEBHOOK_SECRET, CUSTOMER_BOT_MINI_APP_URL
    # are set via Render dashboard env vars (sensitive) — not in Terraform.
  })
}

resource "render_web_service" "wasla_driver_bot" {
  name   = "wasla-driver-bot"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = { docker = local.docker_source }

  env_vars = merge(local.common_env, {
    WASLA_SERVICE = { value = "@wasla/driver-bot" }
    # PORT-compatible: bot-runtime reads DRIVER_BOT_PORT then PORT fallback.
  })
}

resource "render_web_service" "wasla_partner_bot" {
  name   = "wasla-partner-bot"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = { docker = local.docker_source }

  env_vars = merge(local.common_env, {
    WASLA_SERVICE = { value = "@wasla/partner-bot" }
    # PORT-compatible: bot-runtime reads PARTNER_BOT_PORT then PORT fallback.
  })
}

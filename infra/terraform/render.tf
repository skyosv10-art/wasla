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
    NODE_ENV = { value = "production" }
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

# ── Web Services: PORT-incompatible (2 services + 3 bots) ──────────────
# These units read custom port env vars instead of PORT.
# Render sets PORT automatically — these won't bind to the correct port.
# BLOCKED — CODE CHANGE REQUIRED: read PORT as primary env var.

resource "render_web_service" "wasla_marketplace" {
  name   = "wasla-marketplace"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = { docker = local.docker_source }

  env_vars = merge(local.common_env, {
    DATABASE_URL  = { value = var.supabase_database_url }
    WASLA_SERVICE = { value = "@wasla/marketplace-service" }
    # BLOCKED: marketplace reads MARKETPLACE_SERVICE_PORT, not PORT.
    # Code change required to read PORT as primary.
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
    # BLOCKED: subscriptions reads SUBSCRIPTION_SERVICE_PORT, not PORT.
    # Code change required to read PORT as primary.
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
    # BLOCKED: customer-bot reads CUSTOMER_BOT_PORT, not PORT.
    # Code change required to read PORT as primary.
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
    # BLOCKED: driver-bot reads DRIVER_BOT_PORT, not PORT.
    # Code change required to read PORT as primary.
  })
}

resource "render_web_service" "wasla_partner_bot" {
  name   = "wasla-partner-bot"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = { docker = local.docker_source }

  env_vars = merge(local.common_env, {
    WASLA_SERVICE = { value = "@wasla/partner-bot" }
    # BLOCKED: partner-bot reads PARTNER_BOT_PORT, not PORT.
    # Code change required to read PORT as primary.
  })
}

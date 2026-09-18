# ── Render service resources for WASLA ──────────────────────────────────
# ADR-039: Render Free as M2-02 experimental compute target.
# Supabase remains the database (ADR-038). Render is compute only.
#
# 13 HTTP services + 3 HTTP bots = 16 deployable units.
# All are Web Services on Render.
#
# CRITICAL LIMITATION (Render Free):
#   Free Web Services CANNOT receive private network traffic.
#   Inter-service calls (e.g. dispatch→matching, customers→geography)
#   must use public URLs. This is acceptable for proof-of-concept only.
#   Production requires paid Private Services for internal endpoints.
#
# Secrets (DATABASE_URL, BOT_TOKEN, etc.) are passed via environment
# variables on Render — never in this file. Use render_env_group or
# per-service env blocks.

locals {
  common_env = {
    NODE_ENV = { value = "production" }
  }
}

# ── Helper: build a WASLA web service from the monorepo Dockerfile ─────
# The Dockerfile uses SERVICE_NAME env var to select the entry point.

# ── Web Services (HTTP servers) ────────────────────────────────────────

resource "render_web_service" "wasla_customers" {
  name   = "wasla-customers"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = {
    docker = {
      repo_url        = "https://github.com/skyosv10-art/wasla"
      branch          = "main"
      dockerfile_path = "Dockerfile"
      context         = "."
      auto_deploy     = true
    }
  }

  env_vars = merge(local.common_env, {
    DATABASE_URL          = { value = var.supabase_database_url }
    SERVICE_NAME          = { value = "customers" }
    PORT                  = { value = "8080" }
    GEOGRAPHY_SERVICE_URL = { value = render_web_service.wasla_geography.url }
    IDENTITY_SERVICE_URL  = { value = render_web_service.wasla_identity.url }
    ORDER_SERVICE_URL     = { value = render_web_service.wasla_orders.url }
  })
}

resource "render_web_service" "wasla_delivery" {
  name   = "wasla-delivery"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = {
    docker = {
      repo_url        = "https://github.com/skyosv10-art/wasla"
      branch          = "main"
      dockerfile_path = "Dockerfile"
      context         = "."
      auto_deploy     = true
    }
  }

  env_vars = merge(local.common_env, {
    DATABASE_URL            = { value = var.supabase_database_url }
    SERVICE_NAME            = { value = "delivery" }
    PORT                    = { value = "8080" }
    MARKETPLACE_SERVICE_URL = { value = render_web_service.wasla_marketplace.url }
  })
}

resource "render_web_service" "wasla_dispatch" {
  name   = "wasla-dispatch"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = {
    docker = {
      repo_url        = "https://github.com/skyosv10-art/wasla"
      branch          = "main"
      dockerfile_path = "Dockerfile"
      context         = "."
      auto_deploy     = true
    }
  }

  env_vars = merge(local.common_env, {
    DATABASE_URL       = { value = var.supabase_database_url }
    SERVICE_NAME       = { value = "dispatch" }
    PORT               = { value = "8080" }
    DISPATCH_WAVE_SIZE = { value = "2" }
    MATCHING_BASE_URL  = { value = render_web_service.wasla_matching.url }
    ORDERS_BASE_URL    = { value = render_web_service.wasla_orders.url }
  })
}

resource "render_web_service" "wasla_drivers" {
  name   = "wasla-drivers"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = {
    docker = {
      repo_url        = "https://github.com/skyosv10-art/wasla"
      branch          = "main"
      dockerfile_path = "Dockerfile"
      context         = "."
      auto_deploy     = true
    }
  }

  env_vars = merge(local.common_env, {
    DATABASE_URL = { value = var.supabase_database_url }
    SERVICE_NAME = { value = "drivers" }
    PORT         = { value = "8080" }
  })
}

resource "render_web_service" "wasla_geography" {
  name   = "wasla-geography"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = {
    docker = {
      repo_url        = "https://github.com/skyosv10-art/wasla"
      branch          = "main"
      dockerfile_path = "Dockerfile"
      context         = "."
      auto_deploy     = true
    }
  }

  env_vars = merge(local.common_env, {
    DATABASE_URL         = { value = var.supabase_database_url }
    SERVICE_NAME         = { value = "geography" }
    PORT                 = { value = "8080" }
    IDENTITY_SERVICE_URL = { value = render_web_service.wasla_identity.url }
  })
}

resource "render_web_service" "wasla_identity" {
  name   = "wasla-identity"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = {
    docker = {
      repo_url        = "https://github.com/skyosv10-art/wasla"
      branch          = "main"
      dockerfile_path = "Dockerfile"
      context         = "."
      auto_deploy     = true
    }
  }

  env_vars = merge(local.common_env, {
    DATABASE_URL = { value = var.supabase_database_url }
    SERVICE_NAME = { value = "identity" }
    PORT         = { value = "8080" }
  })
}

resource "render_web_service" "wasla_marketplace" {
  name   = "wasla-marketplace"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = {
    docker = {
      repo_url        = "https://github.com/skyosv10-art/wasla"
      branch          = "main"
      dockerfile_path = "Dockerfile"
      context         = "."
      auto_deploy     = true
    }
  }

  env_vars = merge(local.common_env, {
    DATABASE_URL = { value = var.supabase_database_url }
    SERVICE_NAME = { value = "marketplace" }
    PORT         = { value = "8080" }
  })
}

resource "render_web_service" "wasla_matching" {
  name   = "wasla-matching"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = {
    docker = {
      repo_url        = "https://github.com/skyosv10-art/wasla"
      branch          = "main"
      dockerfile_path = "Dockerfile"
      context         = "."
      auto_deploy     = true
    }
  }

  env_vars = merge(local.common_env, {
    DATABASE_URL       = { value = var.supabase_database_url }
    SERVICE_NAME       = { value = "matching" }
    PORT               = { value = "8080" }
    GEOGRAPHY_BASE_URL = { value = render_web_service.wasla_geography.url }
  })
}

resource "render_web_service" "wasla_negotiations" {
  name   = "wasla-negotiations"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = {
    docker = {
      repo_url        = "https://github.com/skyosv10-art/wasla"
      branch          = "main"
      dockerfile_path = "Dockerfile"
      context         = "."
      auto_deploy     = true
    }
  }

  env_vars = merge(local.common_env, {
    DATABASE_URL = { value = var.supabase_database_url }
    SERVICE_NAME = { value = "negotiations" }
    PORT         = { value = "8080" }
  })
}

resource "render_web_service" "wasla_orders" {
  name   = "wasla-orders"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = {
    docker = {
      repo_url        = "https://github.com/skyosv10-art/wasla"
      branch          = "main"
      dockerfile_path = "Dockerfile"
      context         = "."
      auto_deploy     = true
    }
  }

  env_vars = merge(local.common_env, {
    DATABASE_URL = { value = var.supabase_database_url }
    SERVICE_NAME = { value = "orders" }
    PORT         = { value = "8080" }
  })
}

resource "render_web_service" "wasla_reputation" {
  name   = "wasla-reputation"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = {
    docker = {
      repo_url        = "https://github.com/skyosv10-art/wasla"
      branch          = "main"
      dockerfile_path = "Dockerfile"
      context         = "."
      auto_deploy     = true
    }
  }

  env_vars = merge(local.common_env, {
    DATABASE_URL = { value = var.supabase_database_url }
    SERVICE_NAME = { value = "reputation" }
    PORT         = { value = "8080" }
  })
}

resource "render_web_service" "wasla_search" {
  name   = "wasla-search"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = {
    docker = {
      repo_url        = "https://github.com/skyosv10-art/wasla"
      branch          = "main"
      dockerfile_path = "Dockerfile"
      context         = "."
      auto_deploy     = true
    }
  }

  env_vars = merge(local.common_env, {
    DATABASE_URL = { value = var.supabase_database_url }
    SERVICE_NAME = { value = "search" }
    PORT         = { value = "8080" }
  })
}

resource "render_web_service" "wasla_subscriptions" {
  name   = "wasla-subscriptions"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = {
    docker = {
      repo_url        = "https://github.com/skyosv10-art/wasla"
      branch          = "main"
      dockerfile_path = "Dockerfile"
      context         = "."
      auto_deploy     = true
    }
  }

  env_vars = merge(local.common_env, {
    DATABASE_URL = { value = var.supabase_database_url }
    SERVICE_NAME = { value = "subscriptions" }
    PORT         = { value = "8080" }
  })
}

# ── Bots (HTTP servers on custom ports) ────────────────────────────────

resource "render_web_service" "wasla_customer_bot" {
  name   = "wasla-customer-bot"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = {
    docker = {
      repo_url        = "https://github.com/skyosv10-art/wasla"
      branch          = "main"
      dockerfile_path = "Dockerfile"
      context         = "."
      auto_deploy     = true
    }
  }

  env_vars = merge(local.common_env, {
    SERVICE_NAME          = { value = "customer-bot" }
    CUSTOMER_BOT_PORT     = { value = "8083" }
    CUSTOMER_DATABASE_URL = { value = var.supabase_database_url }
  })

  # CUSTOMER_BOT_TOKEN, CUSTOMER_BOT_WEBHOOK_SECRET, CUSTOMER_BOT_MINI_APP_URL
  # are set via Render dashboard env vars (sensitive) — not in Terraform.
}

resource "render_web_service" "wasla_driver_bot" {
  name   = "wasla-driver-bot"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = {
    docker = {
      repo_url        = "https://github.com/skyosv10-art/wasla"
      branch          = "main"
      dockerfile_path = "Dockerfile"
      context         = "."
      auto_deploy     = true
    }
  }

  env_vars = merge(local.common_env, {
    SERVICE_NAME    = { value = "driver-bot" }
    DRIVER_BOT_PORT = { value = "8084" }
  })
}

resource "render_web_service" "wasla_partner_bot" {
  name   = "wasla-partner-bot"
  region = var.render_region
  plan   = var.render_plan

  runtime_source = {
    docker = {
      repo_url        = "https://github.com/skyosv10-art/wasla"
      branch          = "main"
      dockerfile_path = "Dockerfile"
      context         = "."
      auto_deploy     = true
    }
  }

  env_vars = merge(local.common_env, {
    SERVICE_NAME     = { value = "partner-bot" }
    PARTNER_BOT_PORT = { value = "8085" }
  })
}

# ── WASLA app static sites — جذرُ terraform مستقلٌّ (M3-09 · ADR-048) ──────
#
# ينشرُ المواقعَ الثابتةَ الثلاثةَ (customer-mini-app · driver-mini-app · admin-portal)
# على Render، مع قواعدِ إعادةِ كتابةٍ تولِّدُها من جدولِ التوجيهِ الوحيدِ
# `infra/render/app-rewrites.json` — المصدرِ الذي يقرؤهُ الفحصُ 24 أيضًا
# (البابُ السادسُ)، فلا يوجدَ تعريفُ توجيهٍ ثانٍ ينسخُ أو يناقضُ.
#
# لماذا جذرٌ مستقلٌّ لا `infra/terraform/` (الجذرُ الذي يملكُ الخدماتِ الـ16)؟
#   حالةُ terraform للجذرِ الأصليِّ كانت محليةً لجلستِ إنشائِها ولم تُحفَظ
#   (ولا يجوزُ حفظُها في المستودعِ — تحملُ أسرارَ بيئةٍ)، وتشغيلُهُ من حالةٍ
#   فارغةٍ سيحاولُ **إنشاءَ** خدماتٍ موجودةٍ أصلًا. استيرادُ الـ16 خدمةً
#   يستلزمُ قراءةَ قيمِ بيئتِها السريةِ (WASLA_SERVICE_AUTH_KEYS وغيرِها)
#   — وهو ما لا يجوزُ لحجرِ أمانةٍ أن يفعلهُ. المواقعُ الثابتةُ دورةُ حياةٍ
#   مختلفةٌ: بلا أسرارَ، وبلا ساعاتِ تشغيلٍ (خطةٌ مجانيةٌ)، فتستحقُّ جذرًا
#   مستقلًا يُطبَّقُ وحدهُ. لا يُدَّعى أنَّ هذا الجذرَ يملكُ الخدماتِ الـ16؛
#   ملكيتُها موصوفةٌ في `infra/terraform/render.tf`.
#
# قاعدةُ إعادةِ الكتابةِ (تحفظُ البادئةَ — لا تحذفُها):
#   /customers    → https://wasla-customers.onrender.com/customers
#   /customers/*  → https://wasla-customers.onrender.com/customers/*
#   … ثم قاعدةُ SPA الختاميةُ `/* → /index.html` آخرَ القائمةِ دائمًا.
#
# المضيفُ يُستنتجُ بالاصطلاحِ: https://wasla-<service>.onrender.com —
# وهو الاصطلاحُ نفسُهُ الذي تسمّيهُ به المواردُ في `infra/terraform/render.tf`.

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    render = {
      source  = "render-oss/render"
      version = "1.9.1"
    }
  }
}

# المفاتيحُ من البيئةِ فقط (RENDER_API_KEY · RENDER_OWNER_ID) — لا تُكتب هنا أبدًا.
provider "render" {}

locals {
  # جدولُ التوجيهِ الوحيدُ — نفسُ الملفِ الذي يقرؤهُ الفحصُ 24 (البابُ السادسُ).
  rewrite_table = jsondecode(file("${path.module}/../../render/app-rewrites.json")).prefixes

  # المضيفُ الحيُّ لكلِّ خدمةٍ بالاصطلاحِ المُعلَنِ أعلاهُ.
  service_host = { for svc in distinct(values(local.rewrite_table)) : svc => "https://wasla-${svc}.onrender.com" }

  # قاعدتان لكلِّ بادئةٍ (المسارُ الحرفيُّ ثم المسارُ بالبدلِ)، وكلاهما يحفظُ البادئةَ.
  api_rewrites = flatten([
    for prefix, svc in local.rewrite_table : [
      { source = prefix, destination = "${local.service_host[svc]}${prefix}", type = "rewrite" },
      { source = "${prefix}/*", destination = "${local.service_host[svc]}${prefix}/*", type = "rewrite" },
    ]
  ])

  # قاعدةُ SPA الختاميةُ — آخرُ القائمةِ دائمًا (القواعدُ تُقيَّمُ من الأعلى إلى الأسفل).
  spa_fallback = { source = "/*", destination = "/index.html", type = "rewrite" }

  routes = concat(local.api_rewrites, [local.spa_fallback])

  # بيئةُ البناءِ — NODE_VERSION مطابقٌ لـci.yml (توازي الإصدارات بين CI والإنتاج).
  build_env = { NODE_VERSION = { value = "20.20.1" } }

  docker_source_repo = "https://github.com/skyosv10-art/wasla"
}

# ── المواقعُ الثابتةُ الثلاثة ─────────────────────────────────────────────

resource "render_static_site" "wasla_customer_app" {
  name        = "wasla-customer-app"
  repo_url    = local.docker_source_repo
  branch      = "main"
  auto_deploy = true

  build_command = "npm install --global pnpm@9.15.9 && pnpm install --frozen-lockfile && pnpm --filter @wasla/customer-mini-app build"
  publish_path  = "apps/customer-mini-app/dist"

  build_filter = {
    paths = [
      "apps/customer-mini-app/**",
      "packages/**",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "package.json",
    ]
  }

  env_vars = local.build_env
  routes   = local.routes
}

resource "render_static_site" "wasla_driver_app" {
  name        = "wasla-driver-app"
  repo_url    = local.docker_source_repo
  branch      = "main"
  auto_deploy = true

  build_command = "npm install --global pnpm@9.15.9 && pnpm install --frozen-lockfile && pnpm --filter @wasla/driver-mini-app build"
  publish_path  = "apps/driver-mini-app/dist"

  build_filter = {
    paths = [
      "apps/driver-mini-app/**",
      "packages/**",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "package.json",
    ]
  }

  env_vars = local.build_env
  routes   = local.routes
}

resource "render_static_site" "wasla_admin_app" {
  name        = "wasla-admin-app"
  repo_url    = local.docker_source_repo
  branch      = "main"
  auto_deploy = true

  build_command = "npm install --global pnpm@9.15.9 && pnpm install --frozen-lockfile && pnpm --filter @wasla/admin-portal build"
  publish_path  = "apps/admin-portal/dist"

  build_filter = {
    paths = [
      "apps/admin-portal/**",
      "packages/**",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "package.json",
    ]
  }

  env_vars = local.build_env
  routes   = local.routes
}

output "app_urls" {
  value = {
    customer = render_static_site.wasla_customer_app.url
    driver   = render_static_site.wasla_driver_app.url
    admin    = render_static_site.wasla_admin_app.url
  }
}

output "rewrite_prefix_count" {
  value       = length(local.api_rewrites) / 2
  description = "عددُ بادئاتِ التوجيهِ في infra/render/app-rewrites.json — يجب أن يطابق ما ينشرهُ الفحصُ 24."
}

# ── Outputs ────────────────────────────────────────────────────────────

output "environment" {
  description = "Deployment environment"
  value       = var.environment
}

output "render_service_urls" {
  description = "Public URLs for all WASLA services on Render."
  value = {
    customers     = render_web_service.wasla_customers.url
    delivery      = render_web_service.wasla_delivery.url
    dispatch      = render_web_service.wasla_dispatch.url
    drivers       = render_web_service.wasla_drivers.url
    geography     = render_web_service.wasla_geography.url
    identity      = render_web_service.wasla_identity.url
    marketplace   = render_web_service.wasla_marketplace.url
    matching      = render_web_service.wasla_matching.url
    negotiations  = render_web_service.wasla_negotiations.url
    orders        = render_web_service.wasla_orders.url
    reputation    = render_web_service.wasla_reputation.url
    search        = render_web_service.wasla_search.url
    subscriptions = render_web_service.wasla_subscriptions.url
    customer_bot  = render_web_service.wasla_customer_bot.url
    driver_bot    = render_web_service.wasla_driver_bot.url
    partner_bot   = render_web_service.wasla_partner_bot.url
  }
  sensitive = false
}

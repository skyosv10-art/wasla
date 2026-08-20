/**
 * @wasla/customer-bot — the WASLA customer bot (العميل).
 *
 * A composition root, deliberately almost empty: every behaviour lives in
 * @wasla/bot-runtime, and the only thing specific to this process is *which* bot
 * it serves — `"customer"` — which decides which Mini App it opens
 * (BOT_MINI_APP.customer) and which variables it reads (CUSTOMER_BOT_*).
 *
 * Why a separate deployable: each bot has its own Telegram token and its own
 * webhook secret, so they are separate processes with separate blast radii. Why
 * no logic here: three copies of one webhook handler would drift, and one copy
 * would eventually forget the secret check.
 */

export { BOT, buildApp } from "./server.js";

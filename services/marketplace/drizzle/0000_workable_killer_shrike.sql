CREATE TABLE "inventory_adjustments" (
	"adjustment_id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity_delta" integer NOT NULL,
	"quantity_after" integer NOT NULL,
	"reason_code" text NOT NULL,
	"actor_public_id" text NOT NULL,
	"adjustment_sequence" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_inventory_adjustments_sequence" UNIQUE("product_id","adjustment_sequence"),
	CONSTRAINT "inventory_adjustments_quantity_delta_check" CHECK ("inventory_adjustments"."quantity_delta" <> 0 AND "inventory_adjustments"."quantity_delta" BETWEEN -1000000 AND 1000000),
	CONSTRAINT "inventory_adjustments_quantity_after_check" CHECK ("inventory_adjustments"."quantity_after" >= 0),
	CONSTRAINT "inventory_adjustments_reason_code_check" CHECK ("inventory_adjustments"."reason_code" IN ('initial_stock', 'restock', 'correction', 'shrinkage', 'archive_zeroed', 'reservation', 'reservation_release')),
	CONSTRAINT "inventory_adjustments_actor_public_id_check" CHECK ("inventory_adjustments"."actor_public_id" ~ '^WS-[0-9]{10}$' OR "inventory_adjustments"."actor_public_id" ~ '^system:[a-z_]+$'),
	CONSTRAINT "inventory_adjustments_adjustment_sequence_check" CHECK ("inventory_adjustments"."adjustment_sequence" >= 1)
);
--> statement-breakpoint
CREATE TABLE "marketplace_idempotency" (
	"idempotency_key" text NOT NULL,
	"route_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_idempotency_pkey" PRIMARY KEY("route_key","idempotency_key"),
	CONSTRAINT "marketplace_idempotency_idempotency_key_check" CHECK (char_length("marketplace_idempotency"."idempotency_key") BETWEEN 8 AND 128),
	CONSTRAINT "marketplace_idempotency_route_key_check" CHECK ("marketplace_idempotency"."route_key" ~ '^[a-z][a-z0-9_.]{2,63}$'),
	CONSTRAINT "marketplace_idempotency_request_hash_check" CHECK ("marketplace_idempotency"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "marketplace_idempotency_response_status_check" CHECK ("marketplace_idempotency"."response_status" BETWEEN 200 AND 299)
);
--> statement-breakpoint
CREATE TABLE "marketplace_outbox" (
	"outbox_id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"event_version" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_outbox_event_type_check" CHECK ("marketplace_outbox"."event_type" ~ '^marketplace\.[a-z_]+$'),
	CONSTRAINT "marketplace_outbox_event_version_check" CHECK ("marketplace_outbox"."event_version" ~ '^v[0-9]+$'),
	CONSTRAINT "marketplace_outbox_aggregate_type_check" CHECK ("marketplace_outbox"."aggregate_type" IN ('store', 'product', 'inventory'))
);
--> statement-breakpoint
CREATE TABLE "product_inventory" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"quantity_on_hand" integer DEFAULT 0 NOT NULL,
	"last_adjustment_sequence" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_inventory_quantity_on_hand_check" CHECK ("product_inventory"."quantity_on_hand" >= 0),
	CONSTRAINT "product_inventory_last_adjustment_sequence_check" CHECK ("product_inventory"."last_adjustment_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_reviews" (
	"review_id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason_code" text,
	"actor_type" text NOT NULL,
	"actor_public_id" text,
	"from_state" text,
	"to_state" text NOT NULL,
	"moderation_sequence" integer NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_product_reviews_sequence" UNIQUE("product_id","moderation_sequence"),
	CONSTRAINT "product_reviews_decision_check" CHECK ("product_reviews"."decision" IN ('approved', 'rejected')),
	CONSTRAINT "product_reviews_reason_code_check" CHECK ("product_reviews"."reason_code" IS NULL OR "product_reviews"."reason_code" IN (
            'prohibited_item', 'misleading_title', 'wrong_category', 'price_implausible', 'duplicate_listing', 'policy_violation'
        )),
	CONSTRAINT "product_reviews_actor_type_check" CHECK ("product_reviews"."actor_type" IN ('moderator', 'system')),
	CONSTRAINT "product_reviews_actor_public_id_check" CHECK ("product_reviews"."actor_public_id" IS NULL OR "product_reviews"."actor_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "product_reviews_from_state_check" CHECK ("product_reviews"."from_state" IS NULL OR "product_reviews"."from_state" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "product_reviews_to_state_check" CHECK ("product_reviews"."to_state" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "product_reviews_moderation_sequence_check" CHECK ("product_reviews"."moderation_sequence" >= 1),
	CONSTRAINT "ck_product_reviews_reason_required" CHECK (("product_reviews"."decision" = 'rejected' AND "product_reviews"."reason_code" IS NOT NULL) OR ("product_reviews"."decision" <> 'rejected' AND "product_reviews"."reason_code" IS NULL)),
	CONSTRAINT "ck_product_reviews_actor" CHECK (("product_reviews"."actor_type" = 'system' AND "product_reviews"."actor_public_id" IS NULL) OR ("product_reviews"."actor_type" <> 'system' AND "product_reviews"."actor_public_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"title_ar" text NOT NULL,
	"title_en" text,
	"title_ur" text,
	"description_ar" text,
	"category_id" uuid NOT NULL,
	"price_minor_units" integer NOT NULL,
	"currency_code" text DEFAULT 'SAR' NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"moderation_state" text DEFAULT 'pending' NOT NULL,
	"moderation_sequence" integer DEFAULT 1 NOT NULL,
	"created_by_public_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_products_store_sku" UNIQUE("store_id","sku"),
	CONSTRAINT "products_sku_check" CHECK ("products"."sku" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$'),
	CONSTRAINT "products_title_ar_check" CHECK (char_length("products"."title_ar") BETWEEN 2 AND 120),
	CONSTRAINT "products_title_en_check" CHECK ("products"."title_en" IS NULL OR char_length("products"."title_en") BETWEEN 2 AND 120),
	CONSTRAINT "products_title_ur_check" CHECK ("products"."title_ur" IS NULL OR char_length("products"."title_ur") BETWEEN 2 AND 120),
	CONSTRAINT "products_description_ar_check" CHECK ("products"."description_ar" IS NULL OR char_length("products"."description_ar") <= 4000),
	CONSTRAINT "products_price_minor_units_check" CHECK ("products"."price_minor_units" BETWEEN 1 AND 100000000),
	CONSTRAINT "products_currency_code_check" CHECK ("products"."currency_code" = 'SAR'),
	CONSTRAINT "products_state_check" CHECK ("products"."state" IN ('draft', 'published', 'archived')),
	CONSTRAINT "products_moderation_state_check" CHECK ("products"."moderation_state" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "products_moderation_sequence_check" CHECK ("products"."moderation_sequence" >= 1),
	CONSTRAINT "products_created_by_public_id_check" CHECK ("products"."created_by_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "ck_products_published_moderated" CHECK ("products"."state" <> 'published' OR "products"."moderation_state" = 'approved')
);
--> statement-breakpoint
CREATE TABLE "store_categories" (
	"category_id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"depth" smallint NOT NULL,
	"parent_category_id" uuid,
	"label_ar" text NOT NULL,
	"label_en" text,
	"label_ur" text,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_store_categories_slug" UNIQUE("slug"),
	CONSTRAINT "store_categories_slug_check" CHECK ("store_categories"."slug" ~ '^[a-z][a-z0-9-]{1,47}$'),
	CONSTRAINT "store_categories_depth_check" CHECK ("store_categories"."depth" IN (1, 2)),
	CONSTRAINT "store_categories_label_ar_check" CHECK (char_length("store_categories"."label_ar") BETWEEN 2 AND 64),
	CONSTRAINT "store_categories_label_en_check" CHECK ("store_categories"."label_en" IS NULL OR char_length("store_categories"."label_en") BETWEEN 2 AND 64),
	CONSTRAINT "store_categories_label_ur_check" CHECK ("store_categories"."label_ur" IS NULL OR char_length("store_categories"."label_ur") BETWEEN 2 AND 64),
	CONSTRAINT "store_categories_sort_order_check" CHECK ("store_categories"."sort_order" BETWEEN 0 AND 999),
	CONSTRAINT "ck_store_categories_depth_parent" CHECK (("store_categories"."depth" = 1 AND "store_categories"."parent_category_id" IS NULL) OR ("store_categories"."depth" = 2 AND "store_categories"."parent_category_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "store_reviews" (
	"review_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason_code" text,
	"actor_type" text NOT NULL,
	"actor_public_id" text,
	"from_state" text,
	"to_state" text NOT NULL,
	"state_sequence" integer NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ux_store_reviews_sequence" UNIQUE("store_id","state_sequence"),
	CONSTRAINT "store_reviews_decision_check" CHECK ("store_reviews"."decision" IN ('review_requested', 'approved', 'rejected', 'suspended', 'reinstated', 'archived')),
	CONSTRAINT "store_reviews_reason_code_check" CHECK ("store_reviews"."reason_code" IS NULL OR "store_reviews"."reason_code" IN (
            'incomplete_profile', 'prohibited_category', 'duplicate_store',
            'misleading_title', 'unverified_owner', 'policy_violation', 'owner_request'
        )),
	CONSTRAINT "store_reviews_actor_type_check" CHECK ("store_reviews"."actor_type" IN ('owner', 'moderator', 'system')),
	CONSTRAINT "store_reviews_actor_public_id_check" CHECK ("store_reviews"."actor_public_id" IS NULL OR "store_reviews"."actor_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "store_reviews_from_state_check" CHECK ("store_reviews"."from_state" IS NULL OR "store_reviews"."from_state" IN ('draft', 'pending_review', 'approved', 'rejected', 'suspended', 'archived')),
	CONSTRAINT "store_reviews_to_state_check" CHECK ("store_reviews"."to_state" IN ('draft', 'pending_review', 'approved', 'rejected', 'suspended', 'archived')),
	CONSTRAINT "store_reviews_state_sequence_check" CHECK ("store_reviews"."state_sequence" >= 1),
	CONSTRAINT "ck_store_reviews_reason_required" CHECK (("store_reviews"."decision" IN ('rejected', 'suspended') AND "store_reviews"."reason_code" IS NOT NULL)
          OR ("store_reviews"."decision" NOT IN ('rejected', 'suspended') AND ("store_reviews"."decision" = 'archived' OR "store_reviews"."reason_code" IS NULL))),
	CONSTRAINT "ck_store_reviews_actor" CHECK (("store_reviews"."actor_type" = 'system' AND "store_reviews"."actor_public_id" IS NULL) OR ("store_reviews"."actor_type" <> 'system' AND "store_reviews"."actor_public_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "store_staff" (
	"staff_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"member_public_id" text NOT NULL,
	"role" text NOT NULL,
	"added_by_public_id" text NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by_public_id" text,
	CONSTRAINT "store_staff_member_public_id_check" CHECK ("store_staff"."member_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "store_staff_role_check" CHECK ("store_staff"."role" IN ('owner', 'manager', 'staff')),
	CONSTRAINT "store_staff_added_by_public_id_check" CHECK ("store_staff"."added_by_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "store_staff_removed_by_public_id_check" CHECK ("store_staff"."removed_by_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "ck_store_staff_removed_pair" CHECK (("store_staff"."removed_at" IS NULL AND "store_staff"."removed_by_public_id" IS NULL) OR ("store_staff"."removed_at" IS NOT NULL AND "store_staff"."removed_by_public_id" IS NOT NULL)),
	CONSTRAINT "ck_store_staff_removed_after_added" CHECK ("store_staff"."removed_at" IS NULL OR "store_staff"."removed_at" >= "store_staff"."added_at")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"owner_public_id" text NOT NULL,
	"slug" text NOT NULL,
	"title_ar" text NOT NULL,
	"title_en" text,
	"title_ur" text,
	"description_ar" text,
	"category_id" uuid NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"state_sequence" integer DEFAULT 1 NOT NULL,
	"first_approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_owner_public_id_check" CHECK ("stores"."owner_public_id" ~ '^WS-[0-9]{10}$'),
	CONSTRAINT "stores_slug_check" CHECK ("stores"."slug" ~ '^[a-z][a-z0-9-]{2,47}$'),
	CONSTRAINT "stores_title_ar_check" CHECK (char_length("stores"."title_ar") BETWEEN 2 AND 80),
	CONSTRAINT "stores_title_en_check" CHECK ("stores"."title_en" IS NULL OR char_length("stores"."title_en") BETWEEN 2 AND 80),
	CONSTRAINT "stores_title_ur_check" CHECK ("stores"."title_ur" IS NULL OR char_length("stores"."title_ur") BETWEEN 2 AND 80),
	CONSTRAINT "stores_description_ar_check" CHECK ("stores"."description_ar" IS NULL OR char_length("stores"."description_ar") <= 2000),
	CONSTRAINT "stores_state_check" CHECK ("stores"."state" IN ('draft', 'pending_review', 'approved', 'rejected', 'suspended', 'archived')),
	CONSTRAINT "stores_state_sequence_check" CHECK ("stores"."state_sequence" >= 1),
	CONSTRAINT "ck_stores_first_approved_state" CHECK ("stores"."first_approved_at" IS NULL OR "stores"."state" <> 'draft')
);
--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "fk_inventory_adjustments_product" FOREIGN KEY ("product_id") REFERENCES "public"."products"("product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_inventory" ADD CONSTRAINT "fk_product_inventory_product" FOREIGN KEY ("product_id") REFERENCES "public"."products"("product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "fk_product_reviews_product" FOREIGN KEY ("product_id") REFERENCES "public"."products"("product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "fk_products_store" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "fk_products_category" FOREIGN KEY ("category_id") REFERENCES "public"."store_categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_categories" ADD CONSTRAINT "fk_store_categories_parent" FOREIGN KEY ("parent_category_id") REFERENCES "public"."store_categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_reviews" ADD CONSTRAINT "fk_store_reviews_store" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_staff" ADD CONSTRAINT "fk_store_staff_store" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("store_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "fk_stores_category" FOREIGN KEY ("category_id") REFERENCES "public"."store_categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_marketplace_outbox_unpublished" ON "marketplace_outbox" USING btree ("created_at") WHERE "marketplace_outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_products_store_state" ON "products" USING btree ("store_id","state");--> statement-breakpoint
CREATE INDEX "ix_products_category_state" ON "products" USING btree ("category_id","state","moderation_state");--> statement-breakpoint
CREATE INDEX "ix_store_reviews_store_seq" ON "store_reviews" USING btree ("store_id","state_sequence" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "ux_store_staff_active_member" ON "store_staff" USING btree ("store_id","member_public_id") WHERE "store_staff"."removed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_store_staff_single_owner" ON "store_staff" USING btree ("store_id") WHERE "store_staff"."role" = 'owner' AND "store_staff"."removed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_stores_slug_lower" ON "stores" USING btree (lower("slug"));--> statement-breakpoint
CREATE UNIQUE INDEX "ux_stores_owner_active" ON "stores" USING btree ("owner_public_id") WHERE "stores"."state" <> 'archived';--> statement-breakpoint
CREATE INDEX "ix_stores_state_category" ON "stores" USING btree ("state","category_id");
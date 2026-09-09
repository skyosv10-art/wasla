-- عقدُ مخطَّطِ خدمةِ الوفاءِ (Phase 13 · ADR-026) — **عقدٌ لا مهاجرٌ**.
-- المهاجرُ العكسيُّ المولَّدُ (ADR-024) يأتي في مراجعةٍ لاحقةٍ، ولا يُدَّعى هنا.
--
-- القواعدُ الحاكمةُ المُنفَّذةُ في المخطَّطِ نفسِه لا في طبقةٍ فوقَه:
--   • لا عمودَ مالٍ ولا عمودَ نصٍّ حرٍّ ولا بياناً شخصيّاً — المراجعُ مُعتِمةٌ.
--   • الحالةُ قائمةٌ مغلقةٌ بقيدٍ، لا نصٌّ حرٌّ.
--   • التسلسلُ يمنعُ الكتابةَ المتزامنةَ الصامتةَ.
--   • كلُّ انتقالٍ يُكتبُ صفّاً في `delivery_transitions` وحدثاً في `delivery_outbox`
--     **في المعاملةِ نفسِها** — فلا تغييرَ بلا أثرٍ.

CREATE TABLE IF NOT EXISTS fulfilments (
  fulfilment_ref   TEXT PRIMARY KEY CHECK (fulfilment_ref ~ '^WS-[0-9]{10}$'),
  -- **المرجعُ الأجنبيُّ يُصدَّقُ بصيغةِ مالكِه لا بصيغتِنا:** محرّكُ الطلبِ يُصدرُ
  -- `ORD-##########` والسوقُ يُعرِّفُ المتجرَ بـ`UUID`. وعقدٌ فرضَ `WS-` عليهما معاً
  -- **لا يستوفيه زوجٌ حقيقيٌّ** — رُصدَ في المراجعةِ وصُحِّحَ قبلَ الدمجِ.
  -- ولا مفتاحَ أجنبيَّ إلى دفترٍ آخرَ: خدمةٌ أخرى وقاعدةٌ أخرى (ADR-010 · ADR-016).
  order_ref        TEXT NOT NULL CHECK (order_ref ~ '^ORD-[0-9]{10}$'),
  store_ref        UUID NOT NULL,
  driver_ref       TEXT NULL CHECK (driver_ref IS NULL OR driver_ref ~ '^WS-[0-9]{10}$'),
  state            TEXT NOT NULL CHECK (state IN (
                     'requested','accepted','preparing','ready_for_pickup','assigned',
                     'picked_up','delivered','completed','cancelled','failed')),
  sequence         INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  failure_reason   TEXT NULL CHECK (failure_reason IS NULL OR failure_reason IN (
                     'store_rejected','out_of_stock','customer_cancelled','no_driver_found',
                     'pickup_failed','delivery_failed','address_unreachable','operator_intervention')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- شحنةٌ واحدةٌ لكلِّ طلبٍ ومتجرٍ: طلبٌ من متجرَين شحنتانِ لا واحدةٌ.
  CONSTRAINT fulfilments_order_store_unique UNIQUE (order_ref, store_ref),
  -- السائقُ حاضرٌ إجباراً في الحالاتِ التي تحملُه، غائبٌ إجباراً قبلَها.
  CONSTRAINT fulfilments_driver_presence CHECK (
    (state IN ('assigned','picked_up','delivered','completed') AND driver_ref IS NOT NULL)
    OR (state NOT IN ('assigned','picked_up','delivered','completed'))
  ),
  -- السببُ حاضرٌ إجباراً في النهايتَينِ غيرِ الناجحتَينِ وحدَهما.
  CONSTRAINT fulfilments_reason_presence CHECK (
    (state IN ('cancelled','failed') AND failure_reason IS NOT NULL)
    OR (state NOT IN ('cancelled','failed') AND failure_reason IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS fulfilments_state_idx ON fulfilments (state);
CREATE INDEX IF NOT EXISTS fulfilments_store_state_idx ON fulfilments (store_ref, state);
CREATE INDEX IF NOT EXISTS fulfilments_driver_idx ON fulfilments (driver_ref) WHERE driver_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS delivery_transitions (
  fulfilment_ref   TEXT NOT NULL REFERENCES fulfilments (fulfilment_ref) ON DELETE CASCADE,
  sequence         INTEGER NOT NULL CHECK (sequence > 0),
  from_state       TEXT NOT NULL,
  to_state         TEXT NOT NULL,
  actor_kind       TEXT NOT NULL CHECK (actor_kind IN ('store','driver','customer','system','operator')),
  actor_ref        TEXT NULL CHECK (actor_ref IS NULL OR actor_ref ~ '^WS-[0-9]{10}$'),
  failure_reason   TEXT NULL,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (fulfilment_ref, sequence)
);

CREATE TABLE IF NOT EXISTS delivery_outbox (
  event_id         UUID PRIMARY KEY,
  event_type       TEXT NOT NULL,
  event_version    TEXT NOT NULL CHECK (event_version ~ '^v[0-9]+$'),
  aggregate_type   TEXT NOT NULL CHECK (aggregate_type = 'fulfilment'),
  aggregate_id     TEXT NOT NULL,
  payload          JSONB NOT NULL,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at     TIMESTAMPTZ NULL,
  trace_id         TEXT NULL
);

CREATE INDEX IF NOT EXISTS delivery_outbox_unpublished_idx
  ON delivery_outbox (occurred_at) WHERE published_at IS NULL;

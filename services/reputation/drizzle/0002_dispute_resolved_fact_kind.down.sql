-- Rollback: remove dispute_resolved from fact_kind CHECK constraints.
ALTER TABLE "reputation_facts" DROP CONSTRAINT "reputation_facts_fact_kind_check";
--> statement-breakpoint
ALTER TABLE "reputation_rule_weights" DROP CONSTRAINT "reputation_rule_weights_fact_kind_check";
--> statement-breakpoint
ALTER TABLE "reputation_facts" ADD CONSTRAINT "reputation_facts_fact_kind_check" CHECK ("reputation_facts"."fact_kind" IN ('order_completed','order_cancelled_by_customer','order_cancelled_by_driver','assignment_accepted','assignment_rejected','assignment_timed_out','rating_received'));
--> statement-breakpoint
ALTER TABLE "reputation_rule_weights" ADD CONSTRAINT "reputation_rule_weights_fact_kind_check" CHECK ("reputation_rule_weights"."fact_kind" IN ('order_completed','order_cancelled_by_customer','order_cancelled_by_driver','assignment_accepted','assignment_rejected','assignment_timed_out','rating_received'));

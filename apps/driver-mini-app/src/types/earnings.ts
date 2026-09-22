/**
 * Job History / Earnings domain types for the driver mini app.
 *
 * The earnings screen shows completed jobs with earnings summaries and
 * period filtering (today / this week / this month). Data follows the
 * Order wire format from the orders service, filtered to completed jobs
 * assigned to the current driver.
 *
 * Wire format: snake_case from the API.
 */

export type OrderStatus =
  | "completed"
  | "driver_cancelled"
  | "customer_cancelled";

export type OrderType = "ride" | "delivery";

export type VehicleClass =
  | "sedan"
  | "suv"
  | "van"
  | "pickup"
  | "motorcycle"
  | "truck_small";

export interface Money {
  amount_minor: number;
  currency: string;
}

/** A completed job in the driver's history. */
export interface JobHistoryEntry {
  order_public_id: string;
  order_type: OrderType;
  vehicle_class: VehicleClass;
  status: OrderStatus;
  agreed_price: Money | null;
  agreed_at: string | null;
  completed_at: string;
  pickup_label: string;
  dropoff_label: string;
}

/** Aggregated earnings for a period. */
export interface EarningsSummary {
  period: EarningsPeriod;
  job_count: number;
  total_amount: Money;
  jobs: JobHistoryEntry[];
}

export type EarningsPeriod = "today" | "week" | "month";

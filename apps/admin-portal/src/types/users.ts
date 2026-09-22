/**
 * User (customer) types for admin portal.
 *
 * Mirrors the API contract from the customers-service.
 * Wire format is snake_case; domain types use camelCase.
 * Admin routes for customers (list, suspend, reinstate) are planned
 * for the customers-service — frontend built ahead per ADR-047 Wave 2.
 */

export const USER_STATUSES = ["active", "suspended"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Customer summary as returned by GET /customers (admin list endpoint) */
export interface UserSummary {
  wasla_public_id: string;
  display_name: string | null;
  phone_number: string | null;
  preferred_locale: string;
  status: UserStatus;
  suspension_reason_code: string | null;
  order_count: number;
  created_at: string;
  updated_at: string;
}

/** Wire response from GET /customers */
export interface UserListResponse {
  customers: UserSummary[];
}

/** Wire response from GET /customers/:id */
export interface UserDetail extends UserSummary {
  rating_avg: number | null;
  rating_count: number;
  recent_orders: RecentOrderSummary[];
}

export interface RecentOrderSummary {
  order_public_id: string;
  status: string;
  created_at: string;
  total_amount: string | null;
}

/** Suspend request body */
export interface SuspendUserRequest {
  reason_code: string;
}

/** Reinstate request body (empty by design, like drivers-service) */
export interface ReinstateUserRequest {
  // intentionally empty — contract mirrors drivers-service reinstate
}

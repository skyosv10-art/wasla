/**
 * أداةُ التحقّقِ من القيود في وقت التشغيل — تُحاكي قيود PostgreSQL في الطبقةِ
 * التطبيقيّةِ قبل الوصولِ إلى قاعدةِ البيانات.
 */

import { BILLING_INVOICE_STATES, type BillingInvoiceState } from "@wasla/contracts-billing";
import { canTransition, allowsPayment, allowsVoid } from "../domain/model.js";
import { BillingError } from "../domain/errors.js";

export function validateStateTransition(
  from: BillingInvoiceState,
  to: BillingInvoiceState,
): void {
  if (!canTransition(from, to)) {
    throw BillingError.invalidStateTransition(from, to);
  }
}

export function validatePaymentAllowed(state: BillingInvoiceState): void {
  if (!allowsPayment(state)) {
    throw BillingError.invalidStateTransition(state, "paid");
  }
}

export function validateVoidAllowed(state: BillingInvoiceState): void {
  if (!allowsVoid(state)) {
    throw BillingError.invalidStateTransition(state, "void");
  }
}

export function validateInvoiceState(state: string): asserts state is BillingInvoiceState {
  if (!BILLING_INVOICE_STATES.includes(state as BillingInvoiceState)) {
    throw BillingError.validationFailed(`Invalid invoice state: ${state}`);
  }
}

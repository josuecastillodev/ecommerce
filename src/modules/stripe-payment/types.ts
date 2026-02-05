/**
 * Stripe Payment Types for Mexico
 */

// Supported payment methods in Mexico
export type PaymentMethodType = "card" | "oxxo"

// Payment method details
export interface PaymentMethodDetails {
  type: PaymentMethodType
  label: string
  description: string
  icon?: string
  min_amount?: number // Minimum amount in cents
  max_amount?: number // Maximum amount in cents
  processing_time?: string
}

// Available payment methods for Mexico
export const MEXICO_PAYMENT_METHODS: Record<PaymentMethodType, PaymentMethodDetails> = {
  card: {
    type: "card",
    label: "Tarjeta de crédito/débito",
    description: "Visa, Mastercard, American Express",
    icon: "credit-card",
    processing_time: "Instantáneo",
  },
  oxxo: {
    type: "oxxo",
    label: "OXXO Pay",
    description: "Paga en efectivo en cualquier OXXO",
    icon: "store",
    min_amount: 1000, // 10 MXN minimum
    max_amount: 1000000, // 10,000 MXN maximum
    processing_time: "1-3 días hábiles",
  },
}

// OXXO voucher data
export interface OxxoVoucherData {
  voucher_url: string
  voucher_number: string
  expires_at: string
  hosted_voucher_url?: string
}

// Payment session data
export interface StripePaymentSessionData {
  id: string // PaymentIntent ID
  client_secret: string
  status: string
  payment_method_type: PaymentMethodType
  stripe_customer_id?: string
  oxxo_voucher?: OxxoVoucherData
  captured_at?: string
  cancelled_at?: string
  refund_id?: string
  refund_status?: string
  refunded_amount?: number
}

// Webhook event types we handle
export type StripeWebhookEventType =
  | "payment_intent.succeeded"
  | "payment_intent.payment_failed"
  | "payment_intent.canceled"
  | "charge.refunded"
  | "charge.dispute.created"

// Webhook payload
export interface StripeWebhookPayload {
  id: string
  type: StripeWebhookEventType
  data: {
    object: unknown
  }
  created: number
}

// Create payment input
export interface CreateStripePaymentInput {
  amount: number
  currency_code: string
  payment_method_type?: PaymentMethodType
  customer_email?: string
  customer_name?: string
  brand_id?: string
  oxxo_expires_after_days?: number
  metadata?: Record<string, string>
}

// Payment response for frontend
export interface PaymentIntentResponse {
  client_secret: string
  payment_intent_id: string
  payment_method_type: PaymentMethodType
  publishable_key: string
  oxxo_voucher?: OxxoVoucherData
}

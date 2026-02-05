/**
 * Payment Events Subscriber
 * Handles payment-related events from Stripe webhooks
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// Payment captured event
export async function handlePaymentCaptured({
  event,
  container,
}: SubscriberArgs<{
  payment_intent_id: string
  session_id: string
  brand_id?: string
  amount: number
  currency: string
  payment_method_type: string
  customer_email?: string
}>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const { payment_intent_id, session_id, brand_id, amount, currency, payment_method_type } = event.data

  logger.info(
    `[Payment Captured] Intent: ${payment_intent_id}, Amount: ${amount} ${currency}, Method: ${payment_method_type}, Brand: ${brand_id}`
  )

  // Here you would:
  // 1. Update order status to "paid"
  // 2. Send confirmation email
  // 3. Update inventory
  // 4. Trigger fulfillment workflow

  // Example: Send notification
  // const notificationService = container.resolve("notificationModuleService")
  // await notificationService.send({
  //   to: customer_email,
  //   template: "order-confirmation",
  //   data: { order_id, amount, brand_id }
  // })
}

// Payment failed event
export async function handlePaymentFailed({
  event,
  container,
}: SubscriberArgs<{
  payment_intent_id: string
  session_id: string
  error_message?: string
  error_code?: string
  decline_code?: string
}>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const { payment_intent_id, error_message, error_code, decline_code } = event.data

  logger.warn(
    `[Payment Failed] Intent: ${payment_intent_id}, Error: ${error_message}, Code: ${error_code}, Decline: ${decline_code}`
  )

  // Here you would:
  // 1. Update order status to "payment_failed"
  // 2. Send failure notification to customer
  // 3. Log for analytics
}

// Payment refunded event
export async function handlePaymentRefunded({
  event,
  container,
}: SubscriberArgs<{
  charge_id: string
  payment_intent_id: string
  refund_id: string
  amount_refunded: number
  refund_reason?: string
}>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const { charge_id, refund_id, amount_refunded, refund_reason } = event.data

  logger.info(
    `[Payment Refunded] Charge: ${charge_id}, Refund: ${refund_id}, Amount: ${amount_refunded}, Reason: ${refund_reason}`
  )

  // Here you would:
  // 1. Update order with refund details
  // 2. Restore inventory if applicable
  // 3. Send refund confirmation email
}

// Payment canceled event
export async function handlePaymentCanceled({
  event,
  container,
}: SubscriberArgs<{
  payment_intent_id: string
  session_id: string
  cancellation_reason?: string
}>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const { payment_intent_id, cancellation_reason } = event.data

  logger.info(
    `[Payment Canceled] Intent: ${payment_intent_id}, Reason: ${cancellation_reason}`
  )

  // Here you would:
  // 1. Cancel or void the order
  // 2. Restore inventory
  // 3. Notify customer
}

// Payment disputed event
export async function handlePaymentDisputed({
  event,
  container,
}: SubscriberArgs<{
  dispute_id: string
  charge_id: string
  amount: number
  reason: string
  status: string
}>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const { dispute_id, charge_id, amount, reason, status } = event.data

  logger.warn(
    `[Payment Disputed] Dispute: ${dispute_id}, Charge: ${charge_id}, Amount: ${amount}, Reason: ${reason}, Status: ${status}`
  )

  // Here you would:
  // 1. Flag order for review
  // 2. Notify admin
  // 3. Prepare dispute evidence
}

// OXXO voucher created event
export async function handleOxxoVoucherCreated({
  event,
  container,
}: SubscriberArgs<{
  payment_intent_id: string
  session_id: string
  voucher_number: string
  voucher_url?: string
  expires_at?: string
}>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const { payment_intent_id, voucher_number, voucher_url, expires_at } = event.data

  logger.info(
    `[OXXO Voucher Created] Intent: ${payment_intent_id}, Number: ${voucher_number}, Expires: ${expires_at}`
  )

  // Here you would:
  // 1. Store voucher details with the order
  // 2. Send email with OXXO payment instructions
  // 3. Set up reminder notifications before expiration
}

// Export subscriber configs
export const paymentCapturedConfig: SubscriberConfig = {
  event: "payment.captured",
}

export const paymentFailedConfig: SubscriberConfig = {
  event: "payment.failed",
}

export const paymentRefundedConfig: SubscriberConfig = {
  event: "payment.refunded",
}

export const paymentCanceledConfig: SubscriberConfig = {
  event: "payment.canceled",
}

export const paymentDisputedConfig: SubscriberConfig = {
  event: "payment.disputed",
}

export const oxxoVoucherCreatedConfig: SubscriberConfig = {
  event: "payment.oxxo_voucher_created",
}

// Default export for Medusa to auto-register all handlers
export default {
  "payment.captured": handlePaymentCaptured,
  "payment.failed": handlePaymentFailed,
  "payment.refunded": handlePaymentRefunded,
  "payment.canceled": handlePaymentCanceled,
  "payment.disputed": handlePaymentDisputed,
  "payment.oxxo_voucher_created": handleOxxoVoucherCreated,
}

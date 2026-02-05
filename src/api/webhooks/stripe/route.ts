/**
 * Stripe Webhooks Endpoint
 * POST /webhooks/stripe
 *
 * Handles Stripe webhook events for payment processing
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import Stripe from "stripe"

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || ""

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  // Get raw body for signature verification
  const signature = req.headers["stripe-signature"] as string

  if (!signature) {
    logger.warn("Stripe webhook received without signature")
    res.status(400).json({ error: "Missing stripe-signature header" })
    return
  }

  if (!WEBHOOK_SECRET) {
    logger.error("STRIPE_WEBHOOK_SECRET not configured")
    res.status(500).json({ error: "Webhook secret not configured" })
    return
  }

  let event: Stripe.Event

  try {
    // Construct event from raw body
    const stripe = new Stripe(process.env.STRIPE_API_KEY || "", {
      apiVersion: "2024-11-20.acacia",
    })

    // Note: In production, ensure raw body is preserved
    const rawBody = JSON.stringify(req.body)
    event = stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET)
  } catch (err: any) {
    logger.error(`Stripe webhook signature verification failed: ${err.message}`)
    res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` })
    return
  }

  logger.info(`Received Stripe webhook: ${event.type} (${event.id})`)

  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event, req, logger)
        break

      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(event, req, logger)
        break

      case "payment_intent.canceled":
        await handlePaymentIntentCanceled(event, req, logger)
        break

      case "charge.refunded":
        await handleChargeRefunded(event, req, logger)
        break

      case "charge.dispute.created":
        await handleDisputeCreated(event, req, logger)
        break

      // OXXO specific events
      case "payment_intent.requires_action":
        await handleOxxoVoucherCreated(event, req, logger)
        break

      default:
        logger.info(`Unhandled Stripe event type: ${event.type}`)
    }

    res.status(200).json({ received: true })
  } catch (error: any) {
    logger.error(`Error processing Stripe webhook: ${error.message}`)
    res.status(500).json({ error: "Webhook processing failed" })
  }
}

/**
 * Handle successful payment
 */
async function handlePaymentIntentSucceeded(
  event: Stripe.Event,
  req: MedusaRequest,
  logger: any
) {
  const paymentIntent = event.data.object as Stripe.PaymentIntent
  const sessionId = paymentIntent.metadata?.medusa_session_id
  const brandId = paymentIntent.metadata?.brand_id

  logger.info(
    `Payment succeeded: ${paymentIntent.id}, amount: ${paymentIntent.amount}, session: ${sessionId}, brand: ${brandId}`
  )

  // Emit event for order processing
  const eventBus = req.scope.resolve(ContainerRegistrationKeys.EVENT_BUS)
  await eventBus.emit("payment.captured", {
    payment_intent_id: paymentIntent.id,
    session_id: sessionId,
    brand_id: brandId,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    payment_method_type: paymentIntent.payment_method_types?.[0],
    customer_email: paymentIntent.receipt_email,
  })
}

/**
 * Handle failed payment
 */
async function handlePaymentIntentFailed(
  event: Stripe.Event,
  req: MedusaRequest,
  logger: any
) {
  const paymentIntent = event.data.object as Stripe.PaymentIntent
  const sessionId = paymentIntent.metadata?.medusa_session_id
  const error = paymentIntent.last_payment_error

  logger.warn(
    `Payment failed: ${paymentIntent.id}, error: ${error?.message}, code: ${error?.code}`
  )

  const eventBus = req.scope.resolve(ContainerRegistrationKeys.EVENT_BUS)
  await eventBus.emit("payment.failed", {
    payment_intent_id: paymentIntent.id,
    session_id: sessionId,
    error_message: error?.message,
    error_code: error?.code,
    decline_code: error?.decline_code,
  })
}

/**
 * Handle canceled payment
 */
async function handlePaymentIntentCanceled(
  event: Stripe.Event,
  req: MedusaRequest,
  logger: any
) {
  const paymentIntent = event.data.object as Stripe.PaymentIntent
  const sessionId = paymentIntent.metadata?.medusa_session_id

  logger.info(`Payment canceled: ${paymentIntent.id}`)

  const eventBus = req.scope.resolve(ContainerRegistrationKeys.EVENT_BUS)
  await eventBus.emit("payment.canceled", {
    payment_intent_id: paymentIntent.id,
    session_id: sessionId,
    cancellation_reason: paymentIntent.cancellation_reason,
  })
}

/**
 * Handle refund
 */
async function handleChargeRefunded(
  event: Stripe.Event,
  req: MedusaRequest,
  logger: any
) {
  const charge = event.data.object as Stripe.Charge
  const refunds = charge.refunds?.data || []
  const latestRefund = refunds[0]

  logger.info(
    `Charge refunded: ${charge.id}, amount: ${charge.amount_refunded}`
  )

  const eventBus = req.scope.resolve(ContainerRegistrationKeys.EVENT_BUS)
  await eventBus.emit("payment.refunded", {
    charge_id: charge.id,
    payment_intent_id: charge.payment_intent,
    refund_id: latestRefund?.id,
    amount_refunded: charge.amount_refunded,
    refund_reason: latestRefund?.reason,
  })
}

/**
 * Handle dispute
 */
async function handleDisputeCreated(
  event: Stripe.Event,
  req: MedusaRequest,
  logger: any
) {
  const dispute = event.data.object as Stripe.Dispute

  logger.warn(
    `Dispute created: ${dispute.id}, charge: ${dispute.charge}, reason: ${dispute.reason}`
  )

  const eventBus = req.scope.resolve(ContainerRegistrationKeys.EVENT_BUS)
  await eventBus.emit("payment.disputed", {
    dispute_id: dispute.id,
    charge_id: dispute.charge,
    amount: dispute.amount,
    reason: dispute.reason,
    status: dispute.status,
  })
}

/**
 * Handle OXXO voucher creation
 */
async function handleOxxoVoucherCreated(
  event: Stripe.Event,
  req: MedusaRequest,
  logger: any
) {
  const paymentIntent = event.data.object as Stripe.PaymentIntent

  // Check if this is an OXXO payment
  if (!paymentIntent.payment_method_types?.includes("oxxo")) {
    return
  }

  const nextAction = paymentIntent.next_action
  if (nextAction?.type !== "oxxo_display_details") {
    return
  }

  const oxxoDetails = nextAction.oxxo_display_details
  const sessionId = paymentIntent.metadata?.medusa_session_id

  logger.info(
    `OXXO voucher created: ${paymentIntent.id}, number: ${oxxoDetails?.number}`
  )

  const eventBus = req.scope.resolve(ContainerRegistrationKeys.EVENT_BUS)
  await eventBus.emit("payment.oxxo_voucher_created", {
    payment_intent_id: paymentIntent.id,
    session_id: sessionId,
    voucher_number: oxxoDetails?.number,
    voucher_url: oxxoDetails?.hosted_voucher_url,
    expires_at: oxxoDetails?.expires_after
      ? new Date(oxxoDetails.expires_after * 1000).toISOString()
      : null,
  })
}

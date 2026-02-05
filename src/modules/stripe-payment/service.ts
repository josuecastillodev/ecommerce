/**
 * Stripe Payment Provider for Mexico
 * Supports credit/debit cards and OXXO Pay
 */

import {
  AbstractPaymentProvider,
  MedusaError,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import type {
  CreatePaymentProviderSession,
  PaymentProviderError,
  PaymentProviderSessionResponse,
  UpdatePaymentProviderSession,
  ProviderWebhookPayload,
  WebhookActionResult,
  Logger,
} from "@medusajs/framework/types"
import Stripe from "stripe"

type InjectedDependencies = {
  logger: Logger
}

export interface StripePaymentOptions {
  apiKey: string
  webhookSecret: string
  capture?: boolean // Auto-capture payments
}

// Payment method types supported
export type PaymentMethodType = "card" | "oxxo"

// Extended payment data for Mexico
interface MexicoPaymentData {
  payment_method_type?: PaymentMethodType
  customer_email?: string
  customer_name?: string
  oxxo_expires_after_days?: number
}

class StripePaymentProviderService extends AbstractPaymentProvider<StripePaymentOptions> {
  static identifier = "stripe-mexico"

  protected stripe_: Stripe
  protected options_: StripePaymentOptions
  protected logger_: Logger

  constructor({ logger }: InjectedDependencies, options: StripePaymentOptions) {
    super(arguments[0], options)

    this.logger_ = logger
    this.options_ = options

    this.stripe_ = new Stripe(options.apiKey, {
      apiVersion: "2024-11-20.acacia",
      typescript: true,
    })
  }

  /**
   * Get payment status from Stripe PaymentIntent status
   */
  private getPaymentStatus(
    paymentIntent: Stripe.PaymentIntent
  ): PaymentSessionStatus {
    switch (paymentIntent.status) {
      case "requires_payment_method":
      case "requires_confirmation":
      case "requires_action":
        return PaymentSessionStatus.PENDING
      case "processing":
        return PaymentSessionStatus.PENDING
      case "requires_capture":
        return PaymentSessionStatus.AUTHORIZED
      case "canceled":
        return PaymentSessionStatus.CANCELED
      case "succeeded":
        return PaymentSessionStatus.CAPTURED
      default:
        return PaymentSessionStatus.PENDING
    }
  }

  /**
   * Build error response
   */
  private buildError(
    message: string,
    error: Stripe.errors.StripeError | Error
  ): PaymentProviderError {
    return {
      error: message,
      code: "code" in error ? error.code : "unknown_error",
      detail: error.message,
    }
  }

  /**
   * Initialize a payment session
   */
  async initiatePayment(
    input: CreatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    const {
      amount,
      currency_code,
      context,
    } = input

    const { customer, email } = context

    // Get payment method type from context (default to card)
    const paymentData = context.extra as MexicoPaymentData | undefined
    const paymentMethodType = paymentData?.payment_method_type || "card"

    try {
      // Build payment method types based on selection
      const paymentMethodTypes: Stripe.PaymentIntentCreateParams.PaymentMethodType[] = []

      if (paymentMethodType === "oxxo") {
        paymentMethodTypes.push("oxxo")
      } else {
        paymentMethodTypes.push("card")
      }

      // Create Stripe customer if not exists
      let stripeCustomerId: string | undefined

      if (customer?.metadata?.stripe_customer_id) {
        stripeCustomerId = customer.metadata.stripe_customer_id as string
      } else if (email) {
        // Create new Stripe customer
        const stripeCustomer = await this.stripe_.customers.create({
          email,
          name: paymentData?.customer_name,
          metadata: {
            medusa_customer_id: customer?.id || "",
          },
        })
        stripeCustomerId = stripeCustomer.id
      }

      // Build PaymentIntent params
      const intentParams: Stripe.PaymentIntentCreateParams = {
        amount: Math.round(amount), // Amount in cents
        currency: currency_code.toLowerCase(),
        payment_method_types: paymentMethodTypes,
        capture_method: this.options_.capture ? "automatic" : "manual",
        metadata: {
          medusa_session_id: context.session_id || "",
          brand_id: context.extra?.brand_id || "",
        },
      }

      // Add customer if available
      if (stripeCustomerId) {
        intentParams.customer = stripeCustomerId
      }

      // OXXO specific options
      if (paymentMethodType === "oxxo") {
        intentParams.payment_method_options = {
          oxxo: {
            expires_after_days: paymentData?.oxxo_expires_after_days || 3,
          },
        }
      }

      const paymentIntent = await this.stripe_.paymentIntents.create(intentParams)

      this.logger_.info(
        `Created Stripe PaymentIntent ${paymentIntent.id} for ${amount} ${currency_code}`
      )

      return {
        data: {
          id: paymentIntent.id,
          client_secret: paymentIntent.client_secret,
          status: paymentIntent.status,
          payment_method_type: paymentMethodType,
          stripe_customer_id: stripeCustomerId,
        },
      }
    } catch (error) {
      this.logger_.error(`Failed to create PaymentIntent: ${error.message}`)
      return this.buildError("Failed to initiate payment", error)
    }
  }

  /**
   * Update an existing payment session
   */
  async updatePayment(
    input: UpdatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    const { amount, currency_code, context, data } = input
    const paymentIntentId = data.id as string

    try {
      const paymentIntent = await this.stripe_.paymentIntents.update(
        paymentIntentId,
        {
          amount: Math.round(amount),
          currency: currency_code.toLowerCase(),
          metadata: {
            medusa_session_id: context.session_id || "",
            brand_id: context.extra?.brand_id || "",
          },
        }
      )

      return {
        data: {
          ...data,
          id: paymentIntent.id,
          client_secret: paymentIntent.client_secret,
          status: paymentIntent.status,
        },
      }
    } catch (error) {
      this.logger_.error(`Failed to update PaymentIntent: ${error.message}`)
      return this.buildError("Failed to update payment", error)
    }
  }

  /**
   * Authorize a payment (for manual capture)
   */
  async authorizePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | { status: PaymentSessionStatus; data: Record<string, unknown> }> {
    const paymentIntentId = paymentSessionData.id as string

    try {
      const paymentIntent = await this.stripe_.paymentIntents.retrieve(
        paymentIntentId
      )

      return {
        status: this.getPaymentStatus(paymentIntent),
        data: {
          ...paymentSessionData,
          status: paymentIntent.status,
        },
      }
    } catch (error) {
      return this.buildError("Failed to authorize payment", error)
    }
  }

  /**
   * Capture an authorized payment
   */
  async capturePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    const paymentIntentId = paymentSessionData.id as string

    try {
      const paymentIntent = await this.stripe_.paymentIntents.capture(
        paymentIntentId
      )

      this.logger_.info(`Captured payment ${paymentIntentId}`)

      return {
        ...paymentSessionData,
        status: paymentIntent.status,
        captured_at: new Date().toISOString(),
      }
    } catch (error) {
      this.logger_.error(`Failed to capture payment: ${error.message}`)
      return this.buildError("Failed to capture payment", error)
    }
  }

  /**
   * Refund a payment
   */
  async refundPayment(
    paymentSessionData: Record<string, unknown>,
    refundAmount: number
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    const paymentIntentId = paymentSessionData.id as string

    try {
      const refund = await this.stripe_.refunds.create({
        payment_intent: paymentIntentId,
        amount: Math.round(refundAmount),
      })

      this.logger_.info(
        `Created refund ${refund.id} for ${refundAmount} on ${paymentIntentId}`
      )

      return {
        ...paymentSessionData,
        refund_id: refund.id,
        refund_status: refund.status,
        refunded_amount: refundAmount,
      }
    } catch (error) {
      this.logger_.error(`Failed to refund payment: ${error.message}`)
      return this.buildError("Failed to refund payment", error)
    }
  }

  /**
   * Cancel a payment
   */
  async cancelPayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    const paymentIntentId = paymentSessionData.id as string

    try {
      const paymentIntent = await this.stripe_.paymentIntents.cancel(
        paymentIntentId
      )

      this.logger_.info(`Cancelled payment ${paymentIntentId}`)

      return {
        ...paymentSessionData,
        status: paymentIntent.status,
        cancelled_at: new Date().toISOString(),
      }
    } catch (error) {
      // If already cancelled or succeeded, don't throw
      if (error.code === "payment_intent_unexpected_state") {
        return paymentSessionData
      }
      return this.buildError("Failed to cancel payment", error)
    }
  }

  /**
   * Delete a payment session
   */
  async deletePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    return this.cancelPayment(paymentSessionData)
  }

  /**
   * Retrieve payment status
   */
  async retrievePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | Record<string, unknown>> {
    const paymentIntentId = paymentSessionData.id as string

    try {
      const paymentIntent = await this.stripe_.paymentIntents.retrieve(
        paymentIntentId,
        {
          expand: ["latest_charge", "payment_method"],
        }
      )

      return {
        ...paymentSessionData,
        id: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        payment_method: paymentIntent.payment_method,
        latest_charge: paymentIntent.latest_charge,
      }
    } catch (error) {
      return this.buildError("Failed to retrieve payment", error)
    }
  }

  /**
   * Get payment session status
   */
  async getPaymentStatus(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentSessionStatus> {
    const paymentIntentId = paymentSessionData.id as string

    try {
      const paymentIntent = await this.stripe_.paymentIntents.retrieve(
        paymentIntentId
      )

      return this.getPaymentStatus(paymentIntent)
    } catch (error) {
      this.logger_.error(`Failed to get payment status: ${error.message}`)
      return PaymentSessionStatus.ERROR
    }
  }

  /**
   * Handle incoming webhooks
   */
  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const event = payload.data as { event: Stripe.Event }
    const stripeEvent = event.event

    this.logger_.info(`Processing Stripe webhook: ${stripeEvent.type}`)

    switch (stripeEvent.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = stripeEvent.data.object as Stripe.PaymentIntent
        return {
          action: "captured",
          data: {
            session_id: paymentIntent.metadata.medusa_session_id,
            amount: paymentIntent.amount,
          },
        }
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = stripeEvent.data.object as Stripe.PaymentIntent
        return {
          action: "failed",
          data: {
            session_id: paymentIntent.metadata.medusa_session_id,
            error: paymentIntent.last_payment_error?.message || "Payment failed",
          },
        }
      }

      case "charge.refunded": {
        const charge = stripeEvent.data.object as Stripe.Charge
        return {
          action: "refunded",
          data: {
            session_id: charge.metadata?.medusa_session_id,
            amount: charge.amount_refunded,
          },
        }
      }

      default:
        return {
          action: "not_supported",
        }
    }
  }
}

export default StripePaymentProviderService

/**
 * Store Stripe Payments API
 * GET /store/payments/stripe - Get available payment methods for Mexico
 * POST /store/payments/stripe - Create payment intent
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MEXICO_PAYMENT_METHODS, type PaymentMethodType } from "../../../../modules/stripe-payment/types"

const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || ""

// GET /store/payments/stripe - Get available payment methods
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { amount } = req.query

  // Filter payment methods based on amount if provided
  let availableMethods = Object.values(MEXICO_PAYMENT_METHODS)

  if (amount) {
    const amountInCents = Number(amount)
    availableMethods = availableMethods.filter((method) => {
      if (method.min_amount && amountInCents < method.min_amount) {
        return false
      }
      if (method.max_amount && amountInCents > method.max_amount) {
        return false
      }
      return true
    })
  }

  res.json({
    payment_methods: availableMethods,
    publishable_key: STRIPE_PUBLISHABLE_KEY,
    currency: "MXN",
    country: "MX",
  })
}

// POST /store/payments/stripe - Create payment intent for checkout
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const {
    cart_id,
    payment_method_type = "card",
    customer_email,
    customer_name,
  } = req.body as {
    cart_id: string
    payment_method_type?: PaymentMethodType
    customer_email?: string
    customer_name?: string
  }

  if (!cart_id) {
    res.status(400).json({ error: "cart_id is required" })
    return
  }

  // Validate payment method type
  if (!MEXICO_PAYMENT_METHODS[payment_method_type]) {
    res.status(400).json({
      error: `Invalid payment method. Available: ${Object.keys(MEXICO_PAYMENT_METHODS).join(", ")}`,
    })
    return
  }

  try {
    // Get cart to retrieve amount
    const query = req.scope.resolve("query")
    const { data: carts } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "total",
        "currency_code",
        "email",
        "customer.id",
        "customer.email",
        "items.*",
        "region.id",
      ],
      filters: { id: cart_id },
    })

    if (carts.length === 0) {
      res.status(404).json({ error: "Cart not found" })
      return
    }

    const cart = carts[0] as any

    // Validate amount for OXXO
    const method = MEXICO_PAYMENT_METHODS[payment_method_type]
    if (method.min_amount && cart.total < method.min_amount) {
      res.status(400).json({
        error: `Minimum amount for ${method.label} is ${method.min_amount / 100} MXN`,
      })
      return
    }
    if (method.max_amount && cart.total > method.max_amount) {
      res.status(400).json({
        error: `Maximum amount for ${method.label} is ${method.max_amount / 100} MXN`,
      })
      return
    }

    // Initialize payment session through Medusa's payment module
    const paymentModule = req.scope.resolve("paymentModuleService")

    const paymentSession = await paymentModule.createPaymentSession("stripe-mexico", {
      amount: cart.total,
      currency_code: cart.currency_code || "MXN",
      context: {
        cart_id: cart.id,
        customer: cart.customer,
        email: customer_email || cart.email || cart.customer?.email,
        extra: {
          payment_method_type,
          customer_email: customer_email || cart.email,
          customer_name,
          brand_id: cart.metadata?.brand_id,
        },
      },
    })

    res.json({
      client_secret: paymentSession.data?.client_secret,
      payment_intent_id: paymentSession.data?.id,
      payment_method_type,
      publishable_key: STRIPE_PUBLISHABLE_KEY,
      amount: cart.total,
      currency: cart.currency_code || "MXN",
    })
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to create payment session",
      details: error.message,
    })
  }
}

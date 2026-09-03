import { z } from "zod"

/**
 * Customer Registration Schema
 */
export const CustomerRegistrationSchema = z.object({
  email: z
    .string()
    .email("El email debe ser válido")
    .min(1, "El email es requerido"),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "La contraseña debe contener al menos una mayúscula, una minúscula y un número"
    ),
  first_name: z
    .string()
    .min(2, "El nombre debe tener al menos 2 caracteres")
    .max(100, "El nombre no puede exceder 100 caracteres"),
  last_name: z
    .string()
    .min(2, "El apellido debe tener al menos 2 caracteres")
    .max(100, "El apellido no puede exceder 100 caracteres"),
  phone: z
    .string()
    .regex(/^\+?[1-9]\d{9,14}$/, "El teléfono debe ser válido (ej: +525512345678)")
    .optional(),
  brand_id: z
    .string()
    .min(1, "El brand_id es requerido"),
  marketing_consent: z
    .boolean()
    .optional()
    .default(false),
})

export type CustomerRegistrationInput = z.infer<typeof CustomerRegistrationSchema>

/**
 * Customer Login Schema
 */
export const CustomerLoginSchema = z.object({
  email: z
    .string()
    .email("El email debe ser válido")
    .min(1, "El email es requerido"),
  password: z
    .string()
    .min(1, "La contraseña es requerida"),
  brand_id: z
    .string()
    .min(1, "El brand_id es requerido"),
})

export type CustomerLoginInput = z.infer<typeof CustomerLoginSchema>

/**
 * Update Customer Profile Schema
 */
export const UpdateCustomerProfileSchema = z.object({
  first_name: z
    .string()
    .min(2, "El nombre debe tener al menos 2 caracteres")
    .max(100, "El nombre no puede exceder 100 caracteres")
    .optional(),
  last_name: z
    .string()
    .min(2, "El apellido debe tener al menos 2 caracteres")
    .max(100, "El apellido no puede exceder 100 caracteres")
    .optional(),
  phone: z
    .string()
    .regex(/^\+?[1-9]\d{9,14}$/, "El teléfono debe ser válido")
    .nullable()
    .optional(),
  marketing_consent: z
    .boolean()
    .optional(),
  language_preference: z
    .enum(["es", "en"])
    .optional(),
  metadata: z
    .record(z.unknown())
    .optional(),
})

export type UpdateCustomerProfileInput = z.infer<typeof UpdateCustomerProfileSchema>

/**
 * Create Address Schema
 * Optimized for Mexico addresses
 */
export const CreateAddressSchema = z.object({
  first_name: z
    .string()
    .min(2, "El nombre debe tener al menos 2 caracteres")
    .max(100, "El nombre no puede exceder 100 caracteres"),
  last_name: z
    .string()
    .min(2, "El apellido debe tener al menos 2 caracteres")
    .max(100, "El apellido no puede exceder 100 caracteres"),
  address_1: z
    .string()
    .min(5, "La dirección debe tener al menos 5 caracteres")
    .max(255, "La dirección no puede exceder 255 caracteres"),
  address_2: z
    .string()
    .max(255, "La dirección 2 no puede exceder 255 caracteres")
    .optional(),
  city: z
    .string()
    .min(2, "La ciudad debe tener al menos 2 caracteres")
    .max(100, "La ciudad no puede exceder 100 caracteres"),
  province: z
    .string()
    .max(100, "El estado no puede exceder 100 caracteres")
    .optional(),
  postal_code: z
    .string()
    .regex(/^\d{5}$/, "El código postal debe tener 5 dígitos"),
  country_code: z
    .string()
    .length(2, "El código de país debe tener 2 caracteres")
    .default("MX"),
  phone: z
    .string()
    .regex(/^\+?[1-9]\d{9,14}$/, "El teléfono debe ser válido")
    .optional(),
  company: z
    .string()
    .max(100, "La empresa no puede exceder 100 caracteres")
    .optional(),
  is_default_shipping: z
    .boolean()
    .optional()
    .default(false),
  is_default_billing: z
    .boolean()
    .optional()
    .default(false),
  metadata: z
    .record(z.unknown())
    .optional(),
})

export type CreateAddressInput = z.infer<typeof CreateAddressSchema>

/**
 * Update Address Schema
 */
export const UpdateAddressSchema = z.object({
  first_name: z
    .string()
    .min(2, "El nombre debe tener al menos 2 caracteres")
    .max(100, "El nombre no puede exceder 100 caracteres")
    .optional(),
  last_name: z
    .string()
    .min(2, "El apellido debe tener al menos 2 caracteres")
    .max(100, "El apellido no puede exceder 100 caracteres")
    .optional(),
  address_1: z
    .string()
    .min(5, "La dirección debe tener al menos 5 caracteres")
    .max(255, "La dirección no puede exceder 255 caracteres")
    .optional(),
  address_2: z
    .string()
    .max(255, "La dirección 2 no puede exceder 255 caracteres")
    .nullable()
    .optional(),
  city: z
    .string()
    .min(2, "La ciudad debe tener al menos 2 caracteres")
    .max(100, "La ciudad no puede exceder 100 caracteres")
    .optional(),
  province: z
    .string()
    .max(100, "El estado no puede exceder 100 caracteres")
    .nullable()
    .optional(),
  postal_code: z
    .string()
    .regex(/^\d{5}$/, "El código postal debe tener 5 dígitos")
    .optional(),
  country_code: z
    .string()
    .length(2, "El código de país debe tener 2 caracteres")
    .optional(),
  phone: z
    .string()
    .regex(/^\+?[1-9]\d{9,14}$/, "El teléfono debe ser válido")
    .nullable()
    .optional(),
  company: z
    .string()
    .max(100, "La empresa no puede exceder 100 caracteres")
    .nullable()
    .optional(),
  is_default_shipping: z
    .boolean()
    .optional(),
  is_default_billing: z
    .boolean()
    .optional(),
  metadata: z
    .record(z.unknown())
    .optional(),
})

export type UpdateAddressInput = z.infer<typeof UpdateAddressSchema>

/**
 * Validate request body helper
 */
export function validateRequest<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    const errors = result.error.errors.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    }))
    throw new ValidationError("Validation failed", errors)
  }
  return result.data
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public errors: Array<{ field: string; message: string }>
  ) {
    super(message)
    this.name = "ValidationError"
  }
}

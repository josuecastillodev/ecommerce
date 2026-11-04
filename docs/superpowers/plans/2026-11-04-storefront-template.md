# Storefront template multi-tienda — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear el repo `ecommerce-storefront`: monorepo pnpm con capa de datos mock, UI compartida de carrito/checkout/cuenta, una app template y un comando para generar tiendas nuevas.

**Architecture:** `packages/commerce` tiene la lógica pura (catálogo, carrito, pedidos, clientes) sobre mocks con forma de la Store API de Medusa, más un adaptador Next (`/next`) que guarda el estado en cookies. `packages/ui` exporta pantallas compartidas que se pintan con tokens CSS de la marca. Cada `apps/<slug>` es una app Next.js con diseño propio que reexporta las pantallas compartidas.

**Tech Stack:** Next.js (App Router, server actions), React, TypeScript estricto, Tailwind CSS v4, zod 4, `@medusajs/types@2.20.1`, Vitest, Playwright, pnpm workspaces, Node 24.

**Spec:** `docs/superpowers/specs/2026-11-04-storefront-template-design.md` (repo backend `ecommerce`).

**Ubicación:** el repo nuevo vive en `/Users/josue.castpon/dev/ecommerce-storefront` (hermano del backend). Todas las rutas de archivos de este plan son relativas a ese repo. Solo git local: no crear remoto en GitHub ni hacer push.

## Desviaciones del spec

- **`store.config.ts` no se crea.** `packages/commerce` no puede importar archivos de una app, así que la marca llega por la variable de entorno `STORE_BRAND`. Es el mismo mecanismo que usará `MEDUSA_PUBLISHABLE_KEY`. Locale `es-MX` y moneda MXN quedan como defaults de `formatPrice`.
- La pantalla de confirmación de pedido es la ruta `app/order/[id]` (el spec la menciona como paso del checkout sin ruta).

## Global Constraints

- Node `24.1.0` (`.nvmrc`), `packageManager: pnpm@10.28.2`. Corre `nvm use` antes de cualquier `pnpm`. Con Node 22.9 `pnpm run` falla.
- Instalar dependencias siempre con `pnpm`; `@medusajs/types` fijo en `2.20.1` (versión del backend).
- Cero llamadas HTTP a Medusa; `COMMERCE_SOURCE` solo acepta `mock`.
- Precios en centavos MXN (`45000` = $450.00); envíos Estándar `9900` y Exprés `19900`.
- Textos de UI en español (es-MX).
- Commits: `tipo: mensaje corto` (feat, fix, test, chore, docs), sin líneas de crédito ni `Co-Authored-By`.

## Review Focus

1. Cookie de carrito alterada, JSON roto o cantidades fuera de rango → carrito vacío, nunca un 500 (Task 3, `parseCart`).
2. Cantidad del formulario `0`, negativa, decimal, texto o `999` → quitar, redondear hacia abajo o topar en 10 (Task 3, `clampQuantity`/`addItem`/`updateItem`).
3. Variante o handle de otra marca → la variante se rechaza y el producto da 404 (Task 2 `getProduct`/`findVariant`, Task 3 `addItem`).
4. Pagar con carrito vacío, sin dirección o sin envío (URL directa, doble envío del form) → no se crea pedido y hay mensaje (Task 4, `completeCart`).
5. `?error=` arbitrario en la URL (`toString`, texto inyectado) → no se pinta nada que venga del usuario (Task 3, `errorMessage`).

---

### Task 1: Scaffold del monorepo y formato de precio

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `.gitignore`, `tsconfig.base.json`
- Create: `packages/commerce/package.json`, `packages/commerce/tsconfig.json`
- Create: `packages/commerce/src/money.ts`
- Test: `packages/commerce/src/money.test.ts`

**Interfaces:**
- Produces: `formatPrice(amount: number, currency?: string, locale?: string): string` (amount en centavos).

- [ ] **Step 1: Crear el repo y los archivos raíz**

```bash
mkdir -p /Users/josue.castpon/dev/ecommerce-storefront && cd /Users/josue.castpon/dev/ecommerce-storefront && git init
```

`package.json`:
```json
{
  "name": "ecommerce-storefront",
  "private": true,
  "packageManager": "pnpm@10.28.2",
  "scripts": {
    "new-store": "node scripts/new-store.mjs",
    "test": "node --test scripts/*.test.mjs && pnpm -r test"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`.nvmrc`:
```
24.1.0
```

`.gitignore`:
```
node_modules
.next
.env
.env.local
test-results
playwright-report
*.tsbuildinfo
next-env.d.ts
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "noEmit": true
  }
}
```

`packages/commerce/package.json`:
```json
{
  "name": "@store/commerce",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./next": "./src/next/data.ts",
    "./next/actions": "./src/next/actions.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`packages/commerce/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 2: Instalar dependencias**

```bash
cd /Users/josue.castpon/dev/ecommerce-storefront && nvm use
pnpm add -D -w typescript
pnpm --filter @store/commerce add zod @medusajs/types@2.20.1
pnpm --filter @store/commerce add -D vitest typescript next react react-dom @types/react @types/node
```

Después agrega a `packages/commerce/package.json` el bloque `"peerDependencies": { "next": "*" }` (el adaptador `/next` usa `next/headers`).

- [ ] **Step 3: Escribir el test que falla**

`packages/commerce/src/money.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { formatPrice } from "./money"

describe("formatPrice", () => {
  it("convierte centavos a MXN es-MX", () => {
    expect(formatPrice(45000)).toBe("$450.00")
    expect(formatPrice(9900)).toBe("$99.00")
    expect(formatPrice(0)).toBe("$0.00")
  })
})
```

- [ ] **Step 4: Correr y verificar que falla**

Run: `pnpm --filter @store/commerce test`
Expected: FAIL, no se puede resolver `./money`.

- [ ] **Step 5: Implementar**

`packages/commerce/src/money.ts`:
```ts
/** Los montos viajan en centavos, como el seed del backend. */
export function formatPrice(amount: number, currency = "MXN", locale = "es-MX"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount / 100)
}
```

- [ ] **Step 6: Correr y verificar que pasa**

Run: `pnpm --filter @store/commerce test`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: scaffold del monorepo y formato de precio"
```

---

### Task 2: Tipos, mocks y catálogo

**Files:**
- Create: `packages/commerce/src/types.ts`, `packages/commerce/src/mocks.ts`, `packages/commerce/src/catalog.ts`
- Test: `packages/commerce/src/catalog.test.ts`

**Interfaces:**
- Produces (tipos): `Brand`, `Category`, `Variant`, `Product`, `ShippingOption`.
- Produces (funciones puras, la marca es el slug):
  - `getBrand(brand: string): Brand` (lanza `Error` si no existe)
  - `listCategories(brand: string): Category[]`
  - `getCategory(brand: string, handle: string): Category | null`
  - `listProducts(brand: string, opts?: { category?: string }): Product[]`
  - `getProduct(brand: string, handle: string): Product | null`
  - `findVariant(brand: string, variantId: string): { product: Product; variant: Variant } | null`
  - `getShippingOption(id: string): ShippingOption | null`
  - constantes `SHIPPING_OPTIONS: ShippingOption[]`, `MOCK_CUSTOMERS`

- [ ] **Step 1: Escribir el test que falla**

`packages/commerce/src/catalog.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { findVariant, getBrand, getCategory, getProduct, getShippingOption, listCategories, listProducts } from "./catalog"

describe("catalog", () => {
  it("getBrand devuelve la marca con la forma de GET /store/brand", () => {
    expect(getBrand("urban-street")).toMatchObject({ slug: "urban-street", name: "Urban Street", sales_channel_id: "sc_urban_street" })
    expect(() => getBrand("no-existe")).toThrow(/no-existe/)
  })

  it("las categorías y productos son por marca", () => {
    expect(listCategories("urban-street").map((c) => c.handle)).toEqual(["hoodies", "playeras"])
    expect(listCategories("no-existe")).toEqual([])
    expect(getCategory("urban-street", "camisas")).toBeNull()
  })

  it("listProducts filtra por categoría", () => {
    const hoodies = listProducts("urban-street", { category: "hoodies" })
    expect(hoodies.length).toBe(2)
    expect(hoodies.every((p) => p.categories.some((c) => c.handle === "hoodies"))).toBe(true)
  })

  it("no expone productos ni variantes de otra marca", () => {
    expect(getProduct("urban-street", "hoodie-oversize")?.title).toBe("Hoodie Oversize")
    expect(getProduct("classic-threads", "hoodie-oversize")).toBeNull()
    expect(findVariant("urban-street", "variant_hoodie-oversize_m")?.variant.title).toBe("M")
    expect(findVariant("classic-threads", "variant_hoodie-oversize_m")).toBeNull()
  })

  it("opciones de envío del seed", () => {
    expect(getShippingOption("so_standard")?.amount).toBe(9900)
    expect(getShippingOption("so_express")?.amount).toBe(19900)
    expect(getShippingOption("nope")).toBeNull()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm --filter @store/commerce test`
Expected: FAIL, no se puede resolver `./catalog`.

- [ ] **Step 3: Implementar tipos**

`packages/commerce/src/types.ts`:
```ts
import type { HttpTypes } from "@medusajs/types"

/** Forma de `GET /store/brand` del backend (sin `active`). */
export type Brand = {
  sales_channel_id: string
  slug: string
  name: string
  description: string | null
  logo_url: string | null
  primary_color: string
  secondary_color: string
}

export type Category = Pick<HttpTypes.StoreProductCategory, "id" | "name" | "handle">

export type Variant = Pick<HttpTypes.StoreProductVariant, "id" | "title" | "sku"> & {
  calculated_price: { calculated_amount: number; currency_code: string }
}

export type Product = Pick<HttpTypes.StoreProduct, "id" | "handle" | "title" | "description" | "thumbnail"> & {
  categories: Category[]
  variants: Variant[]
}

export type ShippingOption = { id: string; name: string; amount: number }
```

Si TypeScript dice que una clave del `Pick` no existe, revisa los nombres en `node_modules/@medusajs/types/dist/http/product/store/` y usa los de la 2.20.1. No cambies los nombres de los campos que consumen las demás tareas.

- [ ] **Step 4: Implementar mocks**

`packages/commerce/src/mocks.ts`:
```ts
import type { Brand, Category, Product, ShippingOption, Variant } from "./types"

const img = (text: string) => `https://placehold.co/600x800?text=${encodeURIComponent(text)}`

const variants = (handle: string, sku: string, amount: number): Variant[] =>
  ["S", "M", "L"].map((size) => ({
    id: `variant_${handle}_${size.toLowerCase()}`,
    title: size,
    sku: `${sku}-${size}`,
    calculated_price: { calculated_amount: amount, currency_code: "mxn" },
  }))

const product = (handle: string, title: string, description: string, sku: string, amount: number, categories: Category[]): Product => ({
  id: `prod_${handle}`,
  handle,
  title,
  description,
  thumbnail: img(title),
  categories,
  variants: variants(handle, sku, amount),
})

export const BRANDS: Brand[] = [
  {
    sales_channel_id: "sc_urban_street",
    slug: "urban-street",
    name: "Urban Street",
    description: "Streetwear para la ciudad.",
    logo_url: null,
    primary_color: "#111111",
    secondary_color: "#F5F5F5",
  },
  {
    sales_channel_id: "sc_classic_threads",
    slug: "classic-threads",
    name: "Classic Threads",
    description: "Sastrería clásica con un giro moderno.",
    logo_url: null,
    primary_color: "#1F3A5F",
    secondary_color: "#FAF7F0",
  },
]

const US = { hoodies: { id: "pcat_us_hoodies", name: "Hoodies", handle: "hoodies" }, playeras: { id: "pcat_us_playeras", name: "Playeras", handle: "playeras" } }
const CT = { camisas: { id: "pcat_ct_camisas", name: "Camisas", handle: "camisas" }, sacos: { id: "pcat_ct_sacos", name: "Sacos", handle: "sacos" } }

export const CATEGORIES: Record<string, Category[]> = {
  "urban-street": [US.hoodies, US.playeras],
  "classic-threads": [CT.camisas, CT.sacos],
}

export const PRODUCTS: Record<string, Product[]> = {
  "urban-street": [
    product("hoodie-oversize", "Hoodie Oversize", "Algodón pesado, corte amplio.", "US-HOOD", 89900, [US.hoodies]),
    product("hoodie-zip", "Hoodie Zip", "Cierre completo y bolsillos laterales.", "US-ZIP", 99900, [US.hoodies]),
    product("playera-basica", "Playera Básica", "Algodón peinado de 180 g.", "US-TEE", 34900, [US.playeras]),
  ],
  "classic-threads": [
    product("camisa-oxford", "Camisa Oxford", "Oxford azul, cuello abotonado.", "CT-OXF", 69900, [CT.camisas]),
    product("camisa-lino", "Camisa de Lino", "Lino ligero para clima cálido.", "CT-LIN", 79900, [CT.camisas]),
    product("saco-lino", "Saco de Lino", "Saco sin forro, dos botones.", "CT-SAC", 249900, [CT.sacos]),
  ],
}

export const SHIPPING_OPTIONS: ShippingOption[] = [
  { id: "so_standard", name: "Estándar", amount: 9900 },
  { id: "so_express", name: "Exprés", amount: 19900 },
]

/** Credenciales de prueba, como los clientes del seed del backend. */
export const MOCK_CUSTOMERS = [
  { brand: "urban-street", email: "ana@urban-street.mx", password: "Password123", first_name: "Ana", last_name: "López" },
  { brand: "classic-threads", email: "luis@classic-threads.mx", password: "Password123", first_name: "Luis", last_name: "Martínez" },
]
```

- [ ] **Step 5: Implementar catálogo**

`packages/commerce/src/catalog.ts`:
```ts
import { BRANDS, CATEGORIES, PRODUCTS, SHIPPING_OPTIONS } from "./mocks"
import type { Brand, Category, Product, ShippingOption, Variant } from "./types"

export { MOCK_CUSTOMERS, SHIPPING_OPTIONS } from "./mocks"

export function getBrand(brand: string): Brand {
  const found = BRANDS.find((b) => b.slug === brand)
  if (!found) throw new Error(`Marca desconocida: ${brand}`)
  return found
}

export function listCategories(brand: string): Category[] {
  return CATEGORIES[brand] ?? []
}

export function getCategory(brand: string, handle: string): Category | null {
  return listCategories(brand).find((c) => c.handle === handle) ?? null
}

export function listProducts(brand: string, opts: { category?: string } = {}): Product[] {
  const all = PRODUCTS[brand] ?? []
  return opts.category ? all.filter((p) => p.categories.some((c) => c.handle === opts.category)) : all
}

export function getProduct(brand: string, handle: string): Product | null {
  return listProducts(brand).find((p) => p.handle === handle) ?? null
}

export function findVariant(brand: string, variantId: string): { product: Product; variant: Variant } | null {
  for (const product of listProducts(brand)) {
    const variant = product.variants.find((v) => v.id === variantId)
    if (variant) return { product, variant }
  }
  return null
}

export function getShippingOption(id: string): ShippingOption | null {
  return SHIPPING_OPTIONS.find((o) => o.id === id) ?? null
}
```

- [ ] **Step 6: Correr y verificar que pasa**

Run: `pnpm --filter @store/commerce test && pnpm --filter @store/commerce typecheck`
Expected: PASS (6 tests), typecheck sin errores.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: catalogo mock por marca con forma de la Store API"
```

---

### Task 3: Carrito puro y errores

**Files:**
- Create: `packages/commerce/src/errors.ts`, `packages/commerce/src/cart.ts`
- Test: `packages/commerce/src/errors.test.ts`, `packages/commerce/src/cart.test.ts`

**Interfaces:**
- Consumes: `findVariant`, `getShippingOption` (Task 2), `ShippingOption`.
- Produces:
  - `type CommerceErrorCode = "variant_not_found" | "invalid_address" | "invalid_shipping" | "empty_cart" | "missing_address" | "missing_shipping" | "invalid_credentials" | "invalid_registration" | "email_taken" | "address_limit"`
  - `class CommerceError extends Error { code: CommerceErrorCode }`
  - `errorMessage(code?: string): string | null`
  - `MAX_QUANTITY = 10`, `AddressSchema`, `type Address`, `CartLineSchema`, `type CartLine`, `type CartState`, `type Cart`
  - `emptyCart(): CartState`, `parseCart(raw?: string): CartState`, `clampQuantity(n: number): number`
  - `addItem(state, brand, variantId, quantity): CartState`, `updateItem(state, variantId, quantity)`, `removeItem(state, variantId)`
  - `setAddresses(state, input: { email: unknown; address: unknown }): CartState`, `setShipping(state, optionId): CartState`
  - `buildCart(state: CartState, brand: string): Cart`

- [ ] **Step 1: Escribir los tests que fallan**

`packages/commerce/src/errors.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { CommerceError, errorMessage } from "./errors"

describe("errorMessage", () => {
  it("traduce códigos conocidos", () => {
    expect(errorMessage("invalid_credentials")).toBe("Correo o contraseña incorrectos.")
  })

  it("ignora códigos desconocidos o heredados del prototipo", () => {
    expect(errorMessage(undefined)).toBeNull()
    expect(errorMessage("<script>")).toBeNull()
    expect(errorMessage("toString")).toBeNull()
  })

  it("CommerceError lleva su código", () => {
    expect(new CommerceError("empty_cart").code).toBe("empty_cart")
  })
})
```

`packages/commerce/src/cart.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { addItem, buildCart, clampQuantity, emptyCart, MAX_QUANTITY, parseCart, removeItem, setAddresses, setShipping, updateItem } from "./cart"

const B = "urban-street"
const HOODIE_M = "variant_hoodie-oversize_m"
const TEE_S = "variant_playera-basica_s"
const ADDRESS = { first_name: "Ana", last_name: "López", address_1: "Av. Reforma 222", city: "CDMX", province: "CDMX", postal_code: "06600", phone: "" }

describe("cantidades", () => {
  it("clampQuantity redondea hacia abajo y limita a [0, MAX]", () => {
    expect(clampQuantity(2.7)).toBe(2)
    expect(clampQuantity(-3)).toBe(0)
    expect(clampQuantity(Number.NaN)).toBe(0)
    expect(clampQuantity(999)).toBe(MAX_QUANTITY)
  })

  it("addItem suma sobre la misma variante y respeta el máximo", () => {
    let s = addItem(emptyCart(), B, HOODIE_M, 2)
    s = addItem(s, B, HOODIE_M, 3)
    expect(s.items).toEqual([{ variant_id: HOODIE_M, quantity: 5 }])
    expect(addItem(s, B, HOODIE_M, 50).items[0]?.quantity).toBe(MAX_QUANTITY)
  })

  it("addItem con cantidad 0, negativa o NaN no cambia el carrito", () => {
    const s = emptyCart()
    expect(addItem(s, B, HOODIE_M, 0)).toEqual(s)
    expect(addItem(s, B, HOODIE_M, -1)).toEqual(s)
    expect(addItem(s, B, HOODIE_M, Number("abc"))).toEqual(s)
  })

  it("addItem rechaza variantes de otra marca o inexistentes", () => {
    expect(() => addItem(emptyCart(), "classic-threads", HOODIE_M, 1)).toThrow(expect.objectContaining({ code: "variant_not_found" }))
    expect(() => addItem(emptyCart(), B, "variant_x", 1)).toThrow(expect.objectContaining({ code: "variant_not_found" }))
  })

  it("updateItem con 0 quita la línea; removeItem la quita", () => {
    const s = addItem(addItem(emptyCart(), B, HOODIE_M, 1), B, TEE_S, 1)
    expect(updateItem(s, HOODIE_M, 0).items.map((i) => i.variant_id)).toEqual([TEE_S])
    expect(updateItem(s, HOODIE_M, 4.9).items[0]?.quantity).toBe(4)
    expect(removeItem(s, TEE_S).items.map((i) => i.variant_id)).toEqual([HOODIE_M])
  })
})

describe("parseCart", () => {
  it("cookie ausente, JSON roto, forma inválida o cantidad fuera de rango → carrito vacío", () => {
    expect(parseCart(undefined)).toEqual(emptyCart())
    expect(parseCart("{no-json")).toEqual(emptyCart())
    expect(parseCart(JSON.stringify({ items: "x" }))).toEqual(emptyCart())
    expect(parseCart(JSON.stringify({ items: [{ variant_id: HOODIE_M, quantity: 999 }] }))).toEqual(emptyCart())
  })

  it("lee un carrito válido", () => {
    const s = addItem(emptyCart(), B, HOODIE_M, 2)
    expect(parseCart(JSON.stringify(s))).toEqual(s)
  })
})

describe("checkout del carrito", () => {
  it("setAddresses valida correo y código postal", () => {
    expect(setAddresses(emptyCart(), { email: "ana@example.com", address: ADDRESS }).shipping_address?.country_code).toBe("mx")
    expect(() => setAddresses(emptyCart(), { email: "no-es-correo", address: ADDRESS })).toThrow(expect.objectContaining({ code: "invalid_address" }))
    expect(() => setAddresses(emptyCart(), { email: "a@b.mx", address: { ...ADDRESS, postal_code: "123" } })).toThrow(expect.objectContaining({ code: "invalid_address" }))
  })

  it("setShipping solo acepta opciones existentes", () => {
    expect(setShipping(emptyCart(), "so_express").shipping_option_id).toBe("so_express")
    expect(() => setShipping(emptyCart(), "so_gratis")).toThrow(expect.objectContaining({ code: "invalid_shipping" }))
  })

  it("buildCart calcula totales con envío y descarta variantes desconocidas", () => {
    let s = addItem(emptyCart(), B, HOODIE_M, 2)
    s = setShipping(s, "so_standard")
    s = { ...s, items: [...s.items, { variant_id: "variant_borrada", quantity: 1 }] }
    const cart = buildCart(s, B)
    expect(cart.items).toHaveLength(1)
    expect(cart.item_count).toBe(2)
    expect(cart.subtotal).toBe(179800)
    expect(cart.shipping_total).toBe(9900)
    expect(cart.total).toBe(189700)
  })

  it("carrito vacío no cobra envío", () => {
    expect(buildCart(setShipping(emptyCart(), "so_standard"), B).total).toBe(0)
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm --filter @store/commerce test`
Expected: FAIL, no se pueden resolver `./errors` ni `./cart`.

- [ ] **Step 3: Implementar errores**

`packages/commerce/src/errors.ts`:
```ts
export type CommerceErrorCode =
  | "variant_not_found"
  | "invalid_address"
  | "invalid_shipping"
  | "empty_cart"
  | "missing_address"
  | "missing_shipping"
  | "invalid_credentials"
  | "invalid_registration"
  | "email_taken"
  | "address_limit"

export class CommerceError extends Error {
  constructor(readonly code: CommerceErrorCode) {
    super(code)
    this.name = "CommerceError"
  }
}

const ERROR_MESSAGES: Record<CommerceErrorCode, string> = {
  variant_not_found: "Ese producto ya no está disponible.",
  invalid_address: "Revisa tu correo y dirección: el código postal debe tener 5 dígitos.",
  invalid_shipping: "Elige una opción de envío válida.",
  empty_cart: "Tu carrito está vacío.",
  missing_address: "Falta la dirección de envío.",
  missing_shipping: "Falta elegir el envío.",
  invalid_credentials: "Correo o contraseña incorrectos.",
  invalid_registration: "Revisa tus datos: la contraseña debe tener al menos 8 caracteres.",
  email_taken: "Ya existe una cuenta con ese correo.",
  address_limit: "Puedes guardar hasta 5 direcciones.",
}

/** El código llega por `?error=` en la URL: solo se traducen códigos propios. */
export function errorMessage(code?: string): string | null {
  return code && Object.hasOwn(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code as CommerceErrorCode] : null
}
```

- [ ] **Step 4: Implementar carrito**

`packages/commerce/src/cart.ts`:
```ts
import { z } from "zod"
import { findVariant, getShippingOption } from "./catalog"
import { CommerceError } from "./errors"
import type { ShippingOption } from "./types"

export const MAX_QUANTITY = 10

export const AddressSchema = z.object({
  first_name: z.string().trim().min(1).max(60),
  last_name: z.string().trim().min(1).max(60),
  address_1: z.string().trim().min(3).max(120),
  city: z.string().trim().min(2).max(60),
  province: z.string().trim().min(2).max(60),
  postal_code: z.string().trim().regex(/^\d{5}$/),
  phone: z.string().trim().max(20).optional(),
  country_code: z.literal("mx").default("mx"),
})
export type Address = z.infer<typeof AddressSchema>

export const CartLineSchema = z.object({
  variant_id: z.string(),
  product_handle: z.string(),
  product_title: z.string(),
  variant_title: z.string(),
  thumbnail: z.string().nullable(),
  unit_price: z.number().int(),
  quantity: z.number().int(),
  total: z.number().int(),
})
export type CartLine = z.infer<typeof CartLineSchema>

const CartStateSchema = z.object({
  items: z
    .array(z.object({ variant_id: z.string().min(1), quantity: z.number().int().min(1).max(MAX_QUANTITY) }))
    .max(50),
  email: z.email().optional(),
  shipping_address: AddressSchema.optional(),
  shipping_option_id: z.string().optional(),
})
export type CartState = z.infer<typeof CartStateSchema>

export type Cart = {
  items: CartLine[]
  item_count: number
  email?: string
  shipping_address?: Address
  shipping_option?: ShippingOption
  subtotal: number
  shipping_total: number
  total: number
}

export const emptyCart = (): CartState => ({ items: [] })

/** La cookie la controla el navegador: cualquier cosa inválida es un carrito vacío. */
export function parseCart(raw: string | undefined): CartState {
  if (!raw) return emptyCart()
  try {
    const parsed = CartStateSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : emptyCart()
  } catch {
    return emptyCart()
  }
}

export function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(MAX_QUANTITY, Math.max(0, Math.floor(value)))
}

export function addItem(state: CartState, brand: string, variantId: string, quantity: number): CartState {
  if (!findVariant(brand, variantId)) throw new CommerceError("variant_not_found")
  const q = clampQuantity(quantity)
  if (q === 0) return state
  const exists = state.items.some((i) => i.variant_id === variantId)
  const items = exists
    ? state.items.map((i) => (i.variant_id === variantId ? { ...i, quantity: Math.min(MAX_QUANTITY, i.quantity + q) } : i))
    : [...state.items, { variant_id: variantId, quantity: q }]
  return { ...state, items }
}

export function updateItem(state: CartState, variantId: string, quantity: number): CartState {
  const q = clampQuantity(quantity)
  if (q === 0) return removeItem(state, variantId)
  return { ...state, items: state.items.map((i) => (i.variant_id === variantId ? { ...i, quantity: q } : i)) }
}

export function removeItem(state: CartState, variantId: string): CartState {
  return { ...state, items: state.items.filter((i) => i.variant_id !== variantId) }
}

export function setAddresses(state: CartState, input: { email: unknown; address: unknown }): CartState {
  const email = z.email().safeParse(input.email)
  const address = AddressSchema.safeParse(input.address)
  if (!email.success || !address.success) throw new CommerceError("invalid_address")
  return { ...state, email: email.data, shipping_address: address.data }
}

export function setShipping(state: CartState, optionId: string): CartState {
  if (!getShippingOption(optionId)) throw new CommerceError("invalid_shipping")
  return { ...state, shipping_option_id: optionId }
}

export function buildCart(state: CartState, brand: string): Cart {
  const items: CartLine[] = state.items.flatMap((i) => {
    const found = findVariant(brand, i.variant_id)
    if (!found) return [] // la variante salió del catálogo
    const unit = found.variant.calculated_price.calculated_amount
    return [
      {
        variant_id: i.variant_id,
        product_handle: found.product.handle,
        product_title: found.product.title,
        variant_title: found.variant.title ?? "",
        thumbnail: found.product.thumbnail ?? null,
        unit_price: unit,
        quantity: i.quantity,
        total: unit * i.quantity,
      },
    ]
  })
  const subtotal = items.reduce((sum, l) => sum + l.total, 0)
  const shipping_option = (state.shipping_option_id && getShippingOption(state.shipping_option_id)) || undefined
  const shipping_total = items.length && shipping_option ? shipping_option.amount : 0
  return {
    items,
    item_count: items.reduce((sum, l) => sum + l.quantity, 0),
    email: state.email,
    shipping_address: state.shipping_address,
    shipping_option,
    subtotal,
    shipping_total,
    total: subtotal + shipping_total,
  }
}
```

- [ ] **Step 5: Correr y verificar que pasan**

Run: `pnpm --filter @store/commerce test && pnpm --filter @store/commerce typecheck`
Expected: PASS (todos), typecheck sin errores.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: carrito mock con validacion de cookie y cantidades"
```

---

### Task 4: Pedidos y clientes puros

**Files:**
- Create: `packages/commerce/src/orders.ts`, `packages/commerce/src/customer.ts`, `packages/commerce/src/index.ts`
- Test: `packages/commerce/src/orders.test.ts`, `packages/commerce/src/customer.test.ts`

**Interfaces:**
- Consumes: `buildCart`, `CartState`, `CartLineSchema`, `AddressSchema`, `Address`, `CommerceError`, `MOCK_CUSTOMERS`.
- Produces:
  - `type Order`, `MAX_STORED_ORDERS = 3`, `completeCart(state: CartState, brand: string, now?: Date): Order`, `parseOrders(raw?: string): Order[]`, `appendOrder(orders: Order[], order: Order): Order[]`
  - `type Customer = { email; first_name; last_name; addresses: Address[] }`, `parseCustomer(raw?: string): Customer | null`, `login(brand: string, email: string, password: string): Customer`, `register(input: unknown): Customer`, `addAddress(customer: Customer, input: unknown): Customer`
  - `src/index.ts` reexporta todo lo puro (`types`, `money`, `errors`, `catalog`, `cart`, `orders`, `customer`).

- [ ] **Step 1: Escribir los tests que fallan**

`packages/commerce/src/orders.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { addItem, emptyCart, setAddresses, setShipping } from "./cart"
import { appendOrder, completeCart, MAX_STORED_ORDERS, parseOrders } from "./orders"

const B = "urban-street"
const ADDRESS = { first_name: "Ana", last_name: "López", address_1: "Av. Reforma 222", city: "CDMX", province: "CDMX", postal_code: "06600" }
const withItem = addItem(emptyCart(), B, "variant_playera-basica_m", 1)
const ready = setShipping(setAddresses(withItem, { email: "ana@example.com", address: ADDRESS }), "so_express")

describe("completeCart", () => {
  it("rechaza carrito vacío, sin dirección o sin envío", () => {
    expect(() => completeCart(emptyCart(), B)).toThrow(expect.objectContaining({ code: "empty_cart" }))
    expect(() => completeCart(withItem, B)).toThrow(expect.objectContaining({ code: "missing_address" }))
    const noShipping = setAddresses(withItem, { email: "ana@example.com", address: ADDRESS })
    expect(() => completeCart(noShipping, B)).toThrow(expect.objectContaining({ code: "missing_shipping" }))
  })

  it("crea el pedido con totales", () => {
    const order = completeCart(ready, B, new Date("2026-11-04T12:00:00Z"))
    expect(order.id).toMatch(/^order_/)
    expect(order.created_at).toBe("2026-11-04T12:00:00.000Z")
    expect(order.total).toBe(34900 + 19900)
  })
})

describe("historial de pedidos en cookie", () => {
  it("guarda solo los últimos pedidos", () => {
    let orders = parseOrders(undefined)
    for (let i = 0; i < 5; i++) orders = appendOrder(orders, completeCart(ready, B, new Date(2026, 10, 4, 0, i)))
    expect(orders).toHaveLength(MAX_STORED_ORDERS)
    expect(parseOrders(JSON.stringify(orders))).toEqual(orders)
  })

  it("cookie corrupta → sin pedidos", () => {
    expect(parseOrders("[{")).toEqual([])
    expect(parseOrders(JSON.stringify([{ id: 1 }]))).toEqual([])
  })
})
```

`packages/commerce/src/customer.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { addAddress, login, parseCustomer, register } from "./customer"

const ADDRESS = { first_name: "Ana", last_name: "López", address_1: "Av. Reforma 222", city: "CDMX", province: "CDMX", postal_code: "06600" }

describe("login", () => {
  it("acepta las credenciales de prueba de su marca", () => {
    expect(login("urban-street", " Ana@Urban-Street.mx ", "Password123").first_name).toBe("Ana")
  })

  it("rechaza contraseña incorrecta o cliente de otra marca", () => {
    expect(() => login("urban-street", "ana@urban-street.mx", "otra")).toThrow(expect.objectContaining({ code: "invalid_credentials" }))
    expect(() => login("classic-threads", "ana@urban-street.mx", "Password123")).toThrow(expect.objectContaining({ code: "invalid_credentials" }))
  })
})

describe("register", () => {
  it("crea el cliente con datos válidos", () => {
    const c = register({ email: "nuevo@example.com", password: "12345678", first_name: "Nuevo", last_name: "Cliente" })
    expect(c).toEqual({ email: "nuevo@example.com", first_name: "Nuevo", last_name: "Cliente", addresses: [] })
  })

  it("rechaza contraseña corta y correo existente", () => {
    expect(() => register({ email: "x@example.com", password: "123", first_name: "X", last_name: "Y" })).toThrow(expect.objectContaining({ code: "invalid_registration" }))
    expect(() => register({ email: "ana@urban-street.mx", password: "12345678", first_name: "A", last_name: "L" })).toThrow(expect.objectContaining({ code: "email_taken" }))
  })
})

describe("direcciones y cookie", () => {
  it("addAddress valida y limita a 5", () => {
    let c = login("urban-street", "ana@urban-street.mx", "Password123")
    for (let i = 0; i < 5; i++) c = addAddress(c, ADDRESS)
    expect(c.addresses).toHaveLength(5)
    expect(() => addAddress(c, ADDRESS)).toThrow(expect.objectContaining({ code: "address_limit" }))
    expect(() => addAddress({ ...c, addresses: [] }, { ...ADDRESS, postal_code: "x" })).toThrow(expect.objectContaining({ code: "invalid_address" }))
  })

  it("parseCustomer tolera cookies inválidas", () => {
    expect(parseCustomer(undefined)).toBeNull()
    expect(parseCustomer("nope")).toBeNull()
    const c = login("urban-street", "ana@urban-street.mx", "Password123")
    expect(parseCustomer(JSON.stringify(c))).toEqual(c)
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm --filter @store/commerce test`
Expected: FAIL, no se pueden resolver `./orders` ni `./customer`.

- [ ] **Step 3: Implementar pedidos**

`packages/commerce/src/orders.ts`:
```ts
import { z } from "zod"
import { AddressSchema, buildCart, CartLineSchema, type CartState } from "./cart"
import { CommerceError } from "./errors"

// shortcut: el historial vive en una cookie (límite ~4 KB), por eso solo 3 pedidos; al conectar Medusa sale de /store/orders.
export const MAX_STORED_ORDERS = 3

const OrderSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  email: z.email(),
  items: z.array(CartLineSchema).min(1),
  shipping_address: AddressSchema,
  shipping_option: z.object({ id: z.string(), name: z.string(), amount: z.number().int() }),
  subtotal: z.number().int(),
  shipping_total: z.number().int(),
  total: z.number().int(),
})
export type Order = z.infer<typeof OrderSchema>

export function completeCart(state: CartState, brand: string, now = new Date()): Order {
  const cart = buildCart(state, brand)
  if (!cart.items.length) throw new CommerceError("empty_cart")
  if (!cart.email || !cart.shipping_address) throw new CommerceError("missing_address")
  if (!cart.shipping_option) throw new CommerceError("missing_shipping")
  return {
    id: `order_${now.getTime().toString(36)}`,
    created_at: now.toISOString(),
    email: cart.email,
    items: cart.items,
    shipping_address: cart.shipping_address,
    shipping_option: cart.shipping_option,
    subtotal: cart.subtotal,
    shipping_total: cart.shipping_total,
    total: cart.total,
  }
}

export function parseOrders(raw: string | undefined): Order[] {
  if (!raw) return []
  try {
    const parsed = z.array(OrderSchema).max(MAX_STORED_ORDERS).safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

export function appendOrder(orders: Order[], order: Order): Order[] {
  return [order, ...orders].slice(0, MAX_STORED_ORDERS)
}
```

- [ ] **Step 4: Implementar clientes**

`packages/commerce/src/customer.ts`:
```ts
import { z } from "zod"
import { AddressSchema } from "./cart"
import { MOCK_CUSTOMERS } from "./catalog"
import { CommerceError } from "./errors"

const MAX_ADDRESSES = 5

const CustomerSchema = z.object({
  email: z.email(),
  first_name: z.string(),
  last_name: z.string(),
  addresses: z.array(AddressSchema).max(MAX_ADDRESSES),
})
export type Customer = z.infer<typeof CustomerSchema>

const RegisterSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(72),
  first_name: z.string().trim().min(1).max(60),
  last_name: z.string().trim().min(1).max(60),
})

export function parseCustomer(raw: string | undefined): Customer | null {
  if (!raw) return null
  try {
    const parsed = CustomerSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function login(brand: string, email: string, password: string): Customer {
  const normalized = email.trim().toLowerCase()
  const match = MOCK_CUSTOMERS.find((c) => c.brand === brand && c.email === normalized && c.password === password)
  if (!match) throw new CommerceError("invalid_credentials")
  return { email: match.email, first_name: match.first_name, last_name: match.last_name, addresses: [] }
}

// shortcut: el registro solo abre sesión en la cookie, no persiste; tras cerrar sesión no se puede volver a entrar. Se resuelve al conectar Medusa.
export function register(input: unknown): Customer {
  const parsed = RegisterSchema.safeParse(input)
  if (!parsed.success) throw new CommerceError("invalid_registration")
  const email = parsed.data.email.toLowerCase()
  if (MOCK_CUSTOMERS.some((c) => c.email === email)) throw new CommerceError("email_taken")
  return { email, first_name: parsed.data.first_name, last_name: parsed.data.last_name, addresses: [] }
}

export function addAddress(customer: Customer, input: unknown): Customer {
  const parsed = AddressSchema.safeParse(input)
  if (!parsed.success) throw new CommerceError("invalid_address")
  if (customer.addresses.length >= MAX_ADDRESSES) throw new CommerceError("address_limit")
  return { ...customer, addresses: [...customer.addresses, parsed.data] }
}
```

- [ ] **Step 5: Crear el índice del paquete**

`packages/commerce/src/index.ts`:
```ts
export * from "./types"
export * from "./money"
export * from "./errors"
export * from "./catalog"
export * from "./cart"
export * from "./orders"
export * from "./customer"
```

- [ ] **Step 6: Correr y verificar que pasan**

Run: `pnpm --filter @store/commerce test && pnpm --filter @store/commerce typecheck`
Expected: PASS (todos), typecheck sin errores.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: pedidos y clientes mock con historial en cookie"
```

---

### Task 5: Adaptador Next (datos y server actions)

**Files:**
- Create: `packages/commerce/src/next/session.ts`, `packages/commerce/src/next/data.ts`, `packages/commerce/src/next/actions.ts`

**Interfaces:**
- Consumes: todo lo puro de Tasks 2–4.
- Produces (`@store/commerce/next`, todo `async`): `getBrand(): Promise<Brand>`, `listCategories()`, `getCategory(handle)`, `listProducts(opts?)`, `getProduct(handle)`, `listShippingOptions()`, `getCart(): Promise<Cart>`, `getCustomer(): Promise<Customer | null>`, `listOrders(): Promise<Order[]>`, `getOrder(id): Promise<Order | null>`.
- Produces (`@store/commerce/next/actions`, server actions `(formData: FormData) => Promise<void>`): `addItemAction`, `updateItemAction`, `removeItemAction`, `setAddressesAction`, `setShippingAction`, `completeCartAction`, `loginAction`, `registerAction`, `logoutAction`, `addAddressAction`.
- Nombres de campos de formulario que usan las pantallas: `variant_id`, `quantity`, `email`, `password`, `first_name`, `last_name`, `address_1`, `city`, `province`, `postal_code`, `phone`, `shipping_option_id`.
- Errores: las actions redirigen a `<ruta>?error=<CommerceErrorCode>`.

Esta capa es delgada: no tiene tests unitarios propios, la lógica ya está probada y el flujo se cubre con el e2e de las Tasks 7 y 8. Aquí se verifica con typecheck.

- [ ] **Step 1: Sesión y marca**

`packages/commerce/src/next/session.ts`:
```ts
import { cookies } from "next/headers"

const COOKIES = { cart: "store_cart", customer: "store_customer", orders: "store_orders" } as const
type CookieName = keyof typeof COOKIES

const OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 30,
}

/** La marca de la tienda; con Medusa la dará la publishable key. */
export function storeBrand(): string {
  const source = process.env.COMMERCE_SOURCE ?? "mock"
  if (source !== "mock") throw new Error(`COMMERCE_SOURCE=${source} no existe todavía; solo "mock"`)
  const brand = process.env.STORE_BRAND
  if (!brand) throw new Error("Falta STORE_BRAND en el entorno (ver .env.example)")
  return brand
}

export async function readCookie(name: CookieName): Promise<string | undefined> {
  return (await cookies()).get(COOKIES[name])?.value
}

export async function writeCookie(name: CookieName, value: unknown): Promise<void> {
  ;(await cookies()).set(COOKIES[name], JSON.stringify(value), OPTIONS)
}

export async function deleteCookie(name: CookieName): Promise<void> {
  ;(await cookies()).delete(COOKIES[name])
}
```

- [ ] **Step 2: Lecturas**

`packages/commerce/src/next/data.ts`:
```ts
import { buildCart, parseCart } from "../cart"
import * as catalog from "../catalog"
import { parseCustomer } from "../customer"
import { parseOrders } from "../orders"
import { readCookie, storeBrand } from "./session"

// Async a propósito: misma firma que tendrá la versión con @medusajs/js-sdk.
export async function getBrand() {
  return catalog.getBrand(storeBrand())
}

export async function listCategories() {
  return catalog.listCategories(storeBrand())
}

export async function getCategory(handle: string) {
  return catalog.getCategory(storeBrand(), handle)
}

export async function listProducts(opts: { category?: string } = {}) {
  return catalog.listProducts(storeBrand(), opts)
}

export async function getProduct(handle: string) {
  return catalog.getProduct(storeBrand(), handle)
}

export async function listShippingOptions() {
  return catalog.SHIPPING_OPTIONS
}

export async function getCart() {
  return buildCart(parseCart(await readCookie("cart")), storeBrand())
}

export async function getCustomer() {
  return parseCustomer(await readCookie("customer"))
}

export async function listOrders() {
  return parseOrders(await readCookie("orders"))
}

export async function getOrder(id: string) {
  return (await listOrders()).find((o) => o.id === id) ?? null
}
```

- [ ] **Step 3: Server actions**

`packages/commerce/src/next/actions.ts`:
```ts
"use server"

import { redirect } from "next/navigation"
import { addItem, parseCart, removeItem, setAddresses, setShipping, updateItem, type CartState } from "../cart"
import { addAddress, login, parseCustomer, register } from "../customer"
import { CommerceError } from "../errors"
import { appendOrder, completeCart, parseOrders } from "../orders"
import { deleteCookie, readCookie, storeBrand, writeCookie } from "./session"

const ADDRESS_FIELDS = ["first_name", "last_name", "address_1", "city", "province", "postal_code", "phone"] as const

const field = (fd: FormData, key: string) => String(fd.get(key) ?? "")
const addressFrom = (fd: FormData) => Object.fromEntries(ADDRESS_FIELDS.map((k) => [k, field(fd, k)]))

/** Errores de negocio vuelven al formulario como `?error=<code>`; el resto sube a error.tsx. */
async function orFail<T>(path: string, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof CommerceError) redirect(`${path}?error=${e.code}`)
    throw e
  }
}

async function mutateCart(path: string, fn: (state: CartState, brand: string) => CartState) {
  const brand = storeBrand()
  const state = parseCart(await readCookie("cart"))
  await writeCookie("cart", await orFail(path, () => fn(state, brand)))
}

export async function addItemAction(fd: FormData) {
  await mutateCart("/cart", (s, b) => addItem(s, b, field(fd, "variant_id"), Number(field(fd, "quantity") || 1)))
  redirect("/cart")
}

export async function updateItemAction(fd: FormData) {
  await mutateCart("/cart", (s) => updateItem(s, field(fd, "variant_id"), Number(field(fd, "quantity"))))
}

export async function removeItemAction(fd: FormData) {
  await mutateCart("/cart", (s) => removeItem(s, field(fd, "variant_id")))
}

export async function setAddressesAction(fd: FormData) {
  await mutateCart("/checkout", (s) => setAddresses(s, { email: field(fd, "email"), address: addressFrom(fd) }))
  redirect("/checkout")
}

export async function setShippingAction(fd: FormData) {
  await mutateCart("/checkout", (s) => setShipping(s, field(fd, "shipping_option_id")))
  redirect("/checkout")
}

export async function completeCartAction() {
  const brand = storeBrand()
  const state = parseCart(await readCookie("cart"))
  const order = await orFail("/checkout", () => completeCart(state, brand))
  await writeCookie("orders", appendOrder(parseOrders(await readCookie("orders")), order))
  await deleteCookie("cart")
  redirect(`/order/${order.id}`)
}

export async function loginAction(fd: FormData) {
  const customer = await orFail("/account/login", () => login(storeBrand(), field(fd, "email"), field(fd, "password")))
  await writeCookie("customer", customer)
  redirect("/account")
}

export async function registerAction(fd: FormData) {
  const input = { email: field(fd, "email"), password: field(fd, "password"), first_name: field(fd, "first_name"), last_name: field(fd, "last_name") }
  const customer = await orFail("/account/register", () => register(input))
  await writeCookie("customer", customer)
  redirect("/account")
}

export async function logoutAction() {
  await deleteCookie("customer")
  redirect("/")
}

export async function addAddressAction(fd: FormData) {
  const customer = parseCustomer(await readCookie("customer"))
  if (!customer) redirect("/account/login")
  await writeCookie("customer", await orFail("/account", () => addAddress(customer, addressFrom(fd))))
  redirect("/account")
}
```

- [ ] **Step 4: Verificar**

Run: `pnpm --filter @store/commerce typecheck && pnpm --filter @store/commerce test`
Expected: typecheck sin errores; tests siguen en PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: adaptador next con cookies y server actions"
```

---

### Task 6: UI base, carrito y app template navegable

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`
- Create: `packages/ui/src/theme.css`, `packages/ui/src/brand-style.ts`, `packages/ui/src/price.tsx`, `packages/ui/src/field.tsx`, `packages/ui/src/address-fields.tsx`, `packages/ui/src/error-notice.tsx`, `packages/ui/src/add-to-cart-form.tsx`, `packages/ui/src/cart/cart-page.tsx`
- Create: `apps/_template/package.json`, `apps/_template/tsconfig.json`, `apps/_template/next.config.ts`, `apps/_template/postcss.config.mjs`, `apps/_template/.env.example`
- Create: `apps/_template/app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `app/c/[slug]/page.tsx`, `app/p/[handle]/page.tsx`, `app/cart/page.tsx`, `app/error.tsx`, `app/not-found.tsx`, `apps/_template/components/product-grid.tsx`

**Interfaces:**
- Consumes: `@store/commerce` (tipos, `formatPrice`, `errorMessage`, `MAX_QUANTITY`, `Address`), `@store/commerce/next`, `@store/commerce/next/actions`.
- Produces (`@store/ui/*`): `brandStyle(brand: Brand): CSSProperties`, `Price({ amount })`, `Field({ name, label, type?, defaultValue?, required?, autoComplete? })`, `AddressFields({ defaults?: Partial<Address> })`, `ErrorNotice({ code?: string })`, `AddToCartForm({ product })`, `CartPage({ searchParams })`, `theme.css` con utilidades `bg-primary`, `text-primary`, `bg-secondary`, `text-secondary`, `font-heading`, `font-body`, `rounded-brand`.

- [ ] **Step 1: Paquete UI**

`packages/ui/package.json`:
```json
{
  "name": "@store/ui",
  "private": true,
  "type": "module",
  "exports": {
    "./theme.css": "./src/theme.css",
    "./brand-style": "./src/brand-style.ts",
    "./price": "./src/price.tsx",
    "./field": "./src/field.tsx",
    "./address-fields": "./src/address-fields.tsx",
    "./error-notice": "./src/error-notice.tsx",
    "./add-to-cart-form": "./src/add-to-cart-form.tsx",
    "./cart": "./src/cart/cart-page.tsx",
    "./checkout": "./src/checkout/checkout-page.tsx",
    "./order": "./src/checkout/order-page.tsx",
    "./account": "./src/account/account-page.tsx",
    "./account/login": "./src/account/login-page.tsx",
    "./account/register": "./src/account/register-page.tsx"
  },
  "scripts": { "typecheck": "tsc --noEmit" },
  "peerDependencies": { "next": "*", "react": "*" }
}
```

`packages/ui/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

```bash
pnpm --filter @store/ui add @store/commerce@workspace:*
pnpm --filter @store/ui add -D next react react-dom @types/react typescript
```

- [ ] **Step 2: Tokens y piezas**

`packages/ui/src/theme.css`:
```css
/* Tokens de marca: la tienda define --brand-* (layout/CSS propio) y la UI compartida los usa. */
@theme inline {
  --color-primary: var(--brand-primary, #111111);
  --color-secondary: var(--brand-secondary, #ffffff);
  --font-heading: var(--brand-font-heading, ui-sans-serif, system-ui, sans-serif);
  --font-body: var(--brand-font-body, ui-sans-serif, system-ui, sans-serif);
  --radius-brand: var(--brand-radius, 0.5rem);
}
```

`packages/ui/src/brand-style.ts`:
```ts
import type { CSSProperties } from "react"
import type { Brand } from "@store/commerce"

const HEX = /^#[0-9a-f]{3,8}$/i

/** Los colores vienen de metadata editable en el admin: solo se aceptan hex. */
export function brandStyle(brand: Brand): CSSProperties {
  const style: Record<string, string> = {}
  if (HEX.test(brand.primary_color)) style["--brand-primary"] = brand.primary_color
  if (HEX.test(brand.secondary_color)) style["--brand-secondary"] = brand.secondary_color
  return style as CSSProperties
}
```

`packages/ui/src/price.tsx`:
```tsx
import { formatPrice } from "@store/commerce"

export function Price({ amount }: { amount: number }) {
  return <span>{formatPrice(amount)}</span>
}
```

`packages/ui/src/field.tsx`:
```tsx
type FieldProps = {
  name: string
  label: string
  type?: string
  defaultValue?: string
  required?: boolean
  autoComplete?: string
}

export function Field({ name, label, type = "text", defaultValue, required = true, autoComplete }: FieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        autoComplete={autoComplete}
        className="rounded-brand border border-neutral-300 px-3 py-2"
      />
    </label>
  )
}
```

`packages/ui/src/address-fields.tsx`:
```tsx
import type { Address } from "@store/commerce"
import { Field } from "./field"

export function AddressFields({ defaults }: { defaults?: Partial<Address> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field name="first_name" label="Nombre" defaultValue={defaults?.first_name} autoComplete="given-name" />
      <Field name="last_name" label="Apellidos" defaultValue={defaults?.last_name} autoComplete="family-name" />
      <Field name="address_1" label="Calle y número" defaultValue={defaults?.address_1} autoComplete="address-line1" />
      <Field name="city" label="Ciudad" defaultValue={defaults?.city} autoComplete="address-level2" />
      <Field name="province" label="Estado" defaultValue={defaults?.province} autoComplete="address-level1" />
      <Field name="postal_code" label="Código postal" defaultValue={defaults?.postal_code} autoComplete="postal-code" />
      <Field name="phone" label="Teléfono" type="tel" defaultValue={defaults?.phone} required={false} autoComplete="tel" />
    </div>
  )
}
```

`packages/ui/src/error-notice.tsx`:
```tsx
import { errorMessage } from "@store/commerce"

export function ErrorNotice({ code }: { code?: string }) {
  const message = errorMessage(code)
  if (!message) return null
  return (
    <p role="alert" className="rounded-brand bg-red-50 p-3 text-sm text-red-700">
      {message}
    </p>
  )
}
```

`packages/ui/src/add-to-cart-form.tsx`:
```tsx
import { MAX_QUANTITY, type Product } from "@store/commerce"
import { addItemAction } from "@store/commerce/next/actions"

export function AddToCartForm({ product }: { product: Product }) {
  return (
    <form action={addItemAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span>Talla</span>
        <select name="variant_id" className="rounded-brand border border-neutral-300 px-3 py-2">
          {product.variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>Cantidad</span>
        <input type="number" name="quantity" min={1} max={MAX_QUANTITY} defaultValue={1} className="rounded-brand border border-neutral-300 px-3 py-2" />
      </label>
      <button type="submit" className="rounded-brand bg-primary px-4 py-3 font-medium text-secondary">
        Agregar al carrito
      </button>
    </form>
  )
}
```

- [ ] **Step 3: Pantalla de carrito**

`packages/ui/src/cart/cart-page.tsx`:
```tsx
import Link from "next/link"
import { MAX_QUANTITY } from "@store/commerce"
import { getCart } from "@store/commerce/next"
import { removeItemAction, updateItemAction } from "@store/commerce/next/actions"
import { ErrorNotice } from "../error-notice"
import { Price } from "../price"

export async function CartPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [cart, { error }] = await Promise.all([getCart(), searchParams])

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="font-heading text-3xl font-bold">Tu carrito</h1>
      <ErrorNotice code={error} />
      {cart.items.length === 0 ? (
        <div className="space-y-4">
          <p>Tu carrito está vacío.</p>
          <Link href="/" className="underline">
            Seguir comprando
          </Link>
        </div>
      ) : (
        <>
          <ul className="divide-y">
            {cart.items.map((line) => (
              <li key={line.variant_id} className="flex flex-wrap items-center gap-4 py-4">
                {line.thumbnail && <img src={line.thumbnail} alt="" className="h-20 w-16 rounded-brand object-cover" />}
                <div className="min-w-40 flex-1">
                  <Link href={`/p/${line.product_handle}`} className="font-medium">
                    {line.product_title}
                  </Link>
                  <p className="text-sm text-neutral-600">
                    Talla {line.variant_title} · <Price amount={line.unit_price} />
                  </p>
                </div>
                <form action={updateItemAction} className="flex items-center gap-2">
                  <input type="hidden" name="variant_id" value={line.variant_id} />
                  <input
                    type="number"
                    name="quantity"
                    min={0}
                    max={MAX_QUANTITY}
                    defaultValue={line.quantity}
                    aria-label={`Cantidad de ${line.product_title}`}
                    className="w-16 rounded-brand border border-neutral-300 px-2 py-1"
                  />
                  <button type="submit" className="text-sm underline">
                    Actualizar
                  </button>
                </form>
                <form action={removeItemAction}>
                  <input type="hidden" name="variant_id" value={line.variant_id} />
                  <button type="submit" className="text-sm text-red-700 underline">
                    Quitar
                  </button>
                </form>
                <Price amount={line.total} />
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t pt-4">
            <span>Subtotal</span>
            <Price amount={cart.subtotal} />
          </div>
          <Link href="/checkout" className="block rounded-brand bg-primary px-4 py-3 text-center font-medium text-secondary">
            Ir a pagar
          </Link>
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 4: App template — configuración**

`apps/_template/package.json`:
```json
{
  "name": "@store/template",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test:e2e": "playwright test"
  }
}
```

```bash
pnpm --filter @store/template add next react react-dom @store/commerce@workspace:* @store/ui@workspace:*
pnpm --filter @store/template add -D typescript @types/react @types/react-dom @types/node tailwindcss @tailwindcss/postcss
```

`apps/_template/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "plugins": [{ "name": "next" }], "allowJs": true, "incremental": true },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/_template/next.config.ts`:
```ts
import type { NextConfig } from "next"

const config: NextConfig = {
  transpilePackages: ["@store/commerce", "@store/ui"],
}

export default config
```

`apps/_template/postcss.config.mjs`:
```js
export default { plugins: { "@tailwindcss/postcss": {} } }
```

`apps/_template/.env.example`:
```
STORE_BRAND=urban-street
COMMERCE_SOURCE=mock
```

```bash
cp apps/_template/.env.example apps/_template/.env.local
```

- [ ] **Step 5: App template — estilos y layout**

`apps/_template/app/globals.css`:
```css
@import "tailwindcss";
@import "@store/ui/theme.css";
@source "../../../packages/ui/src";

/* Tokens propios de esta tienda: sobrescribe aquí --brand-font-heading, --brand-radius, etc. */
```

`apps/_template/app/layout.tsx`:
```tsx
import "./globals.css"
import type { Metadata } from "next"
import Link from "next/link"
import { getBrand, getCart, listCategories } from "@store/commerce/next"
import { brandStyle } from "@store/ui/brand-style"

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand()
  return { title: brand.name, description: brand.description ?? undefined }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [brand, categories, cart] = await Promise.all([getBrand(), listCategories(), getCart()])

  return (
    <html lang="es-MX" style={brandStyle(brand)}>
      <body className="min-h-screen bg-white font-body text-neutral-900">
        <header className="border-b">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-6 p-4">
            <Link href="/" className="font-heading text-xl font-bold">
              {brand.logo_url ? <img src={brand.logo_url} alt={brand.name} className="h-8" /> : brand.name}
            </Link>
            {categories.map((c) => (
              <Link key={c.id} href={`/c/${c.handle}`}>
                {c.name}
              </Link>
            ))}
            <span className="ml-auto flex gap-4">
              <Link href="/account">Cuenta</Link>
              <Link href="/cart">Carrito ({cart.item_count})</Link>
            </span>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="mt-16 border-t p-6 text-center text-sm text-neutral-600">© {brand.name}</footer>
      </body>
    </html>
  )
}
```

- [ ] **Step 6: App template — páginas propias de la tienda**

`apps/_template/components/product-grid.tsx`:
```tsx
import Link from "next/link"
import type { Product } from "@store/commerce"
import { Price } from "@store/ui/price"

export function ProductGrid({ products }: { products: Product[] }) {
  if (products.length === 0) return <p>No hay productos por ahora.</p>
  return (
    <ul className="grid grid-cols-2 gap-6 md:grid-cols-3">
      {products.map((p) => (
        <li key={p.id}>
          <Link href={`/p/${p.handle}`} className="block space-y-2">
            {p.thumbnail && <img src={p.thumbnail} alt={p.title} className="aspect-[3/4] w-full rounded-brand object-cover" />}
            <h3 className="font-heading font-medium">{p.title}</h3>
            {p.variants[0] && <Price amount={p.variants[0].calculated_price.calculated_amount} />}
          </Link>
        </li>
      ))}
    </ul>
  )
}
```

`apps/_template/app/page.tsx`:
```tsx
import { getBrand, listProducts } from "@store/commerce/next"
import { ProductGrid } from "../components/product-grid"

export default async function HomePage() {
  const [brand, products] = await Promise.all([getBrand(), listProducts()])
  return (
    <div className="mx-auto max-w-6xl space-y-10 p-6">
      <section className="rounded-brand bg-primary p-12 text-secondary">
        <h1 className="font-heading text-4xl font-bold">{brand.name}</h1>
        {brand.description && <p className="mt-3 max-w-xl">{brand.description}</p>}
      </section>
      <ProductGrid products={products} />
    </div>
  )
}
```

`apps/_template/app/c/[slug]/page.tsx`:
```tsx
import { notFound } from "next/navigation"
import { getCategory, listProducts } from "@store/commerce/next"
import { ProductGrid } from "../../../components/product-grid"

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const category = await getCategory(slug)
  if (!category) notFound()
  const products = await listProducts({ category: slug })
  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <h1 className="font-heading text-3xl font-bold">{category.name}</h1>
      <ProductGrid products={products} />
    </div>
  )
}
```

`apps/_template/app/p/[handle]/page.tsx`:
```tsx
import { notFound } from "next/navigation"
import { getProduct } from "@store/commerce/next"
import { AddToCartForm } from "@store/ui/add-to-cart-form"
import { Price } from "@store/ui/price"

export default async function ProductPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const product = await getProduct(handle)
  if (!product) notFound()
  const price = product.variants[0]?.calculated_price.calculated_amount
  return (
    <div className="mx-auto grid max-w-6xl gap-10 p-6 md:grid-cols-2">
      {product.thumbnail && <img src={product.thumbnail} alt={product.title} className="w-full rounded-brand object-cover" />}
      <div className="space-y-6">
        <h1 className="font-heading text-3xl font-bold">{product.title}</h1>
        {price !== undefined && (
          <p className="text-xl">
            <Price amount={price} />
          </p>
        )}
        {product.description && <p className="text-neutral-700">{product.description}</p>}
        <AddToCartForm product={product} />
      </div>
    </div>
  )
}
```

- [ ] **Step 7: App template — carrito compartido y páginas de error**

`apps/_template/app/cart/page.tsx`:
```tsx
export { CartPage as default } from "@store/ui/cart"
```

`apps/_template/app/error.tsx`:
```tsx
"use client"

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl p-12 text-center">
      <h1 className="font-heading text-2xl font-bold">Algo salió mal</h1>
      <button onClick={reset} className="mt-6 rounded-brand bg-primary px-4 py-2 text-secondary">
        Reintentar
      </button>
    </div>
  )
}
```

`apps/_template/app/not-found.tsx`:
```tsx
import Link from "next/link"

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl p-12 text-center">
      <h1 className="font-heading text-2xl font-bold">No encontramos esta página</h1>
      <Link href="/" className="mt-6 inline-block underline">
        Volver al inicio
      </Link>
    </div>
  )
}
```

- [ ] **Step 8: Verificar build y navegación**

Run: `pnpm --filter @store/ui typecheck && pnpm --filter @store/template build`
Expected: typecheck sin errores; `next build` termina sin errores. (Las entradas `./checkout`, `./order` y `./account*` del `exports` aún no tienen archivo; las crean las Tasks 7 y 8.)

Run (en otra terminal): `pnpm --filter @store/template dev --port 3100`, luego:
```bash
curl -s localhost:3100 | grep -o "Urban Street" | head -1          # → Urban Street
curl -s localhost:3100/p/hoodie-oversize | grep -o "Agregar al carrito" | head -1
curl -s -o /dev/null -w "%{http_code}\n" localhost:3100/p/camisa-oxford   # → 404 (otra marca)
curl -s -o /dev/null -w "%{http_code}\n" localhost:3100/c/no-existe       # → 404
curl -s localhost:3100/cart | grep -o "Tu carrito está vacío"
```

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: ui base, carrito compartido y app template"
```

---

### Task 7: Checkout, confirmación y e2e de compra

**Files:**
- Create: `packages/ui/src/checkout/checkout-page.tsx`, `packages/ui/src/checkout/order-page.tsx`
- Create: `apps/_template/app/checkout/page.tsx`, `apps/_template/app/order/[id]/page.tsx`
- Create: `apps/_template/playwright.config.ts`
- Test: `apps/_template/e2e/purchase.spec.ts`

**Interfaces:**
- Consumes: `getCart`, `listShippingOptions`, `getOrder` (`@store/commerce/next`); `setAddressesAction`, `setShippingAction`, `completeCartAction`; `AddressFields`, `Field`, `ErrorNotice`, `Price`.
- Produces: `CheckoutPage({ searchParams })`, `OrderPage({ params })`.

- [ ] **Step 1: Configurar Playwright**

```bash
pnpm --filter @store/template add -D @playwright/test
pnpm --filter @store/template exec playwright install chromium
```

`apps/_template/playwright.config.ts`:
```ts
import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3100" },
  webServer: {
    command: "pnpm dev --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    env: { STORE_BRAND: process.env.STORE_BRAND ?? "urban-street", COMMERCE_SOURCE: "mock" },
  },
})
```

- [ ] **Step 2: Escribir el e2e que falla**

`apps/_template/e2e/purchase.spec.ts`:
```ts
import { expect, test } from "@playwright/test"

test("compra completa con pago simulado", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("link", { name: /Hoodie Oversize/ }).click()
  await page.getByRole("button", { name: "Agregar al carrito" }).click()

  await expect(page).toHaveURL(/\/cart$/)
  await expect(page.getByRole("link", { name: "Hoodie Oversize" })).toBeVisible()
  await page.getByRole("link", { name: "Ir a pagar" }).click()

  await page.getByLabel("Correo").fill("cliente@example.com")
  await page.getByLabel("Nombre").fill("Ana")
  await page.getByLabel("Apellidos").fill("López")
  await page.getByLabel("Calle y número").fill("Av. Reforma 222")
  await page.getByLabel("Ciudad").fill("CDMX")
  await page.getByLabel("Estado").fill("CDMX")
  await page.getByLabel("Código postal").fill("06600")
  await page.getByRole("button", { name: "Guardar dirección" }).click()

  await page.getByLabel(/Estándar/).check()
  await page.getByRole("button", { name: "Elegir envío" }).click()
  await page.getByRole("button", { name: "Pagar (simulado)" }).click()

  await expect(page).toHaveURL(/\/order\/order_/)
  await expect(page.getByRole("heading", { name: "¡Gracias por tu compra!" })).toBeVisible()
  await expect(page.getByText("$998.00")).toBeVisible() // 899 + 99 de envío
  await expect(page.getByRole("link", { name: "Carrito (0)" })).toBeVisible()
})

test("checkout con carrito vacío regresa al carrito", async ({ page }) => {
  await page.goto("/checkout")
  await expect(page).toHaveURL(/\/cart$/)
})

test("código postal inválido muestra el error", async ({ page }) => {
  await page.goto("/p/playera-basica")
  await page.getByRole("button", { name: "Agregar al carrito" }).click()
  await page.goto("/checkout")
  await page.getByLabel("Correo").fill("cliente@example.com")
  await page.getByLabel("Nombre").fill("Ana")
  await page.getByLabel("Apellidos").fill("López")
  await page.getByLabel("Calle y número").fill("Av. Reforma 222")
  await page.getByLabel("Ciudad").fill("CDMX")
  await page.getByLabel("Estado").fill("CDMX")
  await page.getByLabel("Código postal").fill("123")
  await page.getByRole("button", { name: "Guardar dirección" }).click()
  await expect(page.getByRole("alert")).toContainText("5 dígitos")
})
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `pnpm --filter @store/template test:e2e`
Expected: FAIL; `/checkout` da 404 porque la ruta no existe.

- [ ] **Step 4: Implementar checkout y confirmación**

`packages/ui/src/checkout/checkout-page.tsx`:
```tsx
import { redirect } from "next/navigation"
import { getCart, listShippingOptions } from "@store/commerce/next"
import { completeCartAction, setAddressesAction, setShippingAction } from "@store/commerce/next/actions"
import { AddressFields } from "../address-fields"
import { ErrorNotice } from "../error-notice"
import { Field } from "../field"
import { Price } from "../price"

const button = "rounded-brand bg-primary px-4 py-3 font-medium text-secondary"

export async function CheckoutPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [cart, options, { error }] = await Promise.all([getCart(), listShippingOptions(), searchParams])
  if (cart.items.length === 0) redirect("/cart")
  const address = cart.shipping_address

  return (
    <section className="mx-auto max-w-2xl space-y-10 p-6">
      <h1 className="font-heading text-3xl font-bold">Checkout</h1>
      <ErrorNotice code={error} />

      <form action={setAddressesAction} className="space-y-4">
        <h2 className="font-heading text-xl font-semibold">1. Dirección de envío</h2>
        <Field name="email" label="Correo" type="email" defaultValue={cart.email} autoComplete="email" />
        <AddressFields defaults={address} />
        <button type="submit" className={button}>
          Guardar dirección
        </button>
      </form>

      {address && (
        <form action={setShippingAction} className="space-y-4">
          <h2 className="font-heading text-xl font-semibold">2. Envío</h2>
          {options.map((o) => (
            <label key={o.id} className="flex items-center gap-3">
              <input type="radio" name="shipping_option_id" value={o.id} defaultChecked={cart.shipping_option?.id === o.id} required />
              <span>
                {o.name} · <Price amount={o.amount} />
              </span>
            </label>
          ))}
          <button type="submit" className={button}>
            Elegir envío
          </button>
        </form>
      )}

      {address && cart.shipping_option && (
        <form action={completeCartAction} className="space-y-4">
          <h2 className="font-heading text-xl font-semibold">3. Pago</h2>
          <p className="text-sm text-neutral-600">Pago simulado: no se cobra nada.</p>
          <dl className="space-y-1">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd><Price amount={cart.subtotal} /></dd>
            </div>
            <div className="flex justify-between">
              <dt>Envío</dt>
              <dd><Price amount={cart.shipping_total} /></dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>Total</dt>
              <dd><Price amount={cart.total} /></dd>
            </div>
          </dl>
          <button type="submit" className={button}>
            Pagar (simulado)
          </button>
        </form>
      )}
    </section>
  )
}
```

`packages/ui/src/checkout/order-page.tsx`:
```tsx
import { notFound } from "next/navigation"
import { getOrder } from "@store/commerce/next"
import { Price } from "../price"

export async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const order = await getOrder(id)
  if (!order) notFound()
  const a = order.shipping_address

  return (
    <section className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="font-heading text-3xl font-bold">¡Gracias por tu compra!</h1>
      <p>
        Pedido <strong>{order.id}</strong> · enviamos la confirmación a {order.email}.
      </p>
      <ul className="divide-y">
        {order.items.map((line) => (
          <li key={line.variant_id} className="flex justify-between py-2">
            <span>
              {line.product_title} · {line.variant_title} × {line.quantity}
            </span>
            <Price amount={line.total} />
          </li>
        ))}
      </ul>
      <p className="text-sm text-neutral-600">
        Envío {order.shipping_option.name} a {a.first_name} {a.last_name}, {a.address_1}, {a.city}, {a.province} {a.postal_code}
      </p>
      <p className="flex justify-between text-lg font-semibold">
        <span>Total</span>
        <Price amount={order.total} />
      </p>
    </section>
  )
}
```

`apps/_template/app/checkout/page.tsx`:
```tsx
export { CheckoutPage as default } from "@store/ui/checkout"
```

`apps/_template/app/order/[id]/page.tsx`:
```tsx
export { OrderPage as default } from "@store/ui/order"
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `pnpm --filter @store/template test:e2e`
Expected: PASS (3 tests).

Si solo falla la aserción `Carrito (0)`, el layout no está releyendo la cookie después del redirect. Diagnostícalo con superpowers:systematic-debugging antes de cambiar código y no relajes la aserción.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: checkout compartido con pago simulado y e2e de compra"
```

---

### Task 8: Cuenta de cliente

**Files:**
- Create: `packages/ui/src/account/login-page.tsx`, `packages/ui/src/account/register-page.tsx`, `packages/ui/src/account/account-page.tsx`
- Create: `apps/_template/app/account/page.tsx`, `apps/_template/app/account/login/page.tsx`, `apps/_template/app/account/register/page.tsx`
- Test: `apps/_template/e2e/account.spec.ts`

**Interfaces:**
- Consumes: `getCustomer`, `listOrders`; `loginAction`, `registerAction`, `logoutAction`, `addAddressAction`; `Field`, `AddressFields`, `ErrorNotice`, `Price`.
- Produces: `LoginPage({ searchParams })`, `RegisterPage({ searchParams })`, `AccountPage({ searchParams })`.

- [ ] **Step 1: Escribir el e2e que falla**

`apps/_template/e2e/account.spec.ts`:
```ts
import { expect, test } from "@playwright/test"

test("login con credenciales de prueba y alta de dirección", async ({ page }) => {
  await page.goto("/account")
  await expect(page).toHaveURL(/\/account\/login$/)
  await page.getByLabel("Correo").fill("ana@urban-street.mx")
  await page.getByLabel("Contraseña").fill("Password123")
  await page.getByRole("button", { name: "Entrar" }).click()

  await expect(page.getByRole("heading", { name: "Hola, Ana" })).toBeVisible()
  await page.getByLabel("Nombre").fill("Ana")
  await page.getByLabel("Apellidos").fill("López")
  await page.getByLabel("Calle y número").fill("Av. Reforma 222")
  await page.getByLabel("Ciudad").fill("CDMX")
  await page.getByLabel("Estado").fill("CDMX")
  await page.getByLabel("Código postal").fill("06600")
  await page.getByRole("button", { name: "Guardar dirección" }).click()
  await expect(page.getByText("Av. Reforma 222, CDMX")).toBeVisible()

  await page.getByRole("button", { name: "Cerrar sesión" }).click()
  await expect(page).toHaveURL("http://localhost:3100/")
})

test("contraseña incorrecta muestra el error", async ({ page }) => {
  await page.goto("/account/login")
  await page.getByLabel("Correo").fill("ana@urban-street.mx")
  await page.getByLabel("Contraseña").fill("incorrecta")
  await page.getByRole("button", { name: "Entrar" }).click()
  await expect(page).toHaveURL(/error=invalid_credentials/)
  await expect(page.getByRole("alert")).toHaveText("Correo o contraseña incorrectos.")
})

test("registro abre sesión", async ({ page }) => {
  await page.goto("/account/register")
  await page.getByLabel("Nombre").fill("Nuevo")
  await page.getByLabel("Apellidos").fill("Cliente")
  await page.getByLabel("Correo").fill("nuevo@example.com")
  await page.getByLabel("Contraseña").fill("12345678")
  await page.getByRole("button", { name: "Crear cuenta" }).click()
  await expect(page.getByRole("heading", { name: "Hola, Nuevo" })).toBeVisible()
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm --filter @store/template test:e2e e2e/account.spec.ts`
Expected: FAIL; `/account` da 404.

- [ ] **Step 3: Implementar pantallas**

`packages/ui/src/account/login-page.tsx`:
```tsx
import Link from "next/link"
import { loginAction } from "@store/commerce/next/actions"
import { ErrorNotice } from "../error-notice"
import { Field } from "../field"

export async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return (
    <section className="mx-auto max-w-md space-y-6 p-6">
      <h1 className="font-heading text-3xl font-bold">Iniciar sesión</h1>
      <ErrorNotice code={error} />
      <form action={loginAction} className="space-y-4">
        <Field name="email" label="Correo" type="email" autoComplete="email" />
        <Field name="password" label="Contraseña" type="password" autoComplete="current-password" />
        <button type="submit" className="w-full rounded-brand bg-primary px-4 py-3 font-medium text-secondary">
          Entrar
        </button>
      </form>
      <p className="text-sm">
        ¿No tienes cuenta? <Link href="/account/register" className="underline">Regístrate</Link>
      </p>
    </section>
  )
}
```

`packages/ui/src/account/register-page.tsx`:
```tsx
import Link from "next/link"
import { registerAction } from "@store/commerce/next/actions"
import { ErrorNotice } from "../error-notice"
import { Field } from "../field"

export async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return (
    <section className="mx-auto max-w-md space-y-6 p-6">
      <h1 className="font-heading text-3xl font-bold">Crear cuenta</h1>
      <ErrorNotice code={error} />
      <form action={registerAction} className="space-y-4">
        <Field name="first_name" label="Nombre" autoComplete="given-name" />
        <Field name="last_name" label="Apellidos" autoComplete="family-name" />
        <Field name="email" label="Correo" type="email" autoComplete="email" />
        <Field name="password" label="Contraseña" type="password" autoComplete="new-password" />
        <button type="submit" className="w-full rounded-brand bg-primary px-4 py-3 font-medium text-secondary">
          Crear cuenta
        </button>
      </form>
      <p className="text-sm">
        ¿Ya tienes cuenta? <Link href="/account/login" className="underline">Inicia sesión</Link>
      </p>
    </section>
  )
}
```

`packages/ui/src/account/account-page.tsx`:
```tsx
import Link from "next/link"
import { redirect } from "next/navigation"
import { getCustomer, listOrders } from "@store/commerce/next"
import { addAddressAction, logoutAction } from "@store/commerce/next/actions"
import { AddressFields } from "../address-fields"
import { ErrorNotice } from "../error-notice"
import { Price } from "../price"

export async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [customer, orders, { error }] = await Promise.all([getCustomer(), listOrders(), searchParams])
  if (!customer) redirect("/account/login")

  return (
    <section className="mx-auto max-w-3xl space-y-10 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold">Hola, {customer.first_name}</h1>
          <p className="text-sm text-neutral-600">{customer.email}</p>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="text-sm underline">
            Cerrar sesión
          </button>
        </form>
      </div>
      <ErrorNotice code={error} />

      <div className="space-y-3">
        <h2 className="font-heading text-xl font-semibold">Pedidos</h2>
        {orders.length === 0 ? (
          <p className="text-sm">Aún no tienes pedidos.</p>
        ) : (
          <ul className="divide-y">
            {orders.map((o) => (
              <li key={o.id} className="flex justify-between py-2">
                <Link href={`/order/${o.id}`} className="underline">
                  {o.id}
                </Link>
                <span>{new Date(o.created_at).toLocaleDateString("es-MX")}</span>
                <Price amount={o.total} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="font-heading text-xl font-semibold">Direcciones</h2>
        <ul className="space-y-1 text-sm">
          {customer.addresses.map((a, i) => (
            <li key={i}>
              {a.first_name} {a.last_name} · {a.address_1}, {a.city}, {a.province} {a.postal_code}
            </li>
          ))}
        </ul>
        <form action={addAddressAction} className="space-y-4">
          <AddressFields />
          <button type="submit" className="rounded-brand bg-primary px-4 py-3 font-medium text-secondary">
            Guardar dirección
          </button>
        </form>
      </div>
    </section>
  )
}
```

Reexportaciones en la app:

`apps/_template/app/account/page.tsx`:
```tsx
export { AccountPage as default } from "@store/ui/account"
```

`apps/_template/app/account/login/page.tsx`:
```tsx
export { LoginPage as default } from "@store/ui/account/login"
```

`apps/_template/app/account/register/page.tsx`:
```tsx
export { RegisterPage as default } from "@store/ui/account/register"
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm --filter @store/template test:e2e && pnpm --filter @store/ui typecheck && pnpm --filter @store/template build`
Expected: PASS (6 tests e2e); typecheck y build sin errores.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: cuenta de cliente compartida con login, registro y direcciones"
```

---

### Task 9: `pnpm new-store`, tiendas iniciales y README

**Files:**
- Create: `scripts/new-store.mjs`
- Test: `scripts/new-store.test.mjs`
- Create (generados): `apps/urban-street/**`, `apps/classic-threads/**`
- Create: `README.md`

**Interfaces:**
- Produces: `newStore(slug: string, root: string): string` (devuelve la ruta creada; lanza `Error` con slug inválido, template ausente o destino existente). CLI: `pnpm new-store <slug>`.

- [ ] **Step 1: Escribir el test que falla**

`scripts/new-store.test.mjs`:
```js
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { newStore } from "./new-store.mjs"

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "new-store-"))
  const template = join(root, "apps", "_template")
  mkdirSync(join(template, "app"), { recursive: true })
  mkdirSync(join(template, "node_modules", "x"), { recursive: true })
  mkdirSync(join(template, ".next"), { recursive: true })
  writeFileSync(join(template, "package.json"), JSON.stringify({ name: "@store/template", private: true }))
  writeFileSync(join(template, "app", "page.tsx"), "export default function Page() {}")
  writeFileSync(join(template, ".env.local"), "SECRETO=1")
  return root
}

test("copia el template, renombra el paquete y genera .env.example", () => {
  const root = fixture()
  const target = newStore("mi-tienda", root)
  assert.equal(JSON.parse(readFileSync(join(target, "package.json"), "utf8")).name, "@store/mi-tienda")
  assert.match(readFileSync(join(target, ".env.example"), "utf8"), /^STORE_BRAND=mi-tienda$/m)
  assert.ok(existsSync(join(target, "app", "page.tsx")))
  assert.ok(!existsSync(join(target, "node_modules")))
  assert.ok(!existsSync(join(target, ".next")))
  assert.ok(!existsSync(join(target, ".env.local")))
})

test("falla si la tienda ya existe", () => {
  const root = fixture()
  newStore("mi-tienda", root)
  assert.throws(() => newStore("mi-tienda", root), /Ya existe apps\/mi-tienda/)
})

test("rechaza slugs inválidos", () => {
  const root = fixture()
  for (const slug of ["", "Mi-Tienda", "mi tienda", "../fuera", "_template", "-x", "x-"]) {
    assert.throws(() => newStore(slug, root), /Slug inválido/, slug)
  }
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test scripts/*.test.mjs`
Expected: FAIL, no se puede resolver `./new-store.mjs`.

- [ ] **Step 3: Implementar**

`scripts/new-store.mjs`:
```js
#!/usr/bin/env node
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SKIP = new Set(["node_modules", ".next", ".env", ".env.local", "test-results", "playwright-report"])

export function newStore(slug, root) {
  if (!SLUG.test(slug)) throw new Error(`Slug inválido "${slug}": usa minúsculas, números y guiones (ej. urban-street)`)
  const template = join(root, "apps", "_template")
  const target = join(root, "apps", slug)
  if (!existsSync(template)) throw new Error(`No existe ${template}`)
  if (existsSync(target)) throw new Error(`Ya existe apps/${slug}`)

  cpSync(template, target, { recursive: true, filter: (src) => !SKIP.has(basename(src)) })

  const pkgPath = join(target, "package.json")
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
  pkg.name = `@store/${slug}`
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
  writeFileSync(join(target, ".env.example"), `STORE_BRAND=${slug}\nCOMMERCE_SOURCE=mock\n`)
  return target
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const slug = process.argv[2] ?? ""
  try {
    const target = newStore(slug, resolve(import.meta.dirname, ".."))
    console.log(`Tienda creada en ${target}`)
    console.log(`Siguiente: pnpm install && cp apps/${slug}/.env.example apps/${slug}/.env.local && pnpm --filter @store/${slug} dev`)
    console.log(`La marca "${slug}" debe existir en packages/commerce/src/mocks.ts (BRANDS, CATEGORIES, PRODUCTS).`)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node --test scripts/*.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Generar las dos tiendas y probarlas**

```bash
pnpm new-store urban-street && pnpm new-store classic-threads && pnpm install
cp apps/urban-street/.env.example apps/urban-street/.env.local
cp apps/classic-threads/.env.example apps/classic-threads/.env.local
pnpm --filter @store/urban-street build && pnpm --filter @store/classic-threads build
```
Expected: ambos builds sin errores.

Run: `pnpm --filter @store/classic-threads dev --port 3200`, luego:
```bash
curl -s localhost:3200 | grep -o "Classic Threads" | head -1                    # → Classic Threads
curl -s -o /dev/null -w "%{http_code}\n" localhost:3200/p/hoodie-oversize       # → 404 (es de Urban Street)
```

- [ ] **Step 6: README**

`README.md`:
````markdown
# ecommerce-storefront

Tiendas en línea multi-marca sobre el mismo Medusa (marca = sales channel + publishable key).
Spec: `docs/superpowers/specs/2026-11-04-storefront-template-design.md` en el repo `ecommerce`.

## Estructura

- `packages/commerce`: única puerta a los datos. Hoy son mocks (`src/mocks.ts`); con Medusa se reescribe `src/next/data.ts` y `src/next/actions.ts` con `@medusajs/js-sdk`.
- `packages/ui`: carrito, checkout y cuenta compartidos, pintados con tokens `--brand-*`.
- `apps/_template`: tienda base. `apps/<slug>`: una tienda por marca, con diseño libre.

## Uso

```bash
nvm use && pnpm install
pnpm new-store mi-marca                       # copia _template a apps/mi-marca
cp apps/mi-marca/.env.example apps/mi-marca/.env.local
pnpm --filter @store/mi-marca dev
pnpm test                                     # unit (commerce + script)
pnpm --filter @store/template test:e2e        # flujo de compra y cuenta
```

La marca nueva debe existir en `packages/commerce/src/mocks.ts`.

## Diseñar una tienda

- Propio de la tienda: `app/layout.tsx`, `app/page.tsx`, `app/c/[slug]`, `app/p/[handle]`, `components/`, `app/globals.css` (tokens `--brand-font-heading`, `--brand-radius`, …).
- Compartido: `app/cart`, `app/checkout`, `app/order/[id]`, `app/account/**` reexportan `@store/ui`. Para rediseñar una, reemplaza la reexportación por tu componente usando `@store/commerce/next` y sus actions.
- Credenciales de prueba: `ana@urban-street.mx` / `luis@classic-threads.mx`, contraseña `Password123`.

## Despliegue

Un proyecto de hosting por tienda con `Root Directory = apps/<slug>` y las variables de su `.env.example`.
````

- [ ] **Step 7: Verificación final**

Run: `pnpm test && pnpm --filter @store/template test:e2e`
Expected: todo en PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: comando new-store y tiendas urban-street y classic-threads"
```

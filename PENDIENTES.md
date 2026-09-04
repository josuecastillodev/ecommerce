# Estado de la rama `claude/medusa-multi-brand-setup-B7PVT`

Plataforma e-commerce multi-marca sobre Medusa.js 2.20. Este documento resume
qué está resuelto y qué falta para dejar la rama lista para merge.

---

## ✅ Resuelto

| Área | Commit(s) | Detalle |
|---|---|---|
| **Instalación / arranque** | `3124f0e` | Dependencias alineadas a Medusa **2.20.1** (el `package.json` tenía versiones inexistentes y nunca se había instalado). `@medusajs/medusa-cli` → `@medusajs/cli`; `@mikro-orm/*` fijado a `6.6.14`; agregados `ts-node`, `tsconfig-paths`, `cloudinary`. `.npmrc` con `node-linker=hoisted` (requerido por Medusa + pnpm). `tsconfig.json` con `ts-node.swc` y `jsx`. |
| **Middlewares** | `4821cd8` | Resuelto el conflicto entre `src/api/middlewares.ts` y `src/api/middlewares/`. La lógica de validación de marca vive en `src/utils/brand-middleware.ts`. |
| **Migraciones** | `b6acfd2` | Generadas y aplicadas para los módulos `brand`, `category`, `customer-brand`. |
| **Pagos Stripe / OXXO** | `e7e5ee0` | Borrado el módulo custom `src/modules/stripe-payment/` (roto contra la interfaz 2.20). Se usa el provider oficial `@medusajs/payment-stripe`, que registra `stripe` (tarjetas) y `stripe-oxxo` (OXXO Pay) nativos. Webhook y verificación de firma los maneja Medusa (`/hooks/payment/*`). Subscribers reescritos: `payment-captured.ts`, `payment-refunded.ts`. |
| **Auth de clientes** | `6a5a92e` | Borrado todo el `/store/auth` y `/store/customers` custom (~1600 líneas: token base64 sin firmar, password en texto plano, `me`/`addresses`/`orders` reimplementados a mano). Se usa el auth nativo de Medusa. La capa multi-marca quedó aislada en: subscriber `customer-created.ts` (crea el `customer_brand` desde `customer.metadata.brand_id`), middleware `validateCustomerBrand()` sobre `/store/customers/me*` y `/store/orders*` (403 si el `X-Brand-Id` no coincide), y el router `GET/POST /store/customers/me/brand`. |
| **Seed / datos de prueba** | `d7d9193`, `49ed743`, `a3774c7` | `seed.ts` ahora siembra los fundamentos de comercio (ver abajo) + 2 clientes de prueba. Bugs pre-existentes arreglados de paso (workflow de producto y `validateAndTransformQuery`). |

---

## 🔴 Pendientes

### 1. Admin dashboard (`src/admin/**`) — sin verificar

- **~360 errores de `tsc --noEmit`**, casi todos aquí. Causa: faltan
  `@types/react` y `@types/react-dom` en `devDependencies`, y `lib: ["DOM"]`
  en `tsconfig.json`. No bloquean el build de Medusa (Vite compila el admin
  aparte) pero el tipado está roto.
  - Fix: `pnpm add -D @types/react @types/react-dom` y añadir `"DOM"` a
    `compilerOptions.lib` en `tsconfig.json`.
- **Nunca se ha comprobado que las pantallas carguen** en `http://localhost:9000/app`.
  Widgets y rutas (`src/admin/routes/brands`, `brand-products`,
  `src/admin/widgets/dashboard-metrics`, `low-stock-alert`, etc.) llaman al
  cliente `src/admin/lib/api.ts` contra endpoints custom — hay que verificar
  que todos existan y respondan.

### 2. Bugs de tipado / runtime en rutas admin

- `src/api/admin/products/[id]/route.ts:133,140` — **claves duplicadas en
  object literal** (`TS1117`): la segunda gana en silencio. Revisar qué campo
  se pierde.
- `src/api/admin/products/[id]/route.ts:90` y
  `src/api/admin/products/[id]/variants/route.ts:112` — spread sobre un tipo
  que TS no reconoce como objeto (`TS2698`); posible `undefined` en runtime.
- `src/workflows/add-variant-to-product.ts:127` — mismo bug que ya se corrigió
  en `create-product-with-brand.ts`: destructura `.result` de
  `xxxWorkflow.runAsStep()`, que devuelve el valor directo. El workflow de
  agregar variante **no funciona** hasta arreglarlo.

### 3. `src/api/middlewares.ts` — ~18 errores de tipo en `validateAndTransformBody/Query`

Mismatch entre `zod@3.25` (instalado) y la versión que esperan los tipos de
Medusa. **Runtime OK** (el server arranca y valida). Para limpiarlo: fijar
`zod` a la versión exacta que usa `@medusajs/framework` (revisar su
`package.json`).

### 4. Checkout end-to-end con Stripe / OXXO — sin probar

El provider está configurado y los datos base sembrados, pero falta el flujo
completo: crear cart → añadir line items → set shipping → crear payment
collection → payment session (`stripe` u `stripe-oxxo`) → confirmar. Necesita
claves reales de Stripe test (`STRIPE_API_KEY`, `STRIPE_PUBLISHABLE_KEY`,
`STRIPE_WEBHOOK_SECRET`) y, para webhooks en local, un túnel (ngrok) apuntando
a `/hooks/payment/stripe`.

### 5. Convención de precios (centavos)

Los productos usan escala centavos: `base_price: 45000` = **$450.00 MXN**. Las
shipping options del seed siguen la misma convención ($99 / $199). Es
consistente dentro de la rama, pero si el modelo de dinero de Medusa 2.x espera
decimales, esto es un bug transversal (productos + envíos) que hay que corregir
de una vez.

### 6. Varios

- **No hay PR abierto** para la rama.
- `src/utils/brand-middleware.ts` exporta `requireBrandId`,
  `validateCartBrandAccess`, `optionalBrandId` sin cablear — toolkit pensado
  para `/store/carts` (evitar compras cross-brand). Cablearlos cuando se
  trabaje el carrito.
- Subscribers `src/subscribers/brand-created.ts` y
  `product-brand-validator.ts` — heredados, sin verificar contra 2.20.
- `README.md` desactualizado: documenta endpoints `/store/auth` y
  `/store/customers/*` que ya no existen (ahora se usan los nativos de Medusa).
- `pk_*` publishable key y credenciales de prueba están en la salida del seed;
  no hay `.nvmrc` (Node del sistema es v24; Medusa 2.20 soporta 20/22, arrancó
  igual).

### Derivados del review del admin dashboard (#1b)

- `src/api/admin/dashboard/metrics/route.ts`: las queries de productos y pedidos
  no tienen `pagination` — cargan todo el catálogo y todos los pedidos en
  memoria. Acotar (ventana de fecha para pedidos, `take` para productos) antes
  de que la tienda tenga volumen real.
- `src/api/admin/brand-products/[id]/route.ts` y `.../[id]/variants/route.ts`
  siguen leyendo `variants.inventory_quantity` (que `query.graph` no popula) →
  reportan stock `0` en detalle/variantes mientras la lista ya muestra el stock
  real. Unificar con el mismo cálculo desde `location_levels`.
- El cálculo de stock disponible (`sum(stocked_quantity - reserved_quantity)`
  sobre `variants.inventory_items.inventory.location_levels`) está duplicado en
  la ruta de lista y en el endpoint de métricas. Extraer un helper compartido
  (p. ej. en `src/modules/product-extension/`).
- Widgets admin: `dashboard-metrics` se queda en "Cargando métricas…" y
  `low-stock-alert` desaparece por completo si su fetch falla — no distinguen
  error de "sin datos". Añadir un estado de error visible.
- Falta un tipo de respuesta compartido para el producto del admin
  (`src/admin/lib/api.ts` usa `any`); un `BrandProduct` en
  `src/admin/lib/types.ts` evitaría el tipo de drift de campos que originó la
  Task 2.
- `pending_orders` en el endpoint de métricas cuenta `status === "pending"`, que
  en Medusa v2 es el estado activo normal (cuenta todo pedido no completado).
  Revisar contra `fulfillment_status`/`payment_status` cuando haya pedidos
  sembrados.
- Docstrings en `src/api/admin/brand-products/*.ts` todavía dicen
  `/admin/products` (rutas viejas antes del move).

---

## Cómo correr y probar en local

```bash
# 1. Servicios
cp .env.example .env
docker-compose up -d postgres redis

# 2. Dependencias + base de datos
pnpm install
npx medusa db:migrate

# 3. Datos de prueba (idempotente)
npm run seed
#   → imprime la publishable key (pk_...) al final

# 4. Usuario admin (NO va en el seed)
npx medusa user -e admin@example.com -p supersecret

# 5. Servidor
npm run dev
#   API:   http://localhost:9000
#   Admin: http://localhost:9000/app
```

### Datos que deja el seed

- **Marcas:** Urban Street (`urban-street`), Classic Threads (`classic-threads`)
- **Región:** México (MXN) con providers `pp_system_default`, `pp_stripe_stripe`, `pp_stripe-oxxo_stripe`
- **Envíos:** Estándar ($99), Exprés ($199) — zona México
- **Productos:** 6 publicados, con inventario en "Almacén CDMX"
- **Clientes de prueba** (password `Password123`):
  | Email | Marca |
  |---|---|
  | `ana@urban-street.mx` | Urban Street |
  | `luis@classic-threads.mx` | Classic Threads |

### Smoke test del auth multi-marca

```bash
PK="<publishable key del seed>"
BRAND_URBAN="<id de la marca urban-street>"    # select id from brand where slug='urban-street'

# login
TOKEN=$(curl -s -X POST http://localhost:9000/auth/customer/emailpass \
  -H 'content-type: application/json' \
  -d '{"email":"ana@urban-street.mx","password":"Password123"}' | jq -r .token)

# marca correcta → 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9000/store/customers/me/brand \
  -H "x-publishable-api-key: $PK" -H "authorization: Bearer $TOKEN" -H "x-brand-id: $BRAND_URBAN"

# marca ajena → 403 "No tienes acceso a esta marca"
```

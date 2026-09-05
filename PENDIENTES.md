# Estado del proyecto (multi-marca sobre Medusa.js 2.20)

Plataforma e-commerce multi-marca sobre Medusa.js 2.20. La rama original
(`claude/medusa-multi-brand-setup-B7PVT`) y sus PRs de seguimiento (#4-#7) ya
están mergeados a `main`. Este documento resume qué está resuelto y qué falta.

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
| **Bugs de rutas admin de producto** | PR #4 (`fix/admin-product-routes-bugs`) | `add-variant-to-product.ts` no funcionaba: `runAsStep()` devuelve el valor directo (no `{ result }`) + el input debía ser `{ product_variants: [...] }`. `products/[id]/route.ts` tenía claves duplicadas en el update de categorías (`remoteLink` con `[Modules.PRODUCT]` repetido) → reemplazado por `category_ids` nativo en `updateProductsWorkflow`. Casts de `req.body`. |
| **Versión de `zod`** | PR #5 (`fix/zod-version-alignment`) | Medusa 2.20.1 usa `zod@4.2.0` internamente (`@medusajs/deps/zod`), no 3.x. Se subió `zod` a `4.2.0` exacto y se migraron los validadores a la API v4 (`z.record` con key schema, `errorMap`→`error`, `.error.issues`, `z.ZodType`). |
| **Admin dashboard — tipado (#1a)** | PR #6 (`fix/admin-react-types`) | Faltaban `@types/react`/`@types/react-dom` y `lib: ["DOM"]` en `tsconfig.json` (~350 de los ~360 errores). 3 widgets usaban injection zones inexistentes en 2.20 (`home.before/after`, `nav.top.before`) → movidos a `product.list.*` como stopgap. |
| **Admin dashboard — pantallas y datos reales (#1b)** | PR #7 (`fix/admin-screens-verify`) | Verificado en navegador y arreglado: la API custom de producto tapaba las pantallas **nativas** de Productos (`GET /admin/products` con middleware estricto → 400 en los params que el admin nativo siempre manda) — movida a `/admin/brand-products*`. La pantalla "Productos por Marca" leía campos que la API no devuelve (`brand_id`, `base_price`, `variants_count`) → `brand`, `price_range`, `variant_count`. `total_stock` pasó de estar siempre en 0 a calcularse real desde `location_levels`. Nuevo endpoint `GET /admin/dashboard/metrics` con agregación real. Bug del filtro de marca por link (`{ brand: { brand_id } }` en vez de `{ brand: { id } }`) corregido en 3 rutas. Widgets `dashboard-metrics` y `low-stock-alert` dejaron de usar mock (`Math.random()` / arrays hardcodeados). |
| **Convención de precios (centavos → decimal)** | — | Medusa 2.x guarda `amount` en **decimal** (unidad mayor: pesos, no centavos) — confirmado contra `@medusajs/dashboard` (`money-amount-helpers.ts` y el `data-grid-currency-cell`, que formatean/editan `amount` tal cual, sin dividir por 100). El seed y dos vistas del admin custom asumían centavos y quedó mezclado: `seed.ts` sembraba `base_price: 45000` / envíos en `9900`-`19900`, mientras `brand-products/page.tsx` y `dashboard-metrics.tsx` dividían `amount / 100` al mostrarlo (compensando, pero solo en las pantallas custom — el admin nativo de Medusa habría mostrado $45,000.00 en vez de $450.00). Corregido: `seed.ts` ahora siembra en decimal (`base_price: 450`, envíos `99`/`199`) y las dos vistas custom dejaron de dividir entre 100. |
| **Checkout end-to-end — cart → shipping → payment → orden** | — | Probado con curl contra el provider manual (`pp_system_default`); dos bugs bloqueaban **cualquier** checkout, sin importar el método de pago: (1) `seed.ts` creaba la tax region de MX sin `provider_id` → 500 "Unable to retrieve the tax provider with id: null" al primer line item (Medusa solo asigna `tp_system` por default a regiones que ya existían al momento de migrar, no a las que crea el seed después). Corregido pasando `provider_id: "tp_system"` explícito. (2) `createProductWithBrandWorkflow` nunca seteaba `shipping_profile_id` al crear productos → `product_shipping_profile` quedaba vacío → 400 "cart items require shipping profiles that are not satisfied by the current shipping methods" al completar el cart, para **todo** producto creado por el seed o por el admin. Corregido: el workflow ahora resuelve el shipping profile default (`resolveShippingProfileStep`) y lo linkea. Con ambos fixes, el flujo completo (cart → line item → dirección → shipping method → payment collection → payment session `pp_system_default` → complete) genera la orden correctamente, con totales en decimal ($999 = $900 producto + $99 envío). |
| **Checkout con Stripe (tarjetas) — verificado con llaves de test reales** | — | Con `STRIPE_API_KEY`/`STRIPE_PUBLISHABLE_KEY` de test puestas en `.env`: `pp_stripe_stripe` crea un `PaymentIntent` real en modo test; confirmado directo contra la API de Stripe con una tarjeta de prueba (`tok_visa`) → `succeeded`. Al completar el cart, Medusa reconoce el pago (orden con `paid_total` = `accounting_total`, `pending_difference: 0`) y el `payment` queda `captured_at` con su `capture` registrado en DB por el monto correcto. Flujo de tarjeta completo, sin necesitar webhook (la captura ocurre síncrona al completar el cart). |
| **Checkout con OXXO — confirmación async por webhook, verificada con ngrok** | — | Túnel `ngrok http 9000` + webhook endpoint real creado en Stripe (API) apuntando a `/hooks/payment/<provider>_stripe`. Encontrado un bug de configuración (no de código): el webhook nativo de Medusa (`payment-webhook.ts`) resuelve el provider como `pp_${eventData.provider}`, tomando el segmento de la URL literal — con `@medusajs/payment-stripe` (que registra **múltiples** sub-providers desde un solo `id: "stripe"` en `medusa-config.ts`: `pp_stripe_stripe` para tarjetas, `pp_stripe-oxxo_stripe` para OXXO) la URL correcta **no** es `/hooks/payment/stripe` sino `/hooks/payment/stripe-oxxo_stripe` (OXXO) o `/hooks/payment/stripe_stripe` (tarjetas) — apuntar a `/hooks/payment/stripe` a secas siempre falla con `AwilixResolutionError: Could not resolve 'pp_stripe'`. Corregida la URL del webhook, el flujo completo funcionó dos veces seguidas de punta a punta sin intervención manual: cart → OXXO payment session → confirmar con `payment_method` tipo `oxxo` en Stripe → voucher generado → Stripe simula el pago en modo test (~2 min) → webhook `payment_intent.succeeded` llega vía ngrok → Medusa captura el pago → `POST .../complete` genera la orden (`paid_total` = `accounting_total`, `pending_difference: 0`). Observación menor: el *primer* intento de procesar cada webhook entrante falló (silenciosamente recuperado por el retry nativo de Medusa, `attempts: 3` en la config del webhook), y solo el reintento tuvo éxito — las 2 veces que se probó. No bloquea nada (Medusa ya reintenta automáticamente) pero vale la pena monitorear en producción si nunca se recupera tras 3 intentos. |
| **Stock duplicado y en `0` en detalle/variantes** | `9897572` | `brand-products/[id]/route.ts` y `.../[id]/variants/route.ts` leían `variants.inventory_quantity` (campo que `query.graph` no popula en esta versión) → siempre reportaban stock `0`, mientras la lista sí calculaba bien desde `location_levels` (con la lógica copiada y pegada). Extraído un helper compartido `calculateVariantStock`/`calculateTotalStock` + `VARIANT_STOCK_FIELDS` en `src/modules/product-extension/stock.ts`, usado ahora en las 4 rutas que necesitan stock (lista, detalle, variantes, y el endpoint de métricas del dashboard, que tenía la misma lógica duplicada una tercera vez). Verificado: lista, detalle y variantes devuelven el mismo `total_stock` para el mismo producto. |

---

## 🔴 Pendientes

### 1. Varios

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
- **Confirmado** (ver fila de "Checkout con Stripe/OXXO" en la tabla de
  arriba): `src/subscribers/payment-captured.ts` sí dispara para la captura
  vía webhook (OXXO), pero **no** para el auto-capture síncrono de tarjetas al
  completar el cart — el pago igual queda `captured_at` en DB en ambos casos,
  solo que uno pasa por el camino que emite el evento y el otro no. Si se
  agrega lógica en ese subscriber (notificar al cliente, etc.), no puede
  depender solo de él para tarjetas; revisar `payment.captured` vs. leer el
  estado directo del pago.

### 2. Follow-ups del admin dashboard (derivados del review de PR #7)

- `src/api/admin/dashboard/metrics/route.ts`: las queries de productos y pedidos
  no tienen `pagination` — cargan todo el catálogo y todos los pedidos en
  memoria. Acotar (ventana de fecha para pedidos, `take` para productos) antes
  de que la tienda tenga volumen real.
- Mismo archivo: `bucket.total_sales += Number(item.total ?? 0)` suma montos
  con `number`/`+=` nativo de JS en vez del `BigNumber` que usa el resto de
  Medusa (`@medusajs/utils`, respaldado por `bignumber.js`, con `amount`
  guardado como `numeric` en Postgres — no `float`). Con pocos pedidos no se
  nota, pero al sumar muchas líneas puede acumular error de punto flotante.
  Migrar a `BigNumber` cuando haya volumen real de pedidos.
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
- `GET /store/products?brand_id=` sigue devolviendo 400 (`Unrecognized fields`):
  el middleware nativo de Medusa sobre `/store/products` rechaza el param antes
  de llegar al handler. El filtro de marca del storefront ya funciona por
  `/store/brands/:slug/products`; si se quiere soportar `brand_id` en
  `/store/products` hay que rodear ese middleware nativo (mismo patrón que el
  des-shadow de `/admin/products`). El fix del key `{ brand: { id } }` en
  `src/api/store/products/route.ts` ya quedó aplicado para cuando se desbloquee.

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

### Smoke test del checkout (provider manual)

Verificado end-to-end con esto — con `pp_system_default` no necesita claves de
Stripe. Para probar `stripe`/`stripe-oxxo` en vez de `pp_system_default` hace
falta un `STRIPE_API_KEY` de test real en `.env`.

```bash
PK="<publishable key del seed>"
REGION="<id de la región México>"       # select id from region
VARIANT="<id de una variante>"          # select id from product_variant limit 1
SHIP_OPT="<id de un shipping option>"   # select id from shipping_option

CART=$(curl -s -X POST http://localhost:9000/store/carts \
  -H 'content-type: application/json' -H "x-publishable-api-key: $PK" \
  -d "{\"region_id\":\"$REGION\"}" | jq -r .cart.id)

curl -s -X POST http://localhost:9000/store/carts/$CART/line-items \
  -H 'content-type: application/json' -H "x-publishable-api-key: $PK" \
  -d "{\"variant_id\":\"$VARIANT\",\"quantity\":1}" > /dev/null

curl -s -X POST http://localhost:9000/store/carts/$CART \
  -H 'content-type: application/json' -H "x-publishable-api-key: $PK" \
  -d '{"email":"buyer@test.mx","shipping_address":{"first_name":"Ana","last_name":"Test","address_1":"Av. Reforma 1","city":"CDMX","country_code":"mx","postal_code":"06600"}}' > /dev/null

curl -s -X POST http://localhost:9000/store/carts/$CART/shipping-methods \
  -H 'content-type: application/json' -H "x-publishable-api-key: $PK" \
  -d "{\"option_id\":\"$SHIP_OPT\"}" > /dev/null

PC=$(curl -s -X POST http://localhost:9000/store/payment-collections \
  -H 'content-type: application/json' -H "x-publishable-api-key: $PK" \
  -d "{\"cart_id\":\"$CART\"}" | jq -r .payment_collection.id)

curl -s -X POST http://localhost:9000/store/payment-collections/$PC/payment-sessions \
  -H 'content-type: application/json' -H "x-publishable-api-key: $PK" \
  -d '{"provider_id":"pp_system_default"}' > /dev/null

# → { "type": "order", "order": { "status": "pending", ... } }
curl -s -X POST http://localhost:9000/store/carts/$CART/complete \
  -H 'content-type: application/json' -H "x-publishable-api-key: $PK" | jq .
```

### Smoke test de Stripe (tarjetas) y OXXO — con llaves de test reales

Requiere `STRIPE_API_KEY`/`STRIPE_PUBLISHABLE_KEY` de **test** (`sk_test_...`
/ `pk_test_...`, nunca `sk_live_...`) en `.env`. Repite los pasos 1-6 del
smoke test anterior pero con `provider_id: "pp_stripe_stripe"` (tarjetas) o
`"pp_stripe-oxxo_stripe"` (OXXO) en el paso de payment-session, y confirma el
`PaymentIntent` directo contra Stripe antes de completar el cart:

```bash
STRIPE_KEY=$(grep '^STRIPE_API_KEY=' .env | cut -d= -f2-)
PI_ID="<data.id de la payment session recién creada>"

# Tarjeta: confirma con la tarjeta de test 4242 4242 4242 4242 → succeeded
PM_ID=$(curl -s https://api.stripe.com/v1/payment_methods -u "$STRIPE_KEY:" \
  -d "type=card" -d "card[token]=tok_visa" | jq -r .id)
curl -s https://api.stripe.com/v1/payment_intents/$PI_ID/confirm -u "$STRIPE_KEY:" \
  -d "payment_method=$PM_ID" -d "return_url=http://localhost:3000/checkout/return" | jq '.status, .amount_received'
# → luego POST /store/carts/$CART/complete genera la orden con paid_total = total

# OXXO: confirma con un payment_method oxxo → genera voucher (requires_action)
PM_ID=$(curl -s https://api.stripe.com/v1/payment_methods -u "$STRIPE_KEY:" \
  -d "type=oxxo" -d "billing_details[email]=buyer@test.mx" -d "billing_details[name]=Ana Test" | jq -r .id)
curl -s https://api.stripe.com/v1/payment_intents/$PI_ID/confirm -u "$STRIPE_KEY:" \
  -d "payment_method=$PM_ID" | jq '.next_action.oxxo_display_details.hosted_voucher_url'
```

Para probar la mitad async (voucher pagado → webhook → orden capturada) en
local:

```bash
# 1. Túnel público
ngrok http 9000
# → anota la URL https, ej. https://xxxx.ngrok-free.dev

# 2. Webhook endpoint en Stripe — OJO con la ruta: NO es /hooks/payment/stripe,
#    es /hooks/payment/<provider_id sin el "pp_">. Con la config de este repo
#    (un solo `id: "stripe"` en medusa-config.ts que registra los sub-providers
#    "stripe" y "stripe-oxxo"), las rutas correctas son:
#      tarjetas → /hooks/payment/stripe_stripe
#      OXXO     → /hooks/payment/stripe-oxxo_stripe
#    (apuntar a /hooks/payment/stripe a secas falla siempre con
#    "AwilixResolutionError: Could not resolve 'pp_stripe'")
curl -s https://api.stripe.com/v1/webhook_endpoints -u "$STRIPE_KEY:" \
  -d "url=https://xxxx.ngrok-free.dev/hooks/payment/stripe-oxxo_stripe" \
  -d "enabled_events[]=payment_intent.succeeded" \
  -d "enabled_events[]=payment_intent.payment_failed" | jq '.id, .secret'
# → pegar el .secret como STRIPE_WEBHOOK_SECRET en .env y reiniciar el server

# 3. Confirmar el payment intent con un payment_method oxxo (paso anterior) y
#    esperar ~2 min: Stripe test mode simula el pago del voucher solo.
#    El webhook llega solo; luego POST /store/carts/$CART/complete genera la
#    orden con paid_total = total. El primer intento de procesar el webhook
#    puede fallar (log "Retrying payment.webhook_received...") — es normal,
#    el retry automático de Medusa (attempts: 3) lo recupera.

# 4. Limpieza: borrar el webhook endpoint temporal cuando termines
curl -s -X DELETE https://api.stripe.com/v1/webhook_endpoints/<id> -u "$STRIPE_KEY:"
```

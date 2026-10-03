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
| **`.nvmrc` y `README.md` desactualizado** | — | Agregado `.nvmrc` (`22.9.0`, versión soportada por Medusa 2.20 verificada en este entorno). `README.md` corregido: comandos `npm` → `pnpm` (según convención del repo), pasos de instalación con el usuario admin que faltaba, y la sección de API Endpoints reemplazada — ya no documenta `/store/auth`/`/store/customers/*` custom (borrados), ahora describe el auth nativo de Medusa + la capa multi-marca (`validateCustomerBrand`, `customer-created.ts`) y los endpoints `/admin/brand-products`, `/admin/dashboard/metrics`. |
| **Tenencia — `/store/categories` y `X-Brand-Id` derivado** | — | Nuevo helper `resolveCallerBrand(req)` en `brand-middleware.ts` (extraído del patrón ya usado en `/store/brands/:slug/products` y `/store/categories/:slug/products`, que ahora lo reusan): resuelve la marca del caller desde `sales_channel` de la publishable key. `/store/categories` (lista) lo adopta — ya no confía en el `brand_id` del query string, sin key válida → 400, mismo soporte de `tree`/`include_global` que antes. Nuevo `resolveRequestBrandId(req)`: intenta primero la marca de la pub key y, si no resuelve, cae a `extractBrandId` (header/query/body); usado por `validateCustomerBrand`, que ya no exige el header `X-Brand-Id` cuando la publishable key alcanza para derivar la marca (la pub key gana sobre un header enviado a mano — más difícil de falsificar). Verificado con curl: `/store/categories` con `PK_URBAN`/`PK_CLASSIC` → cada uno solo ve su marca + globales (8/9 categorías, incluye los 6 globales compartidos); `brand_id` falso en el query → ignorado; sin key → 400; `/store/customers/me` autenticado con `PK_URBAN` y **sin** header → 200; con `PK_CLASSIC` (marca ajena) sin header → 403; con `PK_URBAN` + `X-Brand-Id` falso → 200 (el header se ignora). Regresión en `/store/brands/:slug/products` y `/store/categories/:slug/products` sin cambios. `pnpm run build` → 0 errores. |
| **Carrito y marca — cierre de fugas** | — | Dos huecos del guard de carrito cerrados. (1) `validateCartLineItemBrand` ya no hace `next()` a ciegas cuando el carrito no tiene `sales_channel_id`: sin canal resuelto exige que todas las variantes (entrante + items existentes) compartan `product.brand.id`; si abarcan >1 marca → `403`. (2) Nuevo middleware `validateCartCreateBrand`, cableado en `POST /store/carts`, valida los `items[]` inline antes de crear el carrito — canal objetivo = `body.sales_channel_id` o el de la publishable key; mezcla de marcas → `403`. Helper compartido `resolveVariantBrandInfo` + `checkVariantsAgainstChannel` (fail-closed si el lookup de variantes queda corto). Verificado con curl: `POST /store/carts` con items mixtos → 403, una marca → 200, sin items → 200; regresión de `/line-items` y `/complete` + checkout de una marca → orden, sin cambios; carrito con canal nulo + item de otra marca → 403. `pnpm run build` → 0 errores. |
| **Brand como tenant (sales channel por marca)** | — | Cada marca tiene su sales channel (`Urban Street` / `Classic Threads`) y su publishable key (`<Marca> Storefront`), creados por `seed.ts`. Link nuevo `brand ↔ sales_channel` (`src/links/brand-sales-channel.ts`). `create-product-with-brand` linkea cada producto al canal de su marca. Con eso `/store/products` y `/store/brands/:slug/products` quedan aislados por marca de forma nativa (Medusa filtra por el canal de la pub key). Para el carrito, un middleware (`validateCartLineItemBrand`) rechaza (`403`) agregar o completar un carrito con productos de más de una marca — Medusa 2.20 no lo valida nativamente. Se borraron `/store/products` y `/store/products/[id]` custom (el nativo ya scopea). `/store/brands/:slug/products` ahora exige que el slug sea la marca del canal del request. La capa `customer_brand` + `X-Brand-Id` para clientes/pedidos no cambia. |

---

## 🔴 Pendientes

### 1. Varios

- `src/utils/brand-middleware.ts` exporta `requireBrandId` y `optionalBrandId`
  sin cablear — utilidades genéricas de extracción de marca, disponibles si se
  necesitan. (`validateCartBrandAccess` se eliminó en la Task 4; su rol lo cubre
  ahora `validateCartLineItemBrand`, que deriva la marca del `sales_channel_id`
  del carrito en vez de un header `X-Brand-Id`.)
- Subscribers `src/subscribers/brand-created.ts` y
  `product-brand-validator.ts` — heredados, sin verificar contra 2.20.
- `pk_*` publishable key y credenciales de prueba están en la salida del seed.
- **Confirmado** (ver fila de "Checkout con Stripe/OXXO" en la tabla de
  arriba): `src/subscribers/payment-captured.ts` sí dispara para la captura
  vía webhook (OXXO), pero **no** para el auto-capture síncrono de tarjetas al
  completar el cart — el pago igual queda `captured_at` en DB en ambos casos,
  solo que uno pasa por el camino que emite el evento y el otro no. Si se
  agrega lógica en ese subscriber (notificar al cliente, etc.), no puede
  depender solo de él para tarjetas; revisar `payment.captured` vs. leer el
  estado directo del pago.
- `/store/categories/:slug/products` y `/store/categories` (lista) se scopean al
  canal de la publishable key — **resuelto**, ver fila "Tenencia — `/store/categories`
  y `X-Brand-Id` derivado" en ✅ Resuelto.
- `X-Brand-Id` en `/store/customers/me*` y `/store/orders*` ahora se deriva del
  sales channel de la publishable key — **resuelto**, misma fila de arriba.
- No hay admin user scopeado por marca: el admin ve todos los canales/marcas.
- Almacén único (`Almacén CDMX`) compartido entre los sales channels de las dos
  marcas; si se quiere inventario separado, un stock location por marca.
- Filtros de catálogo que tenía el `/store/products` custom borrado
  (`min_price`/`max_price`/`sizes`/`in_stock`): reimplementar como ruta custom
  scopeada por canal si un storefront los necesita.
- `default_sales_channel_id` del store apunta al "Default Sales Channel" de
  Medusa (sin publishable key, ningún storefront lo usa). El seed drena el canal
  legacy **solo de los productos con marca** (los sin marca, si los hubiera, se
  quedan y se loguean como warning), y la publishable key legacy (la vieja
  titulada `"Storefront"`) ahora queda **revocada** por el seed (M3), así que no
  puede servir requests. El canal en sí queda como huérfano inofensivo.
- **Carrito y marca**: Medusa 2.20.1 no valida nativamente que la variante esté
  en el `sales_channel_id` del carrito (verificado 2026-09-07). Cubierto por el
  middleware `validateCartLineItemBrand` (Task 7), cableado en
  `POST /store/carts/:id/line-items` y `POST /store/carts/:id/complete` — rechaza
  (`403`) mezclar marcas. Los dos follow-ups que quedaban (carrito sin
  `sales_channel_id` sin validar; `POST /store/carts` con `items[]` inline naciendo
  mixto) están **resueltos** — ver fila "Carrito y marca — cierre de fugas" en la
  tabla de ✅ Resuelto.

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

### Verificación de la migración a sales-channel-por-marca (2026-09-07)

Corrido contra `medusa develop` en `:9000` con build fresca (`pnpm run build`),
Postgres/Redis de `docker-compose`, seed idempotente aplicado. Keys usadas:

- `PK_URBAN` → `pk_140724…ebf3` (canal `Urban Street`)
- `PK_CLASSIC` → `pk_fa20ec…c1a` (canal `Classic Threads`)

**Caso 1 — Catálogo aislado (`/store/products?limit=100` por key).** ✅
`PK_URBAN` devuelve `["Camiseta Grafitti","Playera Oversized Minimal","T-Shirt
Neon Dreams"]`; `PK_CLASSIC` devuelve `["Polo Ejecutivo","Camiseta Básica
Premium","Henley Casual"]`. Cero solapamiento entre las dos listas.

**Caso 2 — Detalle cross-brand → 404.** ✅
`CLASSIC_PROD = prod_01M1PRDY0C5AYJ5GAGMHQ8TAWP` (obtenido con `PK_CLASSIC`).
`GET /store/products/$CLASSIC_PROD` con `PK_URBAN` → **404**; con `PK_CLASSIC` →
**200**.

**Caso 3 — Carrito no mezcla marcas.** ✅ (con guard explícito, re-verificado 2026-09-08).
Medusa 2.20.1 **no** valida nativamente la pertenencia de la variante al sales
channel del carrito (ni en `line-items` ni en `complete`) — la verificación del
2026-09-07 lo demostró (add cross-brand → 200, carrito mixto completó a orden).
Task 7 añadió el middleware `validateCartLineItemBrand` (`src/utils/brand-middleware.ts`),
cableado en `POST /store/carts/:id/line-items` y `POST /store/carts/:id/complete`.
Re-verificación con build fresca y server reiniciado:

- Cart `PK_URBAN` con un item Urban dentro; agregar la variante **Classic**
  `variant_01M1PRDY14JFZ5RA7WY80Q7JCY` por `POST .../line-items` →
  **HTTP 403** `{"type":"not_allowed","message":"No puedes agregar productos de
  otra marca a este carrito."}`.
- Agregar una segunda variante **Urban** al mismo carrito → **HTTP 200**
  (`Camiseta Grafitti` + `Playera Oversized Minimal`).
- Checkout de una sola marca completo con `PK_URBAN` (cart → line-item →
  dirección → shipping method → payment collection → session `pp_system_default`
  → `complete`) → `{"type":"order", order_01M20S0CK10R2K9HF34YZRZNCJ,
  display_id:8, total:549}`. Sin regresión.
- Carrito mixto pre-armado por el módulo de carrito (saltándose el middleware
  HTTP): `POST /store/carts/<mixed>/complete` con `PK_URBAN` → **HTTP 403**
  (`Camiseta Grafitti` Urban + `Polo Ejecutivo` Classic en canal Urban).

**Caso 4 — `/store/brands/:slug/products` scopeado.** ✅
`PK_URBAN` → `/store/brands/urban-street/products` = **200**,
`/store/brands/classic-threads/products` = **404**. `PK_CLASSIC` → simétrico
(`classic-threads` 200, `urban-street` 404).

**Caso 5 — Checkout regresión con `PK_URBAN` en todo el flujo.** ✅
cart → line-item (Urban) → dirección → shipping method (`so_01M1PRDXMY1AJGA5T9A0BF0H7T`)
→ payment collection → payment session `pp_system_default` → `complete`.
Resultado: `{"type":"order", order_id:"order_01M1ZASWW1BDRZDJR8D46B4YSS",
display_id:6, total:549, status:"pending"}` (450 producto + 99 envío). Sin
regresión: el checkout funciona igual con la key de marca.

**Caso 6 — Probe de invariantes de datos
(`npx medusa exec ./src/scripts/verify-brand-channels.ts`).** ✅
Salida:

```
[verify] OK brand "Urban Street" -> canal "Urban Street"
[verify] OK brand "Classic Threads" -> canal "Classic Threads"
[verify] OK key "Urban Street Storefront" -> canal "Urban Street"
[verify] OK key "Classic Threads Storefront" -> canal "Classic Threads"
[verify] OK los 6 productos están cada uno solo en el canal de su marca
[verify] Todas las invariantes de tenancy se cumplen.
```

#### Concern del Caso 3 (aislamiento de carrito) — RESUELTO en Task 7

El plan asumía que "un carrito rechaza line items fuera de su canal" de forma
nativa. **No es así en Medusa 2.20.1**: `addToCartWorkflow` / `completeCartWorkflow`
no comprueban que la variante esté en el `sales_channel_id` del carrito. El
aislamiento del **catálogo** (casos 1, 2, 4) sí se sostiene, pero un cliente que
ya conozca un `variant_id` de otra marca podía mezclarlo y completar la orden.

Task 7 añadió el middleware explícito `validateCartLineItemBrand`
(`src/utils/brand-middleware.ts`), cableado en `POST /store/carts/:id/line-items`
y `POST /store/carts/:id/complete`. Resuelve el `sales_channel_id` del carrito y
devuelve `403 { type: "not_allowed" }` si la variante entrante (`body.variant_id`)
o cualquier line item ya presente pertenece a un producto que no está en ese
canal. Si el carrito no existe o no tiene `sales_channel_id`, llama `next()` y
deja responder al handler nativo. Verificado (ver Caso 3 arriba, re-verificación
2026-09-08).

### Fixes del review final de rama (M1-M3) — aplicados y re-verificados (2026-09-08)

- **M1** — `validateCartLineItemBrand` ahora falla cerrado si su propio lookup
  de variantes devuelve menos filas que las pedidas (`variants.length !==
  variantIds.size` → 500), en vez de dejar pasar (`next()`) variantes que no
  vio. Re-verificado: add cross-brand → **403**, add mismo brand → **200**
  (dos items Urban en el mismo carrito), sin regresión en el happy path.
- **M2** — `/store/categories/:slug/products` se scopea al canal de la
  publishable key (misma lógica que `/store/brands/:slug/products`). Sin key
  válida → **400**. Con `PK_URBAN` / `PK_CLASSIC` → **200** y `filters.brand`
  forzado al brand del caller; cualquier `brand_id` del query string se ignora.
  Nota: en el estado actual de la DB la tabla de link
  `categorymodule_category_product_product` está vacía (0 filas), así que la
  ruta devuelve `count: 0` para ambas keys — el aislamiento por marca y el 400
  sin key sí quedan demostrados; poblar los links categoría↔producto es un
  pendiente pre-existente aparte.
- **M3** — el seed revoca cualquier publishable key cuyo título no sea
  `Urban Street Storefront` / `Classic Threads Storefront` vía
  `apiKeyModule.revoke(id, { revoked_by: "seed" })`. Primera corrida revocó
  `Default Publishable API Key`; segunda corrida es no-op (`revoked_at` ya
  seteado). `verify-brand-channels.ts` suma dos invariantes nuevas (ninguna key
  fuera de `KEY_TITLES` linkeada a un canal de marca; el path
  `variant -> product.sales_channels` del cart guard resuelve) — las 7 pasan.
- `pnpm run build` → tsc 0 errores.

### Cierre de fugas del carrito — `POST /store/carts` y carrito sin canal (2026-09-08)

Refactor de `src/utils/brand-middleware.ts`: helper compartido
`resolveVariantBrandInfo` (por variante: `product.brand.id` +
`product.sales_channels.id`, fail-closed si el lookup queda corto) y
`checkVariantsAgainstChannel` (con `channelIds` → cada producto debe estar en
alguno; sin `channelIds` → todas las variantes deben compartir una sola marca).

- **Task 2** — `validateCartLineItemBrand` ya no hace `next()` a ciegas cuando el
  carrito no tiene `sales_channel_id`; aplica la regla de "marca única".
- **Task 1** — nuevo `validateCartCreateBrand`, cableado en `POST /store/carts`,
  valida los `items[]` inline antes de crear el carrito. Canal objetivo:
  `body.sales_channel_id` explícito, si no el/los `sales_channel_ids` de la
  publishable key; sin canal → regla de marca única.

Verificación con curl (`medusa start` en `:9000`, build fresca, seed aplicado,
`PK_URBAN` = `pk_140724…ebf3`):

| Caso | Resultado |
|---|---|
| `POST /store/carts` con `items[]` Urban + Classic, `PK_URBAN` | **403** `not_allowed` |
| `POST /store/carts` con `items[]` solo Classic, `PK_URBAN` (marca ajena a la key) | **403** |
| `POST /store/carts` con `items[]` Urban + Urban, `PK_URBAN` | **200** |
| `POST /store/carts` sin `items[]`, `PK_URBAN` | **200** |
| `/line-items` add Urban → add Classic → add 2º Urban (regresión) | **200 / 403 / 200** |
| Checkout una marca completo (`/complete`) | **orden** `order_01M21TA0…`, total 1069, sin regresión |
| Carrito con `sales_channel_id` nulo (forzado en DB) + add variante de otra marca | **403** |
| Mismo carrito sin canal + add variante de la misma marca | pasa al handler nativo (no lo bloquea el guard) |

`pnpm run build` → 0 errores.

# Storefront template multi-tienda — diseño

Fecha: 2026-11-04 · Estado: propuesto

## Objetivo

Un template de tienda en línea del que nacen N tiendas, todas conectadas al
mismo Medusa con la estrategia actual (marca = sales channel + publishable key,
spec 2026-10-17). Cada tienda tiene diseño libre; carrito, checkout y cuenta de
cliente son una base compartida. En esta fase no hay llamadas a la API: todo
sale de mocks con la forma exacta de la Store API.

**Éxito:**
- Crear una tienda nueva es un comando y queda navegable con mocks.
- Una tienda puede rediseñar cualquier pantalla, incluidas las compartidas.
- Una mejora al carrito/checkout/cuenta llega a todas las tiendas sin copiar código.
- Pasar de mocks a Medusa real cambia solo `packages/commerce`, no los componentes.

**Supuesto:** "tienda" = una marca dentro de un tenant (un sales channel), no un
tenant con su propia instancia de Medusa.

## Decisiones

| Tema | Decisión | Descartado |
|---|---|---|
| Repositorio | Repo nuevo `ecommerce-storefront`, separado del backend | Monorepo con el backend (obliga a reestructurar este repo) |
| Estructura | Monorepo pnpm: `packages/*` compartido + `apps/<tienda>` | Una app con temas por marca (limita el diseño, acopla deploys); repo por tienda + paquete npm (publicar versiones en N repos) |
| Compartido | Lógica + UI base tematizable de carrito/checkout/cuenta | Solo headless (cada tienda rehace su checkout) |
| Override | La tienda reemplaza la reexportación de la ruta por su componente | Sistema de slots/plugins |

## Estructura

```
ecommerce-storefront/
  packages/
    commerce/          capa de datos, estado de carrito/sesión, tipos
    ui/                pantallas compartidas + preset de Tailwind con tokens
  apps/
    _template/         tienda base completa
    urban-street/      copia del template, diseño propio
    classic-threads/
  scripts/new-store    pnpm new-store <slug>
```

## `packages/commerce`

Única puerta a los datos. Los componentes nunca importan mocks directamente.

```
getBrand()                                       → forma de GET /store/brand
listCategories() · listProducts({ category }) · getProduct(handle)
cart:     getCart · addItem · updateItem · removeItem
checkout: setAddresses · listShippingOptions · setShipping · completeCart
customer: login · register · logout · getMe · listOrders · addresses
```

- Fuente seleccionada por `COMMERCE_SOURCE`; en esta fase solo existe `mock`.
- Tipos de `@medusajs/types` (`HttpTypes.StoreProduct`, `StoreCart`, …). La marca
  usa la forma de `GET /store/brand`: `{ brand: { sales_channel_id, slug, name,
  description, logo_url, primary_color, secondary_color } }`.
- Mocks por marca (Urban Street, Classic Threads), MXN, precios en centavos como el
  seed; envíos Estándar $99 y Exprés $199.
- Carrito mock persistido en una cookie, validada con zod al leerla; inválida o
  corrupta → carrito vacío.
- Pago simulado; `completeCart` devuelve un pedido mock. Stripe/OXXO al conectar Medusa.
- Cliente mock: sesión en cookie; credenciales de prueba como las del seed.

## `packages/ui`

- Pantallas: carrito, checkout por pasos (dirección → envío → pago → confirmación),
  cuenta (login, registro, perfil, pedidos, direcciones).
- Piezas: precio, selector de cantidad, botón de agregar al carrito.
- Estilo solo mediante tokens CSS (`--color-primary`, `--color-secondary`,
  `--font-heading`, `--font-body`, `--radius`, …) expuestos por un preset de
  Tailwind v4. Los colores por defecto salen de `getBrand()`; la tienda puede
  sobrescribir cualquier token en su CSS.

## App de tienda (`apps/<slug>`)

```
store.config.ts            slug de marca, locale es-MX, moneda MXN
app/layout.tsx             header/footer propios + tokens de la marca
app/page.tsx               home propio
app/c/[slug]/page.tsx      catálogo propio
app/p/[handle]/page.tsx    producto propio
app/cart/page.tsx          export { CartPage as default } from "@store/ui/cart"
app/checkout/page.tsx      reexporta la pantalla compartida
app/account/**             reexporta las pantallas compartidas
app/error.tsx · app/not-found.tsx
```

- Producto o categoría inexistente → `notFound()`.
- Override: sustituir la línea de reexportación por un componente propio.

## `pnpm new-store <slug>`

Copia `apps/_template` a `apps/<slug>`, ajusta `name` del `package.json` y
`store.config.ts`, y genera `.env.example`. Falla si `apps/<slug>` ya existe.

## Stack

Next.js (App Router, server actions para carrito), React, TypeScript estricto,
Tailwind CSS v4, `@medusajs/types`, zod, pnpm workspaces. Últimas versiones
estables al momento del scaffold, fijadas en el lockfile. Sin Turborepo hasta
que los builds lo pidan.

## Despliegue

- Una tienda = un proyecto de hosting (p. ej. Vercel) con `Root Directory =
  apps/<slug>`, su dominio y sus variables.
- Variables: `COMMERCE_SOURCE=mock`; a futuro `MEDUSA_BACKEND_URL` y
  `MEDUSA_PUBLISHABLE_KEY` (la key determina la marca).

## Pruebas

- Vitest en `packages/commerce`: operaciones del carrito mock, totales con envío,
  formato de precio MXN, cookie inválida → carrito vacío.
- Playwright, un flujo sobre `_template`: home → producto → agregar → carrito →
  checkout → confirmación.

## Fuera de alcance

Conexión real a Medusa, Stripe/OXXO, búsqueda, wishlist, multi-idioma, CMS,
diseño final de cada tienda, e2e más allá del flujo de compra.

## Riesgo conocido

Los precios en centavos replican la convención actual del seed, marcada como
posible bug del modelo de dinero; si se corrige en el backend, los mocks cambian.

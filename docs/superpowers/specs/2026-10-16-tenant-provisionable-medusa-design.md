# Medusa provisionable por tenant — Design

**Fecha:** 2026-10-16
**Estado:** aprobado, pendiente de plan de implementación

## Contexto y problema

El producto se ofrecerá como servicio a otros negocios, además de operar las marcas propias.
El modelo acordado tiene dos niveles:

```
Tenant  = un negocio = una instancia de Medusa (DB, admin, Stripe y dominio propios)
  └── Marca = storefront (sales channel + publishable key), la capa que ya existe
```

Un tenant puede tener una o varias marcas. El negocio propio es el tenant #1 (Urban Street +
Classic Threads).

Un **control plane** (app nueva, propia de este producto, fuera de este repo) registrará los
tenants y su configuración, y los gestionará desde un admin de tenants, siguiendo los patrones
de `../dromo` (registro de tenants, provisioning asíncrono, DB por tenant). Diferencia clave
con Dromo: Medusa no puede cambiar de DB por request (el proceso queda amarrado a un
`DATABASE_URL` al arrancar), así que **cada tenant es un contenedor de Medusa propio**.

Hoy este repo no puede levantar un tenant arbitrario:

- `src/scripts/seed.ts` (869 líneas) mezcla los fundamentos de comercio (región, impuestos,
  almacén, envíos) con datos de demo, y tiene Urban Street y Classic Threads escritas a mano
  (32 menciones). `src/scripts/verify-brand-channels.ts` repite esos nombres
  (`BRAND_CHANNELS` / `KEY_TITLES`).
- La marca, su sales channel y su publishable key solo se crean en el seed.
  `POST /admin/brands` crea una marca **sin** canal ni key, y después crear productos con ella
  falla ("Brand … has no sales channel linked").

## Objetivo

Que este repo (el mismo código para todos los tenants) sepa dejar una instancia de Medusa lista
para vender a partir de una **config de tenant** que recibe del control plane, y mantener
sincronizadas sus marcas cada vez que esa config cambie.

Este es el sub-proyecto 1 de 4. Los otros tres quedan fuera de alcance:

1. **Medusa provisionable** (este spec).
2. Control plane + admin de tenants.
3. Provisioner: DB, migraciones, contenedor, dominio en Traefik, primer usuario admin.
4. Operación de la flota: migraciones en todos los tenants, suspender/borrar.

### No-objetivos

- El control plane, su UI y su DB.
- El provisioner (crear DB, levantar contenedor, configurar Traefik, `medusa user`).
- Migraciones coordinadas de la flota.
- Llaves de Stripe por tenant: siguen en el `.env` de cada contenedor, no en la config.
- Dominios propios de cada storefront.
- Clientes compartidos entre marcas de un mismo tenant (`customer_brand` N:M); es un tema
  aparte.

## Responsabilidades: Medusa vs control plane

El control plane **no** está en el camino de las peticiones: storefronts y admin hablan
directo con Medusa. Opera la flota (alta, `apply`, suspender, borrar).

- **Medusa** conserva todo lo de comercio: catálogo, precios, promociones, carritos, checkout,
  pagos y webhooks de Stripe, órdenes, fulfillment, inventario, clientes y su auth, usuarios
  admin, regiones, impuestos y envíos. `apply` usa los workflows nativos de Medusa, no
  reimplementa nada.
- **El control plane** solo tiene lo que Medusa no tiene: el concepto de tenant (registro,
  ciclo de vida, DB, contenedor, dominio, secretos) y la **estructura** de las marcas
  (marca = sales channel + publishable key es la capa multi-marca de este repo).

### Quién manda sobre cada dato

| Dato | Se carga en la DB del tenant | Después se edita en |
|---|---|---|
| `initial`: moneda, región, países, impuestos, proveedores de pago de la región, almacén, opciones y precios de envío | **Una sola vez**, en el primer `apply` | **Admin de Medusa.** Cambiar `initial` en el control plane después no tiene efecto |
| Estructura de marca: existencia, `slug`, `name`, `active` | En el primer `apply` y en cada cambio | **Solo control plane** |
| Apariencia de marca: `logo_url`, `primary_color`, `secondary_color`, `description` | **Solo al crear la marca**, como valores iniciales | **Admin de Medusa** (el cliente). `apply` nunca los pisa |
| Productos, precios, inventario, categorías, promociones, clientes, órdenes | Nunca vienen en la config | **Admin de Medusa** |

La UI del control plane debe mostrar `initial` como "solo al crear el tenant" (solo lectura
una vez activo). Se anota para el sub-proyecto 2.

## Contrato: la config del tenant

Validada con zod (`TenantConfigSchema`) y versionada para poder evolucionarla.

```jsonc
{
  "version": 1,
  "store": { "name": "Acme" },
  "brands": [
    {
      "slug": "acme-kids",            // identidad, inmutable
      "name": "Acme Kids",
      "active": true,
      // apariencia: solo se usa al crear la marca
      "description": "…",
      "logo_url": null,
      "primary_color": "#123456",
      "secondary_color": "#ffffff"
    }
  ],
  "initial": {
    "currency": "mxn",
    "region": {
      "name": "México",
      "countries": ["mx"],
      "payment_providers": ["pp_system_default", "pp_stripe_stripe", "pp_stripe-oxxo_stripe"]
    },
    "stock_location": {
      "name": "Almacén CDMX",
      "address": {
        "address_1": "Av. Paseo de la Reforma 1",
        "city": "Ciudad de México",
        "country_code": "mx",
        "postal_code": "06600"
      }
    },
    "shipping_options": [
      { "name": "Envío Estándar", "code": "standard", "label": "Estándar",
        "description": "Entrega en 3-5 días hábiles", "amount": 99 },
      { "name": "Envío Exprés", "code": "express", "label": "Exprés",
        "description": "Entrega en 1-2 días hábiles", "amount": 199 }
    ]
  }
}
```

Reglas de validación:

- `version` debe ser `1`.
- `brands[].slug` único dentro de la config, formato kebab-case.
- Los montos van en unidad mayor (decimal), igual que Medusa 2.x (`amount: 99` = $99 MXN).
- `initial` es obligatorio aunque ya se haya aplicado: el control plane siempre manda la
  config completa; Medusa decide si lo usa.

## `applyTenantConfigWorkflow`

Archivo: `src/workflows/apply-tenant-config.ts`. Un solo workflow con toda la lógica; las dos
puertas de entrada (endpoint y CLI) solo validan y lo invocan.

### Paso 1: valores iniciales (una sola vez por tenant)

- Si la tienda (`store.metadata.tenant_bootstrapped_at`) ya tiene la marca, se salta el paso.
- Si no, crea con los workflows nativos, **buscando primero por nombre / clave natural** para no
  duplicar (esto permite reintentar un primer `apply` fallido y adoptar una DB existente):
  - moneda soportada por defecto y `default_sales_channel_id` de la tienda; nombre de la
    tienda desde `store.name`;
  - región con países y proveedores de pago;
  - tax region por país con `provider_id: "tp_system"` explícito (sin él falla el cálculo de
    impuestos; ver `PENDIENTES.md`);
  - stock location + link al proveedor de fulfillment `manual_manual`;
  - fulfillment set + service zone con los países de la región, link al almacén;
  - shipping profile `default` (reusa el de Medusa si existe);
  - opciones de envío con sus precios por moneda y por región.
- Al terminar, escribe `tenant_bootstrapped_at` en `store.metadata`.
- La lógica sale de la sección "0. Commerce fundamentals" del `seed.ts` actual.

Consecuencia buscada: si el cliente renombra su región o cambia un precio de envío en el admin
de Medusa, `apply` no lo vuelve a crear ni lo pisa.

### Paso 2: sincronizar marcas (en cada `apply`)

`slug` es la identidad. El sales channel de una marca se encuentra **por el link
brand ↔ sales channel**, nunca por nombre.

| Caso | Acción |
|---|---|
| En la config, no en la DB | Crea la marca (estructura + apariencia), su sales channel (nombre = `name` de la marca), el link, una publishable key `"<name> Storefront"` ligada solo a ese canal, y liga el canal a **todas** las stock locations del tenant (normalmente una; si el cliente agrega almacenes después, los canales nuevos también los ven) |
| En ambas | Actualiza `name` y `active`. Si cambió `name`, renombra el canal y el título de la key. **No toca la apariencia** |
| En la DB, no en la config | **Nunca se borra** (tiene productos y órdenes). Se desactiva: `active=false`, canal `is_disabled=true`, keys revocadas |
| Inactiva en la DB y vuelve a la config activa | Se reactiva: `active=true`, canal habilitado, **key nueva** (las revocadas no se reusan). Conserva la apariencia que haya puesto el cliente |

`active: false` en la config equivale a "desactivar" sin sacarla de la lista.

### Paso 3: resultado

```jsonc
{
  "bootstrapped": true,            // false si el paso 1 se saltó
  "brands": [
    { "slug": "acme-kids", "active": true,
      "sales_channel_id": "sc_…", "publishable_key": "pk_…" }
  ]
}
```

El control plane lo necesita para configurar cada storefront.

### Garantías

- **Idempotente:** dos `apply` seguidos con la misma config no cambian nada.
- **Sin concurrencia:** un lock con el módulo de locking de Medusa (clave `tenant-apply`,
  sin espera). El locking se configura con el proveedor Redis para que también excluya un
  `apply` por CLI mientras el server corre otro. Si el lock está tomado, el endpoint
  responde 409 y el CLI termina con error.
- **Rollback:** si el paso 2 falla, su compensación borra lo que ese apply **creó** (keys, canales, marcas nuevas). Las actualizaciones y el paso 1 no se revierten: son convergentes (buscar por clave natural antes de crear), así que reintentar el apply termina en el mismo estado.

## Puertas de entrada

### Endpoint `POST /internal/tenant/apply`

- Fuera de `/admin` y `/store`, para que no le apliquen la auth de usuario ni la publishable
  key de Medusa.
- **Auth:** `Authorization: Bearer <CONTROL_PLANE_TOKEN>`, comparado en tiempo constante
  (`crypto.timingSafeEqual`). Un token distinto por tenant, puesto por el provisioner en el
  `.env`.
- Si `CONTROL_PLANE_TOKEN` no está definido, el endpoint responde **404** (no existe).
- Token ausente o incorrecto → 401.
- Body inválido → 400 con los campos que fallan, sin tocar nada.
- Correcto → 200 con el resultado del workflow. Lock tomado → 409.

Versión 1 con bearer compartido: la llamada va por red interna (Traefik) y HTTPS. Si en el
futuro el control plane llama desde fuera, se puede pasar a firma HMAC con timestamp sin cambiar
el workflow.

### CLI `pnpm run tenant:apply -- <archivo.json>`

- Script `src/scripts/tenant-apply.ts` vía `medusa exec` (toma la ruta de `args`).
- Lee el archivo, valida con el mismo `TenantConfigSchema`, corre el mismo workflow e imprime el
  resultado.
- Para desarrollo local, la demo, y como respaldo manual si el control plane está caído.

### Cuándo lo llama el control plane (contrato para los sub-proyectos 2 y 3)

1. **Alta del tenant:** el provisioner crea la DB, corre `medusa db:migrate`, arranca el
   contenedor, espera `/health` y llama a `apply`.
2. **Cada cambio de marcas** en el control plane.
3. **Reintentos:** como `apply` es idempotente, el control plane reintenta sin riesgo ante
   errores de red.

## Marcas en el admin de Medusa

- `POST /admin/brands` (crear) → 403.
- `DELETE /admin/brands/:id` → 403.
- `POST /admin/brands/:id` (editar) acepta **solo** `logo_url`, `primary_color`,
  `secondary_color` y `description`. Cualquier otro campo → 400.
- UI (`src/admin/routes/brands/**`): se quita "Crear marca" y "Borrar"; se elimina la ruta
  `brands/create`; el formulario de edición deja tocar solo la apariencia y muestra nombre,
  slug y estado sin poder editarlos, con una nota de que se gestionan desde el control plane.

## Demo como un tenant más

- `tenants/demo.json`: Urban Street y Classic Threads con la región, almacén y envíos actuales.
  También sirve de ejemplo documentado del formato.
- `src/scripts/seed-demo.ts` reemplaza a `src/scripts/seed.ts`:
  1. corre `applyTenantConfigWorkflow` con `tenants/demo.json`;
  2. carga lo que es solo de demo: categorías, productos (vía
     `createProductWithBrandWorkflow`), niveles de inventario y los 2 clientes de prueba.
- `pnpm run seed` apunta a `seed-demo.ts` y sigue siendo idempotente.
- Se eliminan del código los nombres de marca escritos a mano, `BRAND_CHANNELS` /
  `KEY_TITLES` duplicados y la revocación de la key legacy `"Storefront"` (era de la migración
  a sales channels; una instalación nueva nunca la crea).

### Adopción de la DB de desarrollo existente

El primer `apply` sobre la DB actual: el paso 1 encuentra por nombre la región "México",
"Almacén CDMX", el fulfillment set y las opciones de envío existentes, no crea duplicados y
marca la tienda. El paso 2 encuentra las dos marcas por slug con su canal y key ya ligados y
solo los reconoce. Resultado esperado: ningún canal, key, región ni envío nuevo.

## Verificación

### Probe `src/scripts/verify-brand-channels.ts` (reescrito, sin nombres a mano)

Recorre todas las marcas de la DB:

- **Activa:** canal ligado y habilitado; canal ligado al almacén; exactamente una publishable
  key vigente y esa key solo apunta a ese canal; sus productos solo están en ese canal.
- **Inactiva:** canal deshabilitado; todas sus keys revocadas.
- La tienda tiene `tenant_bootstrapped_at`.

### Script de escenarios `src/scripts/verify-tenant-apply.ts`

Corre sobre una **DB desechable** (nunca la de desarrollo). Guarda: al arrancar aborta si la
tienda ya tiene `tenant_bootstrapped_at` o si existe algún producto o marca. El repo no tiene
jest; se sigue la convención de scripts `medusa exec`:

1. DB vacía migrada → `apply demo.json` → el probe pasa.
2. `apply` otra vez → mismos conteos de canales, keys, regiones, tax regions, almacenes y
   opciones de envío.
3. Agregar una marca, renombrar otra y quitar una tercera → el probe pasa; el canal de la
   renombrada cambió de nombre.
4. Cambiar los colores de una marca directo en la DB, quitarla de la config, volver a
   incluirla → reactivada con key nueva, colores conservados.
5. Cambiar un precio de envío directo en la DB y cambiar `initial` en la config → `apply` no
   toca ninguno de los dos.

### Con curl contra `medusa develop`

- Endpoint: sin `CONTROL_PLANE_TOKEN` → 404; token incorrecto → 401; body inválido → 400;
  correcto → 200; dos `apply` simultáneos → uno 409.
- Admin de marcas: crear → 403; borrar → 403; editar `name` → 400; editar colores/logo → 200.

### Regresión

- `tsc --noEmit` y `pnpm run build` sin errores.
- `pnpm run seed` sobre la DB de desarrollo existente → sin duplicados (adopción).
- Catálogo por publishable key de cada marca y un checkout de una marca (smoke de
  `PENDIENTES.md`).

## Documentación

- `README.md`: sección "Alta de un tenant" (DB vacía → `db:migrate` → `tenant:apply` →
  `medusa user`) y el formato de la config.
- `PENDIENTES.md`: fila en "Resuelto" y follow-ups (control plane, provisioner, flota, UI del
  control plane con `initial` de solo lectura).

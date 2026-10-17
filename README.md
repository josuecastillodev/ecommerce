# Medusa Multi-Brand Store

Plataforma de e-commerce multi-marca construida con Medusa.js 2.0.

## Características

- **Multi-marca**: Soporte para múltiples marcas independientes
- **Catálogos separados**: Cada marca tiene su propio catálogo de productos
- **Admin unificado**: Un solo dashboard para gestionar todas las marcas
- **Storefronts independientes**: Cada marca puede tener su propio storefront Next.js

## Stack Técnico

- **Backend**: Medusa.js 2.0
- **Base de datos**: PostgreSQL 16
- **Cache/Events**: Redis 7
- **Pagos**: Stripe (configurado para México)
- **Imágenes**: Cloudinary
- **ORM**: MikroORM

## Requisitos

- Node.js 20.19+ o 22.12+ (se usa 24, ver `.nvmrc`) y pnpm 10.28.2 (fijado en `packageManager`)
- Docker y Docker Compose
- pnpm

## Instalación

### 1. Clonar y configurar

```bash
# Copiar variables de entorno
cp .env.example .env

# Editar .env con tus valores
nano .env
```

### 2. Iniciar servicios con Docker

```bash
# Solo PostgreSQL y Redis
docker-compose up -d

# Con Adminer para gestión de BD (desarrollo)
docker-compose --profile dev up -d
```

### 3. Instalar dependencias

```bash
pnpm install
```

### 4. Ejecutar migraciones

```bash
pnpm run db:migrate
```

### 5. Seed de datos iniciales

```bash
pnpm run seed
```

### 6. Crear usuario admin (no lo crea el seed)

```bash
npx medusa user -e admin@example.com -p supersecret
```

### 7. Iniciar servidor de desarrollo

```bash
pnpm run dev
```

El servidor estará disponible en `http://localhost:9000` (admin en `/app`)

## Alta de un tenant

Cada tenant (un negocio, con una o varias marcas) es una instancia de Medusa con su propia DB. La config del tenant la empuja el control plane; en local se aplica desde un archivo.

```bash
# 1. DB vacía + migraciones
pnpm run db:migrate
# 2. Config del tenant (región, almacén, envíos iniciales y marcas)
pnpm run tenant:apply tenants/demo.json
# 3. Usuario admin
npx medusa user -e admin@acme.mx -p <password>
```

- Formato de la config: ver `tenants/demo.json` y `src/tenant/config-schema.ts`.
- `initial` (región, impuestos, almacén, envíos) se aplica **una sola vez**; después se gestiona en el admin de Medusa.
- `brands` se sincroniza en cada apply: crea el sales channel (la marca) + publishable key; las marcas que salen de la config se desactivan (nunca se borran).
- La apariencia de cada marca (logo, colores, descripción) la edita el cliente en el admin de Medusa; nombre, slug y estado solo desde el control plane.
- El control plane usa `POST /internal/tenant/apply` con `Authorization: Bearer $CONTROL_PLANE_TOKEN`. Sin `CONTROL_PLANE_TOKEN` en el `.env`, el endpoint no existe.
- Datos de demo (Urban Street + Classic Threads, productos, clientes de prueba): `pnpm run seed`.

## Estructura del Proyecto

```
/
├── src/
│   ├── modules/
│   │   └── cloudinary-file/ # Proveedor de archivos Cloudinary
│   ├── api/
│   │   ├── admin/           # Rutas de administración
│   │   └── store/           # Rutas de tienda
│   │       └── brand/
│   ├── links/               # Enlaces entre módulos
│   ├── workflows/           # Flujos de trabajo
│   ├── subscribers/         # Suscriptores de eventos
│   ├── jobs/                # Trabajos programados
│   └── scripts/             # Scripts (seed, etc.)
├── medusa-config.ts         # Configuración de Medusa
├── docker-compose.yml       # Servicios Docker
└── .env.example             # Variables de entorno ejemplo
```

## API Endpoints

### Admin

- `GET /admin/dashboard/metrics` - Métricas agregadas por marca (productos, inventario, pedidos)

Las marcas son sales channels; se editan en Settings → Sales Channels (apariencia) y las gestiona el control plane vía `POST /internal/tenant/apply`.

### Store

- `GET /store/brand` - Marca de la publishable key
- `GET/POST /store/customers/me/brand` - Marca y preferencias del cliente autenticado

### Auth y clientes

El auth de clientes usa las rutas **nativas** de Medusa (no hay `/store/auth`
ni `/store/customers` custom):

- `POST /auth/customer/emailpass` - Login
- `POST /auth/customer/emailpass/register` - Registro
- `GET/POST /store/customers`, `GET/POST /store/customers/me*` - Perfil, direcciones
- `GET /store/orders` - Pedidos del cliente

La capa multi-marca se aplica encima con un middleware
(`validateCustomerBrand` en `src/utils/brand-middleware.ts`) que compara el
sales channel de la publishable key contra la marca del cliente y responde
`403` si no coinciden, más un subscriber (`customer-created.ts`) que asocia
cada cliente nuevo a su marca desde `metadata.sales_channel_id`.

## Modelo de Datos - Marca

Una marca es un sales channel nativo; sus datos viven en `metadata`:

| Campo (`metadata`)      | Descripción                         |
|-------------------------|-------------------------------------|
| `brand_slug`            | Slug único (solo el control plane)  |
| `brand_logo_url`        | URL del logo (http/https)           |
| `brand_primary_color`   | Color primario (hex)                |
| `brand_secondary_color` | Color secundario (hex)              |

Nombre y descripción son los del canal; el estado es `is_disabled`. El canal
default del store es la marca default.

## Configuración de Storefronts

Cada marca tiene su **propio sales channel y su propia publishable key** (las
imprime `pnpm run seed` al final). Cada storefront Next.js se configura con la
key de su marca:

```env
NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_...   # la de "Urban Street Storefront" o "Classic Threads Storefront"
NEXT_PUBLIC_BRAND_SLUG=urban-street          # o classic-threads
```

Con eso, `/store/products` queda aislado por
marca de forma nativa (Medusa filtra por el sales channel de la key). `/store/carts`
y el checkout quedan aislados mediante un middleware de validación de marca
(`validateCartLineItemBrand`), porque Medusa 2.20 no valida nativamente que la
variante pertenezca al sales channel del carrito. Las llamadas autenticadas de
cliente (`/store/customers/me*`, `/store/orders*`) se validan contra la marca
asociada al cliente usando la publishable key.

## Desarrollo

### Generar migraciones

```bash
pnpm run db:generate <module>
```

### Ejecutar tests

```bash
pnpm test
```

### Build para producción

```bash
pnpm run build
pnpm start
```

## Deploy

### Backend (Kubernetes)

El backend está preparado para desplegarse en Kubernetes. Ver documentación de Medusa para configuración de producción.

### Storefronts (Vercel)

Cada storefront se despliega en Vercel como proyecto separado.

## Licencia

MIT

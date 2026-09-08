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

- Node.js 20 o 22 (ver `.nvmrc`)
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

## Estructura del Proyecto

```
/
├── src/
│   ├── modules/
│   │   ├── brand/           # Módulo de marcas
│   │   └── cloudinary-file/ # Proveedor de archivos Cloudinary
│   ├── api/
│   │   ├── admin/           # Rutas de administración
│   │   │   └── brands/
│   │   └── store/           # Rutas de tienda
│   │       └── brands/
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

- `GET /admin/brands` - Listar marcas
- `POST /admin/brands` - Crear marca
- `GET /admin/brands/:id` - Obtener marca
- `POST /admin/brands/:id` - Actualizar marca
- `DELETE /admin/brands/:id` - Eliminar marca
- `GET /admin/brand-products` / `GET /admin/brand-products/:id` - Productos con datos de marca y stock (des-shadow de las pantallas nativas de Productos)
- `GET /admin/dashboard/metrics` - Métricas agregadas por marca (productos, inventario, pedidos)

### Store

- `GET /store/brands` - Listar marcas activas
- `GET /store/brands/:slug` - Obtener marca por slug
- `GET /store/brands/:slug/products` - Productos de una marca
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
header `X-Brand-Id` contra la marca del cliente y responde `403` si no
coinciden, más un subscriber (`customer-created.ts`) que asocia cada cliente
nuevo a su marca desde `metadata.brand_id`.

## Modelo de Datos - Brand

| Campo           | Tipo     | Descripción                    |
|-----------------|----------|--------------------------------|
| id              | string   | Identificador único            |
| name            | string   | Nombre de la marca             |
| slug            | string   | Slug único para URLs           |
| logo_url        | string?  | URL del logo                   |
| primary_color   | string   | Color primario (hex)           |
| secondary_color | string   | Color secundario (hex)         |
| description     | string?  | Descripción de la marca        |
| active          | boolean  | Estado activo/inactivo         |
| metadata        | json?    | Metadatos adicionales          |

## Configuración de Storefronts

Cada marca tiene su **propio sales channel y su propia publishable key** (las
imprime `pnpm run seed` al final). Cada storefront Next.js se configura con la
key de su marca:

```env
NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_...   # la de "Urban Street Storefront" o "Classic Threads Storefront"
NEXT_PUBLIC_BRAND_SLUG=urban-street          # o classic-threads
```

Con eso, `/store/products`, `/store/carts` y el checkout quedan aislados por
marca de forma nativa (Medusa filtra por el sales channel de la key). El header
`X-Brand-Id` se sigue enviando en las llamadas autenticadas de cliente
(`/store/customers/me*`, `/store/orders*`), que se validan contra la marca
asociada al cliente.

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

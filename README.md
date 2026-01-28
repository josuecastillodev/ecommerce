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

- Node.js >= 20
- Docker y Docker Compose
- npm o yarn

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
npm install
```

### 4. Ejecutar migraciones

```bash
npm run db:migrate
```

### 5. Seed de datos iniciales

```bash
npm run seed
```

### 6. Iniciar servidor de desarrollo

```bash
npm run dev
```

El servidor estará disponible en `http://localhost:9000`

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

### Store

- `GET /store/brands` - Listar marcas activas
- `GET /store/brands/:slug` - Obtener marca por slug
- `GET /store/brands/:slug/products` - Productos de una marca

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

Cada storefront (Next.js) debe configurarse con:

```env
NEXT_PUBLIC_MEDUSA_BACKEND_URL=http://localhost:9000
NEXT_PUBLIC_BRAND_SLUG=urban-street  # o classic-threads
```

## Desarrollo

### Generar migraciones

```bash
npm run db:generate
```

### Ejecutar tests

```bash
npm test
```

### Build para producción

```bash
npm run build
npm start
```

## Deploy

### Backend (Kubernetes)

El backend está preparado para desplegarse en Kubernetes. Ver documentación de Medusa para configuración de producción.

### Storefronts (Vercel)

Cada storefront se despliega en Vercel como proyecto separado.

## Licencia

MIT

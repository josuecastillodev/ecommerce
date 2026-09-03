import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260903181510 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "customer_brand" drop constraint if exists "customer_brand_customer_id_unique";`);
    this.addSql(`create table if not exists "customer_brand" ("id" text not null, "customer_id" text not null, "brand_id" text not null, "registered_from" text not null default 'storefront', "marketing_consent" boolean not null default false, "language_preference" text not null default 'es', "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "customer_brand_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_customer_brand_customer_id_unique" ON "customer_brand" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_brand_deleted_at" ON "customer_brand" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "customer_brand" cascade;`);
  }

}

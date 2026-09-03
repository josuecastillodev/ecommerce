import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260903181509 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "category" drop constraint if exists "category_slug_brand_id_unique";`);
    this.addSql(`create table if not exists "category" ("id" text not null, "name" text not null, "slug" text not null, "description" text null, "image_url" text null, "parent_id" text null, "brand_id" text null, "position" integer not null default 0, "is_active" boolean not null default true, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "category_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_category_deleted_at" ON "category" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_category_slug_brand_id_unique" ON "category" ("slug", "brand_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_category_parent_id" ON "category" ("parent_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_category_brand_id" ON "category" ("brand_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_category_position" ON "category" ("position") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "category" cascade;`);
  }

}

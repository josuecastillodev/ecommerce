import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261017013928 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "category" drop constraint if exists "category_slug_sales_channel_id_unique";`);
    this.addSql(`drop index if exists "IDX_category_slug_brand_id_unique";`);
    this.addSql(`drop index if exists "IDX_category_brand_id";`);

    this.addSql(`alter table if exists "category" rename column "brand_id" to "sales_channel_id";`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_category_slug_sales_channel_id_unique" ON "category" ("slug", "sales_channel_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_category_sales_channel_id" ON "category" ("sales_channel_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_category_slug_sales_channel_id_unique";`);
    this.addSql(`drop index if exists "IDX_category_sales_channel_id";`);

    this.addSql(`alter table if exists "category" rename column "sales_channel_id" to "brand_id";`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_category_slug_brand_id_unique" ON "category" ("slug", "brand_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_category_brand_id" ON "category" ("brand_id") WHERE deleted_at IS NULL;`);
  }

}

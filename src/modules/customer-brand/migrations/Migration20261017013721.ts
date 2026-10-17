import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261017013721 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "customer_brand" rename column "brand_id" to "sales_channel_id";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "customer_brand" rename column "sales_channel_id" to "brand_id";`);
  }

}

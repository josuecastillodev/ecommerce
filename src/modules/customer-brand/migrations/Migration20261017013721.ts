import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261017013721 extends Migration {

  override async up(): Promise<void> {
    // Los ids viejos de marca no son ids de sales channel: con datos, recrear la DB (PENDIENTES.md, "Actualizar desde el módulo de marca").
    this.addSql(`do $$ begin if to_regclass('public.customer_brand') is not null and exists (select 1 from "customer_brand" where deleted_at is null) then raise exception 'customer_brand tiene filas con ids de marca: recrea la DB y vuelve a sembrar (ver PENDIENTES.md, "Actualizar desde el módulo de marca")'; end if; end $$;`);
    this.addSql(`alter table if exists "customer_brand" rename column "brand_id" to "sales_channel_id";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "customer_brand" rename column "sales_channel_id" to "brand_id";`);
  }

}

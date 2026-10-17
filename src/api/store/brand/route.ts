/**
 * GET /store/brand — la marca del storefront que llama, para pintarse
 * (nombre, logo, colores). La marca es el sales channel de su publishable key;
 * la Store API nativa no expone el canal (spec 2026-10-17).
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resolveCallerBrand } from "../../../utils/brand-middleware"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const brand = await resolveCallerBrand(req)
  if (!brand) {
    res.status(404).json({ message: "Marca no encontrada" })
    return
  }
  const { active: _active, ...publicBrand } = brand
  res.json({ brand: publicBrand })
}

/**
 * Auth del control plane para /internal/*: Bearer <CONTROL_PLANE_TOKEN>.
 * Sin token configurado la ruta "no existe" (404), así un tenant mal
 * configurado no queda expuesto.
 */
import { createHash, timingSafeEqual } from "crypto"
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const digest = (value: string) => createHash("sha256").update(value).digest()

export function requireControlPlaneToken() {
  return (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    const expected = process.env.CONTROL_PLANE_TOKEN
    if (!expected) {
      return res.status(404).json({ type: "not_found", message: "Not found" })
    }
    const header = req.headers.authorization ?? ""
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : ""
    // Comparar digests: mismo largo siempre, tiempo constante.
    if (!token || !timingSafeEqual(digest(token), digest(expected))) {
      return res.status(401).json({ type: "unauthorized", message: "Token de control plane inválido" })
    }
    return next()
  }
}

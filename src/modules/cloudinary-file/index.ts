import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import CloudinaryFileService from "./service"

export default ModuleProvider(Modules.FILE, {
  services: [CloudinaryFileService],
})

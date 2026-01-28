import { AbstractFileProviderService } from "@medusajs/framework/utils"
import type {
  FileTypes,
  Logger,
} from "@medusajs/framework/types"
import { v2 as cloudinary, UploadApiResponse } from "cloudinary"

type InjectedDependencies = {
  logger: Logger
}

interface CloudinaryOptions {
  cloudName: string
  apiKey: string
  apiSecret: string
  secure?: boolean
}

class CloudinaryFileService extends AbstractFileProviderService {
  static identifier = "cloudinary"

  protected logger_: Logger
  protected options_: CloudinaryOptions

  constructor({ logger }: InjectedDependencies, options: CloudinaryOptions) {
    super()
    this.logger_ = logger
    this.options_ = options

    // Configure Cloudinary
    cloudinary.config({
      cloud_name: options.cloudName,
      api_key: options.apiKey,
      api_secret: options.apiSecret,
      secure: options.secure ?? true,
    })
  }

  async upload(file: FileTypes.ProviderUploadFileDTO): Promise<FileTypes.ProviderFileResultDTO> {
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: "medusa-store",
          resource_type: "auto",
          public_id: file.filename?.replace(/\.[^/.]+$/, "") || undefined,
        },
        (error, result) => {
          if (error) {
            reject(error)
          } else if (result) {
            resolve(result)
          } else {
            reject(new Error("Upload failed with no result"))
          }
        }
      )

      // Convert base64 or buffer to stream
      if (typeof file.content === "string") {
        // Base64 string
        const buffer = Buffer.from(file.content, "base64")
        uploadStream.end(buffer)
      } else {
        // Binary content
        uploadStream.end(file.content)
      }
    })

    return {
      url: result.secure_url,
      key: result.public_id,
    }
  }

  async delete(file: FileTypes.ProviderDeleteFileDTO): Promise<void> {
    await cloudinary.uploader.destroy(file.fileKey, {
      invalidate: true,
    })
  }

  async getPresignedDownloadUrl(
    fileData: FileTypes.ProviderGetFileDTO
  ): Promise<string> {
    // Generate a signed URL that expires in 1 hour
    const url = cloudinary.url(fileData.fileKey, {
      sign_url: true,
      type: "authenticated",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    })

    return url
  }
}

export default CloudinaryFileService

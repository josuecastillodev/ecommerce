/** Ignora errores de "ya existe" para que crear links sea idempotente. */
export async function safeLink(fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (error: any) {
    if (!/already exist|duplicate|unique/i.test(error?.message ?? "")) {
      throw error
    }
  }
}

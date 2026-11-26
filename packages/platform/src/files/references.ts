import { AppError, fileRefSchema, type FileRef } from '@ai-reflow/core'

export type FileReferenceResolver = (id: string) => Promise<FileRef | undefined>

function missingFile(): never {
  throw new AppError({
    code: 'FILE_NOT_FOUND',
    message: '附件不存在或无权访问。',
    status: 404,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function resolveReference(
  value: unknown,
  resolve: FileReferenceResolver,
): Promise<FileRef> {
  const parsed = fileRefSchema.safeParse(value)
  if (!parsed.success) missingFile()
  const file = await resolve(parsed.data.id)
  if (!file) missingFile()
  const safe = fileRefSchema.safeParse(file)
  if (!safe.success) missingFile()
  return safe.data
}

async function normalizeValue(
  value: unknown,
  schema: Record<string, unknown>,
  resolve: FileReferenceResolver,
): Promise<unknown> {
  if (schema.format === 'file-ref') {
    if (value === null || value === undefined) return value
    return resolveReference(value, resolve)
  }

  if (schema.type === 'array' && isRecord(schema.items)) {
    if (value === undefined) return undefined
    if (!Array.isArray(value)) missingFile()
    if (schema.items.format === 'file-ref') {
      return Promise.all(value.map((item) => resolveReference(item, resolve)))
    }
    return Promise.all(
      value.map((item) => normalizeValue(item, schema.items as Record<string, unknown>, resolve)),
    )
  }

  if (isRecord(schema.properties) && isRecord(value)) {
    const normalized: Record<string, unknown> = { ...value }
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      if (!isRecord(propertySchema) || !(key in value)) continue
      normalized[key] = await normalizeValue(value[key], propertySchema, resolve)
    }
    return normalized
  }

  return value
}

/**
 * 按 JSON Schema 中的 file-ref 标记校验并重建可信文件引用。
 */
export async function validateFileReferences(
  input: Record<string, unknown>,
  schema: Record<string, unknown>,
  resolve: FileReferenceResolver,
): Promise<Record<string, unknown>> {
  const normalized = await normalizeValue(input, schema, resolve)
  return isRecord(normalized) ? normalized : {}
}

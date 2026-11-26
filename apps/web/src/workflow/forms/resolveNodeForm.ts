import type { ManifestField } from '@/shared/types'

/**
 * 将 JSON Schema 属性转换为设计器表单字段。
 * @param schema 节点表单 Schema。
 * @returns 排序后的 Manifest 表单字段。
 */
export function fieldsFromJsonSchema(schema: Record<string, unknown>): ManifestField[] {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
  const required = (schema.required ?? []) as string[]
  return Object.entries(properties)
    .map(([key, property], index) => {
      const rawType = String(property.type ?? 'string')
      const component = property['x-component']
      const enumValues = property.enum as unknown[] | undefined
      const widget = component
        ? String(component)
        : enumValues
          ? 'select'
          : rawType === 'number' || rawType === 'integer'
            ? 'number'
            : rawType === 'boolean'
              ? 'boolean'
              : rawType === 'object' || rawType === 'array'
                ? 'json'
                : 'text'
      return {
        key,
        label: String(property.title ?? key),
        widget: widget as ManifestField['widget'],
        required: required.includes(key),
        defaultValue: property.default,
        group: property['x-group'] ? String(property['x-group']) : undefined,
        help: property.description ? String(property.description) : undefined,
        variable: Boolean(property['x-variable']),
        sensitive: Boolean(property['x-sensitive']),
        options: enumValues?.map((value) => ({ value: String(value), label: String(value) })),
        placeholder: property['x-component-props'] && (property['x-component-props'] as Record<string, unknown>).placeholder
          ? String((property['x-component-props'] as Record<string, unknown>).placeholder)
          : undefined,
        _order: Number(property['x-order'] ?? index),
        _hidden: Boolean(property['x-hidden']),
      } as ManifestField & { _order: number; _hidden: boolean }
    })
    .filter((field) => !(field as ManifestField & { _hidden?: boolean })._hidden)
    .sort(
      (a, b) =>
        (a as ManifestField & { _order?: number })._order! -
        (b as ManifestField & { _order?: number })._order!,
    )
}

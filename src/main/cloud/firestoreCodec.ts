// Firestore's REST API wraps every value in a typed envelope; these convert to and from plain JSON.

export type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } }

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

export function toFs(v: Json): FsValue {
  if (v === null) return { nullValue: null }
  if (typeof v === 'string') return { stringValue: v }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } }
  return { mapValue: { fields: toFsFields(v) } }
}

export function toFsFields(obj: { [k: string]: Json }): Record<string, FsValue> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toFs(v)]))
}

export function fromFs(v: FsValue): Json {
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('booleanValue' in v) return v.booleanValue
  if ('nullValue' in v) return null
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromFs)
  return fromFsFields(v.mapValue.fields ?? {})
}

export function fromFsFields(fields: Record<string, FsValue>): { [k: string]: Json } {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fromFs(v)]))
}

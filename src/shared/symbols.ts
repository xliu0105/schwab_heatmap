// Display form uses a dot for share classes (BRK.B); Schwab's API expects a slash (BRK/B).

export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/[/-]/g, '.')
}

export function toSchwab(symbol: string): string {
  return symbol.replace(/\./g, '/')
}

export function fromSchwab(symbol: string): string {
  return symbol.replace(/\//g, '.')
}

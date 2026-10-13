/** Keep nonfinite diagnostic failure values and negative zero exact instead of JSON's null/zero coercion. */
export function diagnosticJSON(value: unknown, spacing?: number): string {
  return JSON.stringify(value, (_, child: unknown) => typeof child === 'number' && (!Number.isFinite(child) || Object.is(child, -0))
    ? { $tsbNumber: Object.is(child, -0) ? '-0' : String(child) } : child, spacing)
}
export function parseDiagnosticJSON(text: string): unknown {
  return JSON.parse(text, (_, child: unknown) => {
    if (child && typeof child === 'object' && '$tsbNumber' in child && Object.keys(child).length === 1) {
      if (!['NaN', 'Infinity', '-Infinity', '-0'].includes(String(child.$tsbNumber))) throw new Error('Invalid diagnostic number tag')
      return Number(child.$tsbNumber)
    }
    return child
  }) as unknown
}

/** Correções de língua usam a mesma âncora de 420 caracteres dos demais apontamentos. */
export function isLanguageCorrection(quote: string, correction: string): boolean {
  return Boolean(
    quote.trim() &&
    correction.trim() &&
    quote !== correction &&
    quote.length <= 420 &&
    correction.length <= 420,
  )
}

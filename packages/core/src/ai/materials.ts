/**
 * Limites e erros dos materiais enviados à revisão (AIReviewMaterials.swift e SermonReview.swift).
 * A extração de PDFs e páginas Web fica no módulo de cada plataforma; estes limites valem para
 * todas, e nada é truncado: acima deles o envio é bloqueado.
 */

/** Cada fonte (seção de PDF, ensaio ou página Web) tem no máximo 24 KB em UTF-8. */
export const MAXIMUM_BYTES_PER_SOURCE = 24_000

/** Seções de PDF sem componentes delimitados param em 36 páginas físicas. */
export const MAXIMUM_PAGES_PER_SOURCE = 36

/** Manuscrito e fontes somam no máximo 120 KB em UTF-8 por revisão ou pedido de perguntas. */
export const MAXIMUM_INPUT_BYTES = 120_000

const encoder = new TextEncoder()

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength
}

export type SermonReviewMaterialErrorKind =
  'pageStillLoading' | 'pageUnavailable' | 'sourceUnavailable' | 'sectionNotFound' | 'sourceTooLarge'

function materialMessage(kind: SermonReviewMaterialErrorKind, title: string): string {
  switch (kind) {
    case 'pageStillLoading':
      return 'Uma página marcada para revisão ainda está carregando. Aguarde e tente novamente.'
    case 'pageUnavailable':
      return 'Não foi possível extrair o texto da página marcada para revisão.'
    case 'sourceUnavailable':
      return `Não foi possível abrir o material “${title}” marcado para revisão.`
    case 'sectionNotFound':
      return `Não encontrei uma seção legível em “${title}”. Desmarque-a ou escolha a seção no Leitor.`
    case 'sourceTooLarge':
      return `A extração de “${title}” excede os limites e não será enviada parcialmente. Desmarque esta aba para continuar.`
  }
}

export class SermonReviewMaterialError extends Error {
  readonly kind: SermonReviewMaterialErrorKind
  /** Título do material, nos casos que o citam. */
  readonly title: string

  constructor(kind: SermonReviewMaterialErrorKind, title = '') {
    super(materialMessage(kind, title))
    this.name = 'SermonReviewMaterialError'
    this.kind = kind
    this.title = title
  }
}

/** Confere o limite por fonte de uma página Web extraída, como `ReaderSession.reviewSources`. */
export function assertSourceWithinLimit(title: string, text: string): void {
  if (utf8ByteLength(text) > MAXIMUM_BYTES_PER_SOURCE)
    throw new SermonReviewMaterialError('sourceTooLarge', title)
}

/**
 * Modelo neutro do manuscrito, independente do editor. O editor converte seu documento para
 * este formato; as exportações (Google Docs, PDF do tablet, HTML da área de transferência e o
 * texto enviado à revisão) partem dele. Tamanhos em pontos tipográficos.
 */

export type ParagraphAlignment = 'left' | 'center' | 'right' | 'justify'

export type ListKind = 'bullet' | 'ordered' | 'check'

export interface RichRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  superscript?: boolean
  subscript?: boolean
  code?: boolean
  link?: string
  /** Cor do texto em #rrggbb. */
  color?: string
  /** Cor de realce em #rrggbb. */
  highlight?: string
  fontFamily?: string
  fontSizePt?: number
  /** Quando presente, o trecho é a chamada da nota de rodapé com este número. */
  footnote?: number
  /** Quebra de linha dentro do parágrafo (verso de poema, por exemplo). */
  hardBreak?: boolean
}

export interface RichParagraph {
  /** Identificador estável do bloco no editor, usado para ancorar observações da revisão. */
  id?: string
  /** 0 = corpo; 1 a 6 = nível do título. */
  headingLevel: number
  alignment?: ParagraphAlignment
  indentStartPt?: number
  indentFirstLinePt?: number
  spaceBeforePt?: number
  spaceAfterPt?: number
  /** Multiplicador de entrelinha (1, 1.15, 1.5, 2...). */
  lineHeight?: number
  list?: { kind: ListKind; level: number; checked?: boolean; ordinal?: number }
  /** Parágrafo dentro de citação em bloco. */
  quote?: boolean
  /** Linha de atribuição da citação ("— Autor, Obra"). */
  attribution?: boolean
  runs: RichRun[]
}

export interface RichFootnote {
  number: number
  runs: RichRun[]
}

export interface RichDocument {
  title?: string
  paragraphs: RichParagraph[]
  footnotes: RichFootnote[]
}

/** Recuo das citações em bloco, igual ao editor Swift. */
export const QUOTE_INDENT_PT = 34
export const QUOTE_SPACE_BEFORE_PT = 11
export const QUOTE_SPACE_AFTER_PT = 12
/** Fonte do corpo: a serifada embutida no app; runs em outra fonte (Arial dos RTFs antigos, por exemplo) guardam a sua. */
export const BODY_FONT_FAMILY = 'Source Serif 4'
/** Fonte do corpo do app para Mac (RTF): na importação, conta como "sem fonte", para o texto adotar a do app. */
export const LEGACY_BODY_FONT_FAMILY = 'Arial'
export const BODY_FONT_SIZE_PT = 11
export const BODY_LINE_HEIGHT = 1.15

export function emptyDocument(): RichDocument {
  return { paragraphs: [], footnotes: [] }
}

export function paragraphText(paragraph: RichParagraph): string {
  return paragraph.runs
    .map((run) => {
      if (run.hardBreak) return '\n'
      if (run.footnote !== undefined) return String(run.footnote)
      return run.text
    })
    .join('')
}

/**
 * Texto corrido do manuscrito, um parágrafo por linha, com marcadores de lista literais como no
 * RTF antigo ("• "). É este texto que a revisão recebe e contra o qual as citações são conferidas.
 */
export function documentPlainText(
  document: RichDocument,
  options: { includeFootnotes?: boolean } = {},
): string {
  const lines = document.paragraphs.map((paragraph) => {
    const text = paragraphText(paragraph)
    if (!paragraph.list) return text
    if (paragraph.list.kind === 'bullet') return `• ${text}`
    if (paragraph.list.kind === 'check') return `${paragraph.list.checked ? '☑' : '☐'} ${text}`
    return `${paragraph.list.ordinal ?? 1}. ${text}`
  })
  if (options.includeFootnotes && document.footnotes.length > 0) {
    lines.push('', 'Notas')
    for (const note of document.footnotes) {
      lines.push(`${note.number}. ${note.runs.map((run) => run.text).join('')}`)
    }
  }
  return lines.join('\n')
}

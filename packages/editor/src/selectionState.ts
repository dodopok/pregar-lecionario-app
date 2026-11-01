/**
 * Estado de formatação da seleção para a barra do editor, como os @Published de EditorCommands:
 * estilo de parágrafo, fonte, tamanho, alinhamento, espaçamentos, lista e marcas ativas.
 */
import { getMarkAttributes, isMarkActive, isNodeActive, type Editor } from '@tiptap/core'
import { currentFontSizePt } from './commands'
import { BODY_FONT_FAMILY, BODY_LINE_HEIGHT, type ParagraphStyleName } from './styles'
import { primaryFontFamily } from './util'

export interface SelectionFormatting {
  paragraphStyle: ParagraphStyleName
  fontFamily: string
  fontSizePt: number
  alignment: 'left' | 'center' | 'right' | 'justify'
  lineHeight: number
  spaceBeforePt: number
  spaceAfterPt: number
  list: 'none' | 'bullet' | 'ordered' | 'check'
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  superscript: boolean
  subscript: boolean
  quote: boolean
  link: boolean
  hasCopiedFormatting: boolean
  canUndo: boolean
  canRedo: boolean
}

/** Classe e atributos recomendados para o elemento editável (usam MANUSCRIPT_EDITOR_CSS). */
export const MANUSCRIPT_EDITOR_PROPS = {
  attributes: { class: 'manuscript-editor', spellcheck: 'true', lang: 'pt-BR' },
} as const

export function selectionFormatting(editor: Editor): SelectionFormatting {
  const { state } = editor
  const parent = state.selection.$from.parent
  const attrs = parent.attrs
  const level = parent.type.name === 'heading' ? Number(attrs.level) : 0
  const textStyle = getMarkAttributes(state, 'textStyle')
  const alignment = typeof attrs.textAlign === 'string' && ['left', 'center', 'right', 'justify'].includes(attrs.textAlign) ? attrs.textAlign : 'left'
  const list = isNodeActive(state, 'taskList')
    ? 'check'
    : isNodeActive(state, 'orderedList')
      ? 'ordered'
      : isNodeActive(state, 'bulletList')
        ? 'bullet'
        : 'none'
  const mark = (name: string) => (state.schema.marks[name] ? isMarkActive(state, name) : false)
  const can = editor.can()
  return {
    paragraphStyle: (level > 0 ? `heading${level}` : 'normal') as ParagraphStyleName,
    fontFamily: primaryFontFamily(textStyle.fontFamily) ?? BODY_FONT_FAMILY,
    fontSizePt: currentFontSizePt(state),
    alignment: alignment as SelectionFormatting['alignment'],
    lineHeight: typeof attrs.lineHeight === 'number' ? attrs.lineHeight : BODY_LINE_HEIGHT,
    spaceBeforePt: typeof attrs.spaceBefore === 'number' ? attrs.spaceBefore : 0,
    spaceAfterPt: typeof attrs.spaceAfter === 'number' ? attrs.spaceAfter : 0,
    list,
    bold: mark('bold'),
    italic: mark('italic'),
    underline: mark('underline'),
    strike: mark('strike'),
    superscript: mark('superscript'),
    subscript: mark('subscript'),
    quote: isNodeActive(state, 'blockquote'),
    link: mark('link'),
    hasCopiedFormatting: editor.storage.manuscript?.copiedFormatting != null,
    canUndo: can.undo(),
    canRedo: can.redo(),
  }
}

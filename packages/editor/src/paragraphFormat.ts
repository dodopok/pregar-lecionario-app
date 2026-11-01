/**
 * Formatação de parágrafo como atributos de nó, como o NSParagraphStyle do Swift: recuo à
 * esquerda e da primeira linha (absoluto, como headIndent/firstLineHeadIndent e o Google Docs),
 * espaço antes e depois e entrelinha (multiplicador). Valores em pontos; null = padrão.
 */
import { Extension } from '@tiptap/core'
import { cssNumber, parseLengthPt } from './util'

export interface ParagraphFormatOptions {
  types: string[]
}

function lengthFromStyle(value: string): number | null {
  if (!value) return null
  const points = parseLengthPt(value)
  return points === undefined ? null : Math.round(points * 100) / 100
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export const ParagraphFormat = Extension.create<ParagraphFormatOptions>({
  name: 'paragraphFormat',

  addOptions() {
    return { types: ['paragraph', 'heading'] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indentStart: {
            default: null,
            parseHTML: (element) => {
              const value = lengthFromStyle(element.style.marginLeft)
              return value ? value : null
            },
            renderHTML: (attributes) => {
              const value = numberOrNull(attributes.indentStart)
              return value ? { style: `margin-left: ${cssNumber(value)}pt` } : {}
            },
          },
          indentFirstLine: {
            default: null,
            parseHTML: (element) => {
              const indent = lengthFromStyle(element.style.textIndent)
              if (!indent) return null
              return Math.max(0, (lengthFromStyle(element.style.marginLeft) ?? 0) + indent)
            },
            renderHTML: (attributes) => {
              const first = numberOrNull(attributes.indentFirstLine)
              if (first === null) return {}
              const start = numberOrNull(attributes.indentStart) ?? 0
              return { style: `text-indent: ${cssNumber(first - start)}pt` }
            },
          },
          spaceBefore: {
            default: null,
            parseHTML: (element) => lengthFromStyle(element.style.marginTop),
            renderHTML: (attributes) => {
              const value = numberOrNull(attributes.spaceBefore)
              return value === null ? {} : { style: `margin-top: ${cssNumber(value)}pt` }
            },
          },
          spaceAfter: {
            default: null,
            parseHTML: (element) => lengthFromStyle(element.style.marginBottom),
            renderHTML: (attributes) => {
              const value = numberOrNull(attributes.spaceAfter)
              return value === null ? {} : { style: `margin-bottom: ${cssNumber(value)}pt` }
            },
          },
          lineHeight: {
            default: null,
            parseHTML: (element) => {
              const value = element.style.lineHeight
              if (!value || !/^[\d.]+$/.test(value.trim())) return null
              const multiple = Number(value)
              return Number.isFinite(multiple) && multiple > 0 ? multiple : null
            },
            renderHTML: (attributes) => {
              const value = numberOrNull(attributes.lineHeight)
              return value === null ? {} : { style: `line-height: ${cssNumber(value)}` }
            },
          },
        },
      },
      {
        // Linha de atribuição da citação ("— Autor, Obra"); só vale dentro de blockquote.
        types: ['paragraph'],
        attributes: {
          attribution: {
            default: false,
            keepOnSplit: false,
            parseHTML: (element) => element.hasAttribute('data-attribution'),
            renderHTML: (attributes) => (attributes.attribution === true ? { 'data-attribution': '' } : {}),
          },
        },
      },
    ]
  },
})

/**
 * Estilo padrão do manuscrito, igual ao editor Swift (EditorCommands e DocumentParagraphStyle).
 * Tamanhos e espaçamentos em pontos tipográficos.
 */
import {
  BODY_FONT_FAMILY,
  BODY_FONT_SIZE_PT,
  BODY_LINE_HEIGHT,
  LEGACY_BODY_FONT_FAMILY,
  QUOTE_INDENT_PT,
  QUOTE_SPACE_AFTER_PT,
  QUOTE_SPACE_BEFORE_PT,
} from '@pregar/core/document/model'

export {
  BODY_FONT_FAMILY,
  BODY_FONT_SIZE_PT,
  BODY_LINE_HEIGHT,
  LEGACY_BODY_FONT_FAMILY,
  QUOTE_INDENT_PT,
  QUOTE_SPACE_AFTER_PT,
  QUOTE_SPACE_BEFORE_PT,
}

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

/** Tamanho de cada nível de título (DocumentParagraphStyle.pointSize). */
export const HEADING_FONT_SIZES_PT: Readonly<Record<HeadingLevel, number>> = {
  1: 20,
  2: 16,
  3: 14,
  4: 12,
  5: 11,
  6: 11,
}
/** Estilos "Título" e "Subtítulo" do Swift, convertidos em título 1 e corpo na importação. */
export const TITLE_FONT_SIZE_PT = 26
export const SUBTITLE_FONT_SIZE_PT = 15
export const SUBTITLE_COLOR = '#666666'
/** Respiro dos títulos aplicados por estilo de parágrafo. */
export const HEADING_SPACE_BEFORE_PT = 16
export const HEADING_SPACE_AFTER_PT = 6
/** Título legado: negrito a partir de 13 pt (14 pt com 14/4 de espaçamento ao aplicar). */
export const LEGACY_HEADING_MIN_PT = 13
export const LEGACY_HEADING_FONT_SIZE_PT = 14
/** Recuo à direita das citações (tailIndent -12). */
export const QUOTE_INDENT_END_PT = 12
/** Tinta e papel das citações gravados pelo Swift; o editor novo desenha a citação pelo bloco. */
export const QUOTE_INK_COLOR = '#2b523d'
export const QUOTE_PAPER_COLOR = '#e8f0e8'
export const QUOTE_BLOCK_COLOR = '#f0f5f0'
export const QUOTE_BAR_COLOR = '#337a57'
/** Cor aplicada a links inseridos (sRGB 0.102, 0.451, 0.910). */
export const LINK_COLOR = '#1a73e8'
/** Passo de ⌘[ e ⌘]. */
export const INDENT_STEP_PT = 36
/** Nota de rodapé: marcador e área de notas. */
export const FOOTNOTE_MARKER_FONT_SIZE_PT = 8
export const FOOTNOTE_TEXT_FONT_SIZE_PT = 10
export const MIN_FONT_SIZE_PT = 1
export const MAX_FONT_SIZE_PT = 400
export const MIN_LINE_SPACING = 0.5
export const MAX_LINE_SPACING = 5
export const MAX_PARAGRAPH_SPACING_PT = 400

export const FONT_SIZES_PT = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72, 96] as const
export const FONT_FAMILIES = [
  'Arial',
  'Calibri',
  'Cambria',
  'Courier New',
  'Georgia',
  'Helvetica',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
] as const
export const LINE_SPACING_OPTIONS = [
  { label: 'Simples', value: 1 },
  { label: '1,15', value: 1.15 },
  { label: '1,5', value: 1.5 },
  { label: 'Duplo', value: 2 },
] as const

export type ParagraphStyleName =
  'normal' | 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'heading5' | 'heading6'

export const PARAGRAPH_STYLES: ReadonlyArray<{
  name: ParagraphStyleName
  label: string
  level: 0 | HeadingLevel
}> = [
  { name: 'normal', label: 'Texto normal', level: 0 },
  { name: 'heading1', label: 'Título 1', level: 1 },
  { name: 'heading2', label: 'Título 2', level: 2 },
  { name: 'heading3', label: 'Título 3', level: 3 },
  { name: 'heading4', label: 'Título 4', level: 4 },
  { name: 'heading5', label: 'Título 5', level: 5 },
  { name: 'heading6', label: 'Título 6', level: 6 },
]

export const DEFAULT_PLACEHOLDER = 'Comece a escrever… Use # para título, > para citação e - para lista.'
export const DEFAULT_EPIGRAPH_ATTRIBUTION = 'Coleta do dia'

export function headingFontSizePt(level: number): number {
  return HEADING_FONT_SIZES_PT[Math.min(6, Math.max(1, Math.round(level))) as HeadingLevel]
}

/** Tamanho padrão do texto de um parágrafo: corpo ou título. */
export function defaultFontSizePt(headingLevel: number): number {
  return headingLevel > 0 ? headingFontSizePt(headingLevel) : BODY_FONT_SIZE_PT
}

/** Tabela de atalhos exibida em Ajuda › Atalhos do teclado (Google Docs para Mac). */
export const SHORTCUTS: ReadonlyArray<{ label: string; keys: string }> = [
  { label: 'Desfazer / Refazer', keys: '⌘Z / ⇧⌘Z' },
  { label: 'Negrito / Itálico / Sublinhado', keys: '⌘B / ⌘I / ⌘U' },
  { label: 'Tachado', keys: '⇧⌘X' },
  { label: 'Texto normal', keys: '⌥⌘0' },
  { label: 'Título 1 a 6', keys: '⌥⌘1 … ⌥⌘6' },
  { label: 'Esquerda / Centro / Direita / Justificado', keys: '⇧⌘L / E / R / J' },
  { label: 'Lista numerada / Marcadores / Verificação', keys: '⇧⌘7 / 8 / 9' },
  { label: 'Aumentar / Diminuir recuo', keys: '⌘] / ⌘[' },
  { label: 'Inserir link', keys: '⌘K' },
  { label: 'Nota de rodapé', keys: '⌥⌘F' },
  { label: 'Citação / Anotação', keys: '⇧⌘B / ⇧⌘A' },
  { label: 'Sobrescrito / Subscrito', keys: '⌘. / ⌘,' },
  { label: 'Aumentar / Diminuir fonte', keys: '⇧⌘. / ⇧⌘,' },
  { label: 'Copiar / Colar formatação', keys: '⌥⌘C / ⌥⌘V' },
  { label: 'Limpar formatação', keys: '⌘\\' },
  { label: 'Colar sem formatação', keys: '⇧⌘V' },
  { label: 'Localizar / Localizar e substituir', keys: '⌘F / ⇧⌘H' },
  { label: 'Salvar / Imprimir', keys: '⌘S / ⌘P' },
  { label: 'Pesquisar comandos', keys: '⌥/' },
  { label: 'Ver atalhos', keys: '⌘/' },
  { label: 'Aumentar / Diminuir zoom / 100%', keys: '⌘+ / ⌘− / ⌘0' },
]

/**
 * CSS do conteúdo do editor. A classe raiz é aplicada pelo componente (editorProps.attributes).
 * As cores aceitam variáveis para o modo escuro; os valores gravados no documento não mudam.
 */
export const MANUSCRIPT_EDITOR_CSS = `
.manuscript-editor {
  font-family: "${BODY_FONT_FAMILY}", Georgia, serif;
  font-size: ${BODY_FONT_SIZE_PT}pt;
  line-height: ${BODY_LINE_HEIGHT};
  color: var(--manuscript-ink, #000);
  white-space: pre-wrap;
  outline: none;
}
.manuscript-editor p { margin: 0; }
.manuscript-editor h1, .manuscript-editor h2, .manuscript-editor h3,
.manuscript-editor h4, .manuscript-editor h5, .manuscript-editor h6 {
  font-weight: 400;
  margin: ${HEADING_SPACE_BEFORE_PT}pt 0 ${HEADING_SPACE_AFTER_PT}pt;
}
.manuscript-editor h1 { font-size: ${HEADING_FONT_SIZES_PT[1]}pt; }
.manuscript-editor h2 { font-size: ${HEADING_FONT_SIZES_PT[2]}pt; }
.manuscript-editor h3 { font-size: ${HEADING_FONT_SIZES_PT[3]}pt; }
.manuscript-editor h4 { font-size: ${HEADING_FONT_SIZES_PT[4]}pt; }
.manuscript-editor h5 { font-size: ${HEADING_FONT_SIZES_PT[5]}pt; }
.manuscript-editor h6 { font-size: ${HEADING_FONT_SIZES_PT[6]}pt; font-style: italic; }
.manuscript-editor blockquote {
  margin: ${QUOTE_SPACE_BEFORE_PT}pt ${QUOTE_INDENT_END_PT}pt ${QUOTE_SPACE_AFTER_PT}pt 0;
  padding: 5px 0 5px ${QUOTE_INDENT_PT}pt;
  border-left: 2px solid var(--accent, #2e7a51);
  border-radius: 4px;
  color: var(--manuscript-quote-ink, ${QUOTE_INK_COLOR});
  background: var(--manuscript-quote-paper, ${QUOTE_BLOCK_COLOR});
  font-family: var(--font-serif, Georgia, 'Times New Roman', serif);
  font-style: italic;
}
/* Na prosa citada em itálico, a ênfase volta ao redondo para continuar visível. */
.manuscript-editor blockquote:not([data-kind="poem"]) em { font-style: normal; }
/* Poema ou hino: versos sem itálico; a linha que quebra recua (recuo pendente por parágrafo). */
.manuscript-editor blockquote[data-kind="poem"] {
  border-left-width: 1px;
  font-style: normal;
  white-space: pre-wrap;
}
.manuscript-editor blockquote[data-kind="poem"] p { padding-left: 1.5em; text-indent: -1.5em; }
.manuscript-editor p[data-attribution] { font-size: 0.92em; opacity: 0.85; }
/* Anotação: nota do pregador para si; aparte discreto, fora do texto falado e das exportações. */
.manuscript-editor aside.manuscript-annotation {
  margin: 12px 0;
  padding: 8px 12px;
  border-left: 3px solid var(--annotation-ink, #8f5a12);
  border-radius: 6px;
  background: rgba(201, 141, 42, 0.08);
  color: var(--annotation-text, #5c4a28);
  font-family: var(--font-ui, system-ui, sans-serif);
  font-size: 0.86em;
  line-height: 1.5;
}
.manuscript-editor aside.manuscript-annotation::before {
  content: 'Anotação';
  display: block;
  margin-bottom: 2px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--annotation-ink, #8f5a12);
}
.manuscript-editor ul, .manuscript-editor ol { margin: 0; padding-left: ${INDENT_STEP_PT}pt; }
.manuscript-editor ul[data-type="taskList"] { list-style: none; padding-left: 4pt; }
.manuscript-editor ul[data-type="taskList"] li { display: flex; gap: 6pt; align-items: baseline; }
.manuscript-editor ul[data-type="taskList"] li > div { flex: 1; }
.manuscript-editor a { color: var(--manuscript-link, ${LINK_COLOR}); text-decoration: underline; }
.manuscript-editor sup.manuscript-footnote {
  font-size: 0.72em;
  line-height: 0;
  color: var(--manuscript-link, ${LINK_COLOR});
  cursor: pointer;
  padding: 0 1px;
}
.manuscript-editor sup.manuscript-footnote::after { content: attr(data-footnote-number); }
.manuscript-editor sup.manuscript-footnote.ProseMirror-selectednode { outline: 2px solid var(--manuscript-link, ${LINK_COLOR}); border-radius: 2px; }
.manuscript-editor .manuscript-find-match { background: rgba(255, 213, 0, 0.45); border-radius: 2px; }
.manuscript-editor .manuscript-find-current { background: rgba(255, 145, 0, 0.75); }
.manuscript-editor p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
  color: var(--manuscript-placeholder, #9aa0a6);
}
`

/**
 * Tabelas de atalhos (as do README) e a lista de comandos da Mesa usada na pesquisa de comandos
 * (⌥/). Só dados e filtro; quem executa cada comando é a folha.
 */
import { foldCaseAndDiacritics } from '@pregar/core/util/text'

export interface ShortcutRow {
  keys: string
  action: string
}

export interface ShortcutTable {
  title: string
  note?: string
  rows: ShortcutRow[]
}

export const SHORTCUT_TABLES: ShortcutTable[] = [
  {
    title: 'Escrita',
    note: 'Seguem a referência do Google Docs enquanto o manuscrito tem foco.',
    rows: [
      { keys: '⌘B · ⌘I · ⌘U · ⇧⌘X', action: 'Negrito · Itálico · Sublinhado · Tachado' },
      { keys: '⌘Z · ⇧⌘Z', action: 'Desfazer · Refazer' },
      { keys: '⌥⌘0 · ⌥⌘1…6', action: 'Texto normal · Título 1 a 6' },
      { keys: '⇧⌘L · ⇧⌘E · ⇧⌘R · ⇧⌘J', action: 'Alinhar à esquerda · Centralizar · À direita · Justificar' },
      { keys: '⇧⌘7 · ⇧⌘8 · ⇧⌘9', action: 'Lista numerada · Marcadores · Verificação' },
      { keys: '⌘[ · ⌘]', action: 'Diminuir · Aumentar recuo' },
      { keys: '⌘K · ⌥⌘F', action: 'Link · Nota de rodapé' },
      { keys: '⌘. · ⌘,', action: 'Sobrescrito · Subscrito' },
      { keys: '⌥⌘C · ⌥⌘V · ⌘\\', action: 'Copiar formatação · Colar formatação · Limpar formatação' },
      { keys: '⇧⌘V', action: 'Colar sem formatação' },
      { keys: '⌘F · ⇧⌘H', action: 'Localizar · Localizar e substituir' },
      { keys: '⌘S · ⌘P', action: 'Salvar agora · Imprimir' },
      { keys: '⌥/ · ⌘/', action: 'Pesquisar comandos · Ver atalhos' },
      { keys: '⌘+ · ⌘− · ⌘0', action: 'Aumentar zoom · Diminuir zoom · Zoom 100%' },
    ],
  },
  {
    title: 'Preparação',
    rows: [
      { keys: '⌘0 · ⌘1 · ⌘2 · ⌘3 · ⌘4', action: 'Mesa · Bíblia · Leitor · Biblioteca · Arquivo' },
      { keys: '⌘,', action: 'Preferências' },
      { keys: '⇧⌥⌘1 · ⇧⌥⌘2 · ⇧⌥⌘3', action: 'Mostrar ou ocultar calendário, leituras e materiais' },
      { keys: '⇧⌘F', action: 'Modo de escrita' },
      { keys: '⇧⌥⌘R · ⇧⌥⌘E · ⇧⌘T · ⇧⌥⌘H', action: 'Revisar · Ensaio · Tablet · Histórico de versões' },
    ],
  },
  {
    title: 'Leitor',
    note: 'Botão do meio ou ⌘clique nos materiais abre uma nova aba ao fundo; com ⇧, seleciona a nova aba.',
    rows: [
      { keys: '⌘T · ⌘W', action: 'Nova aba · Fechar aba' },
      { keys: '⇧⌘T', action: 'Reabrir a última aba fechada neste sermão' },
      { keys: '⌃Tab · ⇧⌃Tab', action: 'Próxima aba · Aba anterior' },
      { keys: '⌘[ · ⌘]', action: 'Voltar · Avançar' },
      { keys: '⌘L · ⌘R', action: 'Editar endereço do site · Recarregar' },
      { keys: '⌘+ · ⌘−', action: 'Aumentar · Diminuir zoom do PDF' },
    ],
  },
]

const MODIFIERS: Record<string, 'Ctrl' | 'Alt' | 'Shift'> = {
  '⌘': 'Ctrl',
  '⌃': 'Ctrl',
  '⌥': 'Alt',
  '⇧': 'Shift',
}

function convertCombo(combo: string): string {
  const found = new Set<string>()
  let index = 0
  while (index < combo.length && MODIFIERS[combo[index]!]) {
    found.add(MODIFIERS[combo[index]!]!)
    index += 1
  }
  const key = combo.slice(index)
  const ordered = (['Ctrl', 'Alt', 'Shift'] as const).filter((modifier) => found.has(modifier))
  return [...ordered, key].join('+')
}

/**
 * Converte os símbolos do Mac ("⇧⌥⌘R") para a escrita do Windows e do Linux ("Ctrl+Alt+Shift+R"),
 * combinação por combinação ("⌘[ · ⌘]" → "Ctrl+[ · Ctrl+]").
 */
export function platformKeys(keys: string, isMac: boolean): string {
  if (isMac) return keys
  return keys
    .split(' · ')
    .map((combo) => convertCombo(combo.trim()))
    .join(' · ')
}

export type MesaCommandId =
  | 'review'
  | 'structure'
  | 'questions'
  | 'rehearsal'
  | 'tablet'
  | 'history'
  | 'drive'
  | 'shortcuts'
  | 'save'
  | 'focusMode'
  | 'toggleCalendar'
  | 'toggleReadings'
  | 'toggleMaterials'
  | 'tabMaterials'
  | 'tabIdeas'
  | 'tabReview'
  | 'openBible'
  | 'openReader'
  | 'openLibrary'
  | 'openArchive'
  | 'openPreferences'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'quote'
  | 'bulletList'
  | 'orderedList'
  | 'undo'
  | 'redo'
  | 'clearFormatting'

export interface MesaCommand {
  id: MesaCommandId
  title: string
  group: 'Preparação' | 'Painéis' | 'Janelas' | 'Escrita'
  shortcut?: string
  /** Sinônimos para a busca. */
  keywords?: string
}

export const MESA_COMMANDS: MesaCommand[] = [
  {
    id: 'review',
    title: 'Nova revisão…',
    group: 'Preparação',
    shortcut: '⇧⌥⌘R',
    keywords: 'revisar ia critérios apontamentos',
  },
  {
    id: 'structure',
    title: 'Checar estrutura',
    group: 'Preparação',
    keywords: 'mapa do sermão introdução conclusão ideia dominante',
  },
  { id: 'questions', title: 'Perguntas de emergência…', group: 'Preparação', keywords: 'ia dúvidas' },
  {
    id: 'rehearsal',
    title: 'Ensaio',
    group: 'Preparação',
    shortcut: '⇧⌥⌘E',
    keywords: 'cronômetro tempo leitura em voz alta',
  },
  {
    id: 'tablet',
    title: 'Cópia para o tablet…',
    group: 'Preparação',
    shortcut: '⇧⌘T',
    keywords: 'pdf google doc exportar pregar',
  },
  {
    id: 'history',
    title: 'Histórico de versões',
    group: 'Preparação',
    shortcut: '⇧⌥⌘H',
    keywords: 'restaurar comparar versão',
  },
  { id: 'drive', title: 'Google Drive…', group: 'Preparação', keywords: 'conectar ideias nuvem' },
  { id: 'save', title: 'Salvar agora', group: 'Preparação', shortcut: '⌘S' },
  {
    id: 'shortcuts',
    title: 'Atalhos de teclado',
    group: 'Preparação',
    shortcut: '⌘/',
    keywords: 'ajuda teclas',
  },
  {
    id: 'focusMode',
    title: 'Modo de escrita',
    group: 'Painéis',
    shortcut: '⇧⌘F',
    keywords: 'foco concentração',
  },
  { id: 'toggleCalendar', title: 'Mostrar ou ocultar calendário', group: 'Painéis', shortcut: '⇧⌥⌘1' },
  { id: 'toggleReadings', title: 'Mostrar ou ocultar leituras', group: 'Painéis', shortcut: '⇧⌥⌘2' },
  { id: 'toggleMaterials', title: 'Mostrar ou ocultar materiais', group: 'Painéis', shortcut: '⇧⌥⌘3' },
  {
    id: 'tabMaterials',
    title: 'Ver materiais da passagem',
    group: 'Painéis',
    keywords: 'pdf sites artigos comentários',
  },
  { id: 'tabIdeas', title: 'Ver ideias do celular', group: 'Painéis', keywords: 'notas google drive' },
  { id: 'tabReview', title: 'Ver revisões do manuscrito', group: 'Painéis', keywords: 'apontamentos mapa' },
  {
    id: 'openBible',
    title: 'Abrir Bíblia',
    group: 'Janelas',
    shortcut: '⌘1',
    keywords: 'traduções comparar',
  },
  { id: 'openReader', title: 'Abrir Leitor', group: 'Janelas', shortcut: '⌘2', keywords: 'abas pdf sites' },
  {
    id: 'openLibrary',
    title: 'Abrir Biblioteca de PDFs',
    group: 'Janelas',
    shortcut: '⌘3',
    keywords: 'importar indexar',
  },
  {
    id: 'openArchive',
    title: 'Abrir Arquivo de sermões',
    group: 'Janelas',
    shortcut: '⌘4',
    keywords: 'buscar sermões antigos',
  },
  {
    id: 'openPreferences',
    title: 'Abrir Preferências',
    group: 'Janelas',
    shortcut: '⌘,',
    keywords: 'configurações chaves conta',
  },
  { id: 'bold', title: 'Negrito', group: 'Escrita', shortcut: '⌘B' },
  { id: 'italic', title: 'Itálico', group: 'Escrita', shortcut: '⌘I' },
  { id: 'underline', title: 'Sublinhado', group: 'Escrita', shortcut: '⌘U' },
  { id: 'strike', title: 'Tachado', group: 'Escrita', shortcut: '⇧⌘X' },
  { id: 'quote', title: 'Citação em bloco', group: 'Escrita', keywords: 'epígrafe recuo' },
  { id: 'bulletList', title: 'Lista com marcadores', group: 'Escrita', shortcut: '⇧⌘8' },
  { id: 'orderedList', title: 'Lista numerada', group: 'Escrita', shortcut: '⇧⌘7' },
  { id: 'undo', title: 'Desfazer', group: 'Escrita', shortcut: '⌘Z' },
  { id: 'redo', title: 'Refazer', group: 'Escrita', shortcut: '⇧⌘Z' },
  { id: 'clearFormatting', title: 'Limpar formatação', group: 'Escrita', shortcut: '⌘\\' },
]

/** Todas as palavras da busca precisam aparecer (sem distinguir acentos ou maiúsculas). */
export function filterCommands(commands: readonly MesaCommand[], query: string): MesaCommand[] {
  const words = foldCaseAndDiacritics(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...commands]
  return commands.filter((command) => {
    const haystack = foldCaseAndDiacritics(`${command.title} ${command.group} ${command.keywords ?? ''}`)
    return words.every((word) => haystack.includes(word))
  })
}

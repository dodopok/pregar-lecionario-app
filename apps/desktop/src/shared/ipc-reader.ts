import type { ReaderTab } from '@pregar/core/reader'

/** Pedido de abertura de material no Leitor (vindo da Mesa, Biblioteca ou Arquivo). */
export interface ReaderOpenRequest {
  kind: 'pdf' | 'web'
  /** Caminho do PDF (registrado na Biblioteca) ou endereço https. */
  location: string
  title: string
  reference?: string
  sermonDateKey?: string
  physicalPage?: number
  /** Abre ao fundo, sem trocar a aba selecionada (botão do meio ou ⌘clique). */
  background?: boolean
  /** Seleciona a nova aba mesmo ao fundo (⇧). */
  select?: boolean
}

/** Canais do Leitor. O módulo do Leitor acrescenta os seus próprios aqui. */
export interface ReaderInvokeChannels {
  'reader:open': { req: ReaderOpenRequest; res: void }
  /** Abas da preparação (para a Mesa marcar "aberto" e listar materiais da revisão). */
  'reader:tabsForSermon': { req: { dateKey: string }; res: ReaderTab[] }
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ReaderEventChannels {}

/** De onde a ideia veio: digitada na Mesa, trazida do Drive ou capturada de uma leitura/material. */
export type IdeaSource = 'local' | 'drive' | 'reading' | 'material' | 'bible' | 'reader'

export interface Idea {
  id: string
  text: string
  /** Preparação (data) à qual a ideia pertence; nula para ideias soltas. */
  dateKey: string | null
  /** Passagem associada, quando a ideia nasceu de uma leitura. */
  reference: string | null
  source: IdeaSource
  /** Título do material ou da leitura de origem, para mostrar junto da ideia. */
  sourceTitle: string | null
  /** Já foi usada no manuscrito (ou descartada); fica escondida por padrão. */
  done: boolean
  createdAt: string
  modifiedAt: string
}

export interface IdeaInput {
  text: string
  dateKey?: string | null
  reference?: string | null
  source?: IdeaSource
  sourceTitle?: string | null
}

export interface IdeaPatch {
  text?: string
  dateKey?: string | null
  reference?: string | null
  done?: boolean
}

export interface IdeasInvokeChannels {
  /** Ideias da preparação (e as soltas, quando `includeLoose`), mais recentes primeiro. */
  'ideas:list': {
    req: { dateKey?: string | null; includeLoose?: boolean; includeDone?: boolean }
    res: Idea[]
  }
  'ideas:add': { req: IdeaInput; res: Idea }
  'ideas:update': { req: { id: string; patch: IdeaPatch }; res: Idea }
  'ideas:delete': { req: { id: string }; res: void }
  /** Move as ideias soltas (sem data) para a preparação aberta. */
  'ideas:adopt': { req: { ids: string[]; dateKey: string }; res: Idea[] }
}

export interface IdeasEventChannels {
  'ideas:changed': { origin: number }
}

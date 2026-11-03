import type { RichDocument } from '@pregar/core/document/model'
import type { FavoriteAuthor, FavoriteSite, FavoriteSiteSearchReport } from '@pregar/core/sources'
import type { SermonRevision } from '@pregar/core/history'
import type { SermonRecord } from './types'

/** Conteúdo capturado do editor para histórico e restauração. */
export interface SermonSnapshotInput {
  title: string
  mainReadingReference: string | null
  mainReadingSlot: string | null
  doc: string
  plainText: string
}

export interface DriveStatus {
  /** O app tem um cliente OAuth do Google configurado. */
  available: boolean
  connected: boolean
  ideasDocumentURL: string | null
  message: string
}

export interface IdeaNote {
  id: string
  text: string
}

export interface ContentInvokeChannels {
  'sources:profiles': { req: void; res: { sites: FavoriteSite[]; authors: FavoriteAuthor[]; customized?: boolean } }
  'sources:saveProfiles': {
    req: { sites?: FavoriteSite[]; authors?: FavoriteAuthor[] }
    res: { sites: FavoriteSite[]; authors: FavoriteAuthor[] }
  }
  'sources:resetProfiles': { req: void; res: { sites: FavoriteSite[]; authors: FavoriteAuthor[] } }
  'sources:search': {
    req: { reference: string; occasion: string | null; dateKey: string; isSunday: boolean; force?: boolean }
    res: FavoriteSiteSearchReport & { fromCache: boolean }
  }

  'history:list': { req: { dateKey: string }; res: SermonRevision[] }
  'history:capture': { req: { dateKey: string; snapshot: SermonSnapshotInput; force?: boolean }; res: SermonRevision[] }
  'history:restore': {
    req: { dateKey: string; revisionId: string; current: SermonSnapshotInput }
    res: { record: SermonRecord; revisions: SermonRevision[] }
  }

  'drive:status': { req: void; res: DriveStatus }
  'drive:connect': { req: void; res: DriveStatus }
  'drive:disconnect': { req: void; res: DriveStatus }
  'drive:saveSermon': {
    req: { dateKey: string; document: RichDocument; overwriteRemote?: boolean }
    res: { record: SermonRecord; documentURL: string | null }
  }
  'drive:sync': {
    req: { dateKey: string; document: RichDocument }
    res: { status: 'synced' | 'notLinked' | 'unchanged' | 'busy' | 'notConnected' | 'conflict'; record: SermonRecord | null; message: string | null }
  }
  'drive:ideas': { req: { create?: boolean }; res: { notes: IdeaNote[]; documentURL: string | null } }
  'drive:importFolder': {
    req: { link: string; includeSubfolders: boolean; apiKey?: string }
    res: { imported: number; failed: { name: string; message: string }[] }
  }

  'tablet:suggestedFolder': { req: void; res: string | null }
  'tablet:export': {
    req: { dateKey: string; html: string; title: string; choosePath: boolean }
    res: { path: string; record: SermonRecord } | null
  }
  /** Abre o diálogo de impressão do sistema com a folha do púlpito (sem gerar PDF). */
  'tablet:print': { req: { html: string; title: string }; res: { printed: boolean; message: string | null } }
  /** Salva o manuscrito como texto simples (.txt), para colar em qualquer lugar. */
  'tablet:saveText': { req: { dateKey: string; text: string; title: string }; res: { path: string } | null }

  'backup:create': { req: void; res: { path: string } | null }
  'backup:restore': { req: void; res: { restored: boolean; message: string } }
  'backup:importLegacy': { req: void; res: { imported: boolean; message: string } }
}

export interface ContentEventChannels {
  'drive:status': DriveStatus
  'drive:importProgress': { done: number; total: number; current: string }
}

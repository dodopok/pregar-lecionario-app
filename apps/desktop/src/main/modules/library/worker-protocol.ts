/**
 * Mensagens entre o processo principal e o processo utilitário de indexação. Os registros
 * viajam no JSON do domínio (`encodeLibraryRecord`).
 */
import type { ReviewMaterialSource, ReviewTabInput, SermonReviewMaterialErrorCode } from '@pregar/core/library'

/** Arquivo como o processo principal o conferiu (o worker só lê). */
export interface WorkerFile {
  path: string
  sizeBytes: number
  /** Segundos desde 2001-01-01 UTC, como o registro grava. */
  modificationDate: number
}

export interface WorkerRequests {
  index: { req: { file: WorkerFile; previous: object | null }; res: { record: object } }
  ocrCandidates: {
    req: { file: WorkerFile; previous: object | null }
    res: { pageCount: number; candidatePageCount: number; pages: number[] }
  }
  ocrApply: {
    req: { file: WorkerFile; previous: object | null; texts: Record<number, string> }
    res: {
      record: object
      candidatePageCount: number
      scannedPageCount: number
      recognizedTextPageCount: number
      sectionsFound: number
    }
  }
  review: {
    req: { file: WorkerFile | null; record: object | null; tab: ReviewTabInput; targetReference: string | null }
    res: { sources: ReviewMaterialSource[] }
  }
}

export type WorkerRequestType = keyof WorkerRequests

export type WorkerInbound =
  | { kind: 'request'; id: number; type: WorkerRequestType; payload: unknown }
  | { kind: 'cancel'; id: number }

export interface WorkerErrorInfo {
  message: string
  /** Erros de material da revisão são reconstruídos no processo principal. */
  reviewCode?: SermonReviewMaterialErrorCode
  materialTitle?: string
  name?: string
}

export type WorkerOutbound =
  | { kind: 'result'; id: number; value: unknown }
  | { kind: 'error'; id: number; error: WorkerErrorInfo }
  | { kind: 'progress'; id: number; done: number; total: number }

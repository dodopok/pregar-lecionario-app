import { z } from 'zod'
import { sha256Hex } from '../util/hash'
import { AI_PROVIDERS } from './providers'
import type { AIProvider } from './providers'
import {
  SERMON_REVIEW_CRITERIA,
  SERMON_REVIEW_FINDING_STATUSES,
  SERMON_REVIEW_SEVERITIES,
  STRUCTURE_PAGE_KINDS,
  STRUCTURE_SECTION_KINDS,
} from './review'
import type {
  SermonAIReviewResult,
  SermonReviewContext,
  SermonReviewCriterion,
  SermonReviewFinding,
  SermonStructureAssessment,
} from './review'

/**
 * Relatórios de revisão (`SermonReviewReport` e `SermonReviewReportStore`). O manuscrito nunca é
 * guardado: só a impressão digital SHA-256, para marcar o relatório como antigo quando o texto
 * muda. O armazenamento é de cada plataforma; aqui ficam as regras puras sobre a lista.
 */

export interface SermonReviewReport {
  id: string
  /** Data e hora ISO 8601. */
  createdAt: string
  dateKey: string
  title: string
  mainReference: string
  provider: AIProvider
  model: string
  manuscriptFingerprint: string
  criteria: SermonReviewCriterion[]
  findings: SermonReviewFinding[]
  validationNotice?: string
  structure?: SermonStructureAssessment
}

/** Impressão digital do manuscrito: SHA-256 do texto em UTF-8, em hexadecimal. */
export function manuscriptFingerprint(manuscript: string): Promise<string> {
  return sha256Hex(manuscript)
}

/** O relatório é antigo se a passagem principal mudou ou se o manuscrito não é mais o analisado. */
export async function isReportStale(
  report: Pick<SermonReviewReport, 'mainReference' | 'manuscriptFingerprint'>,
  manuscript: string,
  mainReference?: string | null,
): Promise<boolean> {
  if (mainReference && report.mainReference !== mainReference) return true
  return report.manuscriptFingerprint !== (await manuscriptFingerprint(manuscript))
}

/** Versão síncrona para quem já calculou a impressão digital do texto atual. */
export function isReportStaleForFingerprint(
  report: Pick<SermonReviewReport, 'mainReference' | 'manuscriptFingerprint'>,
  fingerprint: string,
  mainReference?: string | null,
): boolean {
  if (mainReference && report.mainReference !== mainReference) return true
  return report.manuscriptFingerprint !== fingerprint
}

export function openFindings(report: Pick<SermonReviewReport, 'findings'>): SermonReviewFinding[] {
  return report.findings.filter((finding) => finding.status === 'open')
}

export function closedFindings(report: Pick<SermonReviewReport, 'findings'>): SermonReviewFinding[] {
  return report.findings.filter((finding) => finding.status !== 'open')
}

export function isReportEmpty(report: Pick<SermonReviewReport, 'findings'>): boolean {
  return report.findings.length === 0
}

export interface MakeReportOptions {
  id?: string
  createdAt?: Date
}

/** Monta o relatório de uma revisão concluída, como a folha de revisão do app Swift. */
export async function makeSermonReviewReport(
  context: SermonReviewContext,
  provider: AIProvider,
  model: string,
  result: Pick<SermonAIReviewResult, 'findings' | 'validationNotice' | 'structure'>,
  options: MakeReportOptions = {},
): Promise<SermonReviewReport> {
  const report: SermonReviewReport = {
    id: options.id ?? globalThis.crypto.randomUUID(),
    createdAt: (options.createdAt ?? new Date()).toISOString(),
    dateKey: context.dateKey,
    title: context.title,
    mainReference: context.mainReference,
    provider,
    model,
    manuscriptFingerprint: await manuscriptFingerprint(context.manuscript),
    criteria: [...context.criteria],
    findings: result.findings.map((finding) => ({ ...finding })),
  }
  if (result.validationNotice) report.validationNotice = result.validationNotice
  if (result.structure) report.structure = result.structure
  return report
}

// Lista de relatórios por data

/** Cada data guarda no máximo os 30 relatórios mais recentes. */
export const MAXIMUM_REPORTS_PER_DATE = 30

function timestamp(report: SermonReviewReport): number {
  const value = Date.parse(report.createdAt)
  return Number.isNaN(value) ? 0 : value
}

/** Ordena do mais antigo para o mais recente, como o armazenamento do app Swift. */
export function sortReports(reports: readonly SermonReviewReport[]): SermonReviewReport[] {
  return [...reports].sort((left, right) => timestamp(left) - timestamp(right))
}

/** Acrescenta um relatório e descarta os mais antigos acima do limite (`save`). */
export function appendReport(
  reports: readonly SermonReviewReport[],
  report: SermonReviewReport,
): SermonReviewReport[] {
  const result = [...reports, report]
  if (result.length > MAXIMUM_REPORTS_PER_DATE) result.splice(0, result.length - MAXIMUM_REPORTS_PER_DATE)
  return result
}

/** Regrava um relatório existente (por exemplo, após marcar apontamentos); se não existir, acrescenta. */
export function replaceReport(
  reports: readonly SermonReviewReport[],
  report: SermonReviewReport,
): SermonReviewReport[] {
  const index = reports.findIndex((candidate) => candidate.id === report.id)
  if (index < 0) return appendReport(reports, report)
  const result = [...reports]
  result[index] = report
  return result
}

/** Marca manualmente um apontamento; devolve o relatório alterado ou o mesmo, se o ID não existir. */
export function setFindingStatus(
  report: SermonReviewReport,
  findingID: string,
  status: SermonReviewFinding['status'],
): SermonReviewReport {
  if (!report.findings.some((finding) => finding.id === findingID)) return report
  return {
    ...report,
    findings: report.findings.map((finding) => (finding.id === findingID ? { ...finding, status } : finding)),
  }
}

// Leitura tolerante de relatórios gravados

const structureSchema = z.object({
  verdict: z.enum(['solid', 'attention', 'fragile']),
  summary: z.string(),
  centralIdea: z.object({
    status: z.enum(['clear', 'diffuse', 'not_found']),
    statement: z.string(),
    quote: z.string(),
    note: z.string(),
  }),
  sections: z.array(
    z.object({
      kind: z.enum(STRUCTURE_SECTION_KINDS),
      assessment: z.enum(['fulfills', 'partial', 'missing']),
      startQuote: z.string(),
      note: z.string(),
    }),
  ),
  movements: z.array(z.object({ label: z.string(), startQuote: z.string() })),
  gospel: z.object({
    status: z.enum(['explicit', 'implicit', 'not_found']),
    quote: z.string(),
    note: z.string(),
  }),
  fourPages: z.array(
    z.object({
      page: z.enum(STRUCTURE_PAGE_KINDS),
      status: z.enum(['present', 'brief', 'not_found']),
      quote: z.string(),
    }),
  ),
})

const optionalString = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined)

/** Relatórios gravados antes da marcação manual não têm `status`; são lidos como abertos. */
const findingSchema = z.object({
  id: z.string(),
  criterion: z.enum(SERMON_REVIEW_CRITERIA),
  severity: z.enum(SERMON_REVIEW_SEVERITIES),
  manuscriptQuote: z.string(),
  observation: z.string(),
  correction: z.string(),
  classification: z.string(),
  evidenceQuote: z.string(),
  evidenceSourceTitle: optionalString,
  evidenceCitation: optionalString,
  status: z
    .enum(SERMON_REVIEW_FINDING_STATUSES)
    .nullish()
    .transform((value) => value ?? 'open'),
})

const reportSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  dateKey: z.string(),
  title: z.string(),
  mainReference: z.string(),
  provider: z.enum(AI_PROVIDERS),
  model: z.string(),
  manuscriptFingerprint: z.string(),
  criteria: z.array(z.enum(SERMON_REVIEW_CRITERIA)),
  findings: z.array(findingSchema),
  validationNotice: optionalString,
  structure: structureSchema.nullish().transform((value) => value ?? undefined),
})

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

/** Lê um relatório gravado; campos ausentes de versões antigas recebem os padrões. */
export function decodeReport(value: unknown): SermonReviewReport {
  const parsed = reportSchema.parse(value)
  return withoutUndefined({
    ...parsed,
    findings: parsed.findings.map((finding) => withoutUndefined(finding) as SermonReviewFinding),
  }) as SermonReviewReport
}

/** Lê a lista gravada de uma data; lança erro se o conteúdo não for uma lista de relatórios. */
export function decodeReports(value: unknown): SermonReviewReport[] {
  return sortReports(z.array(z.unknown()).parse(value).map(decodeReport))
}

// Armazenamento

/** Onde cada plataforma guarda a lista de relatórios de uma data (arquivo, banco, IndexedDB...). */
export interface SermonReviewReportPersistence {
  /** Lista gravada (JSON já decodificado), ou `null`/`undefined` se a data ainda não tem relatórios. */
  load(dateKey: string): Promise<unknown>
  save(dateKey: string, reports: SermonReviewReport[]): Promise<void>
}

/** Regras do `SermonReviewReportStore` sobre uma persistência injetada. */
export class SermonReviewReportStore {
  constructor(private readonly persistence: SermonReviewReportPersistence) {}

  async reports(dateKey: string): Promise<SermonReviewReport[]> {
    const stored = await this.persistence.load(dateKey)
    if (stored === null || stored === undefined) return []
    return decodeReports(stored)
  }

  async save(report: SermonReviewReport): Promise<SermonReviewReport[]> {
    const reports = appendReport(await this.reports(report.dateKey), report)
    await this.persistence.save(report.dateKey, reports)
    return reports
  }

  async update(report: SermonReviewReport): Promise<SermonReviewReport[]> {
    const reports = replaceReport(await this.reports(report.dateKey), report)
    await this.persistence.save(report.dateKey, reports)
    return reports
  }
}

/** Persistência em memória, útil em testes e como cache. */
export class MemorySermonReviewReportPersistence implements SermonReviewReportPersistence {
  readonly data = new Map<string, string>()

  async load(dateKey: string): Promise<unknown> {
    const stored = this.data.get(dateKey)
    return stored === undefined ? undefined : JSON.parse(stored)
  }

  async save(dateKey: string, reports: SermonReviewReport[]): Promise<void> {
    this.data.set(dateKey, JSON.stringify(reports))
  }
}

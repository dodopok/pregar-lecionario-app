import { z } from 'zod'
import { AI_INPUT_LIMITS, aiCriteriaSchema, reviewSourceSchema } from '@pregar/core/plans/contract'

const sources = z
  .array(reviewSourceSchema)
  .max(AI_INPUT_LIMITS.sourcesCount)
  .refine(
    (items) => items.reduce((sum, item) => sum + new TextEncoder().encode(item.text).length, 0) <= AI_INPUT_LIMITS.sourcesTotalBytes,
    { message: 'Os materiais selecionados passam do limite de 120 KB. Desmarque algum para continuar.' },
  )
  .default([])

const manuscript = z
  .string()
  .max(AI_INPUT_LIMITS.manuscriptChars, { message: 'O manuscrito é longo demais para uma revisão.' })
  .refine((value) => value.trim().length > 0, { message: 'O manuscrito está vazio.' })

export const aiReviewRequestSchema = z.object({
  mainReference: z.string().trim().max(200).default(''),
  manuscript,
  criteria: aiCriteriaSchema,
  sources,
})

export const aiQuestionsRequestSchema = z.object({
  mainReference: z.string().trim().max(200).default(''),
  manuscript,
  sources,
})

export const aiResearchRequestSchema = z.object({
  reference: z.string().trim().min(1).max(200),
  occasion: z.string().trim().max(200).optional(),
  dateKey: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  preferredAuthors: z.array(z.string().trim().max(120)).max(30).default([]),
  excludedDomains: z.array(z.string().trim().max(200)).max(50).default([]),
})

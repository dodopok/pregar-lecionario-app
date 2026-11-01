import type { z } from 'zod'
import { validationError } from './errors'

export function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) throw validationError(result.error)
  return result.data
}

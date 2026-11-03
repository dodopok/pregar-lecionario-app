import { z } from 'zod'
import type { MainContext } from '../context'
import { IDEA_MAX_LENGTH } from '../storage/ideas'
import { handle } from './router'

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const source = z.enum(['local', 'drive', 'reading', 'material', 'bible', 'reader'])
const text = z.string().trim().min(1, 'Escreva a ideia antes de guardar.').max(IDEA_MAX_LENGTH)

/** Ideias locais da Mesa: leitura e escrita no banco, com aviso às outras janelas. */
export function registerIdeasHandlers(context: MainContext): void {
  const changed = (origin: number) => context.windows.broadcast('ideas:changed', { origin })

  handle('ideas:list', (request) =>
    context.ideas.list({
      dateKey:
        request?.dateKey === undefined
          ? undefined
          : request.dateKey === null
            ? null
            : dateKey.parse(request.dateKey),
      includeLoose: request?.includeLoose === true,
      includeDone: request?.includeDone === true,
    }),
  )
  handle('ideas:add', (input, event) => {
    const idea = context.ideas.add({
      text: text.parse(input.text),
      dateKey: input.dateKey ? dateKey.parse(input.dateKey) : null,
      reference: input.reference ? z.string().trim().max(200).parse(input.reference) : null,
      source: source.parse(input.source ?? 'local'),
      sourceTitle: input.sourceTitle ? z.string().trim().max(300).parse(input.sourceTitle) : null,
    })
    changed(event.sender.id)
    return idea
  })
  handle('ideas:update', ({ id, patch }, event) => {
    const idea = context.ideas.update(z.string().uuid().parse(id), {
      ...(patch.text !== undefined ? { text: text.parse(patch.text) } : {}),
      ...(patch.dateKey !== undefined
        ? { dateKey: patch.dateKey === null ? null : dateKey.parse(patch.dateKey) }
        : {}),
      ...(patch.reference !== undefined
        ? { reference: patch.reference === null ? null : z.string().trim().max(200).parse(patch.reference) }
        : {}),
      ...(patch.done !== undefined ? { done: z.boolean().parse(patch.done) } : {}),
    })
    changed(event.sender.id)
    return idea
  })
  handle('ideas:delete', ({ id }, event) => {
    context.ideas.delete(z.string().uuid().parse(id))
    changed(event.sender.id)
  })
  handle('ideas:adopt', ({ ids, dateKey: key }, event) => {
    const result = context.ideas.adopt(z.array(z.string().uuid()).max(500).parse(ids), dateKey.parse(key))
    changed(event.sender.id)
    return result
  })
}

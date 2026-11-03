import { describe, expect, it } from 'vitest'
import { aiResearchRequestSchema } from '../src/modules/ai/schemas'

describe('entrada de pesquisa da IA', () => {
  it('aceita clientes antigos com nomes e autores com site cadastrado', () => {
    expect(
      aiResearchRequestSchema.parse({
        reference: 'Marcos 13:24-37',
        preferredAuthors: ['Fleming Rutledge', { name: 'N. T. Wright', referenceURL: 'https://ntwrightpage.com' }],
      }).preferredAuthors,
    ).toEqual(['Fleming Rutledge', { name: 'N. T. Wright', referenceURL: 'https://ntwrightpage.com' }])
  })

  it('não converte ausência de preferências em uma lista vazia', () => {
    expect(aiResearchRequestSchema.parse({ reference: 'Salmo 34:1-10' }).preferredAuthors).toBeUndefined()
  })

  it('só encaminha endereço https para a busca do autor', () => {
    expect(
      aiResearchRequestSchema.safeParse({
        reference: 'Salmo 34:1-10',
        preferredAuthors: [{ name: 'Autor', referenceURL: 'http://example.org/autor' }],
      }).success,
    ).toBe(false)
  })
})

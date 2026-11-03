import { describe, expect, it } from 'vitest'
import {
  detectSermonMetadata,
  findDate,
  findReference,
  isMetadataOnlyLine,
  prepareReferenceText,
  resolveYear,
  titleFromFileName,
  titleFromLine,
} from '../src/import'
import { canonicalReference, locateReferences, parseReference } from '../src/bible/reference'

const now = new Date(2026, 10, 3)

function detect(fileName: string, text = '') {
  return detectSermonMetadata({ fileName, text, now })
}

describe('data no nome do arquivo', () => {
  it('lê ano-mês-dia, dia-mês-ano e o formato compacto', () => {
    expect(detect('2023-11-12 As dez virgens.docx').dateKey).toBe('2023-11-12')
    expect(detect('sermao_12-11-2023.rtf').dateKey).toBe('2023-11-12')
    expect(detect('Pregação 12.11.2023.txt').dateKey).toBe('2023-11-12')
    expect(detect('20231112-sermao.md').dateKey).toBe('2023-11-12')
    expect(detect('2023-11-12 As dez virgens.docx').confidence.date).toBe('filename')
  })

  it('resolve anos de dois dígitos: até o ano que vem é 20xx, depois 19xx', () => {
    expect(detect('culto 12.11.23.docx').dateKey).toBe('2023-11-12')
    expect(detect('culto 12.11.27.docx').dateKey).toBe('2027-11-12')
    expect(detect('culto 12.11.98.docx').dateKey).toBe('1998-11-12')
    expect(resolveYear('05', now)).toBe(2005)
    expect(resolveYear('1987', now)).toBe(1987)
  })

  it('lê meses por extenso e abreviados, com ou sem "de"', () => {
    expect(detect('12 nov 2023.docx').dateKey).toBe('2023-11-12')
    expect(detect('12 de novembro de 2023.docx').dateKey).toBe('2023-11-12')
    expect(detect('Sermão 1º de março de 2024.docx').dateKey).toBe('2024-03-01')
    expect(detect('sermon-12-Nov-23.docx').dateKey).toBe('2023-11-12')
    expect(detect('November 12, 2023 sermon.docx').dateKey).toBe('2023-11-12')
  })

  it('trata dia/mês ambíguo como dia e mês, e só inverte quando não há outra leitura', () => {
    expect(detect('03-04-2022.docx').dateKey).toBe('2022-04-03')
    expect(detect('04-13-2022.docx').dateKey).toBe('2022-04-13')
  })

  it('rejeita datas impossíveis, anos implausíveis e números que não são datas', () => {
    expect(detect('31-02-2023.docx').dateKey).toBeNull()
    expect(detect('12-11-2099.docx').dateKey).toBeNull()
    expect(detect('12-11-1850.docx').dateKey).toBeNull()
    expect(detect('telefone 11999990000.docx').dateKey).toBeNull()
    expect(detect('Mt 25.1-13.docx').dateKey).toBeNull()
    expect(detect('sermao.docx').confidence.date).toBe('none')
  })
})

describe('data nas primeiras linhas', () => {
  it('encontra a data depois do dia da semana e sinaliza a origem', () => {
    const result = detect(
      'sermao.docx',
      'Igreja do Bom Pastor\nDomingo, 12 de novembro de 2023\n\nAs dez virgens',
    )
    expect(result.dateKey).toBe('2023-11-12')
    expect(result.confidence.date).toBe('text')
  })

  it('aceita 12/11/2023 com rótulo e prefere a data do nome do arquivo', () => {
    expect(detect('sermao.docx', 'Data: 12/11/2023').dateKey).toBe('2023-11-12')
    expect(detect('2024-01-07.docx', 'Data: 12/11/2023').dateKey).toBe('2024-01-07')
  })

  it('não procura além das primeiras quinze linhas', () => {
    const lines = Array.from({ length: 16 }, (_, index) => `Parágrafo ${index + 1}`)
    lines.push('Pregado em 12/11/2023')
    expect(detect('sermao.docx', lines.join('\n')).dateKey).toBeNull()
    expect(findDate('Pregado em 12/11/2023', now)).toMatchObject({
      dateKey: '2023-11-12',
      index: 11,
      length: 10,
    })
  })
})

describe('passagem bíblica', () => {
  it('lê nomes e abreviações com dois-pontos, ponto ou vírgula na forma canônica', () => {
    expect(detect('Mateus 25:1-13.docx').reference).toBe('Mateus 25:1-13')
    expect(detect('Mt 25.1-13.docx').reference).toBe('Mateus 25:1-13')
    expect(detect('1 Coríntios 13.docx').reference).toBe('1 Coríntios 13')
    expect(detect('sermao.docx', 'Texto: Jo 3,16').reference).toBe('João 3:16')
    expect(detect('sermao.docx', 'Salmo 23,1-6').reference).toBe('Salmo 23:1-6')
    expect(detect('sermao.docx', 'Texto: Jo 3,16').confidence.reference).toBe('text')
  })

  it('distingue Jó (com acento) de Jo (João) e não mexe nas listas de versículos', () => {
    expect(detect('Jó 3,1-10.docx').reference).toBe('Jó 3:1-10')
    expect(detect('Jo 3.16-21.docx').reference).toBe('João 3:16-21')
    expect(prepareReferenceText('Salmo 34:1-10, 22')).toBe('salmo 34:1-10, 22')
    expect(prepareReferenceText('Jo 3,16')).toBe('jn 3:16')
  })

  it('prefere a passagem do nome do arquivo e devolve nulo quando não há nenhuma', () => {
    const result = detect('Romanos 8.docx', 'Texto: Mateus 25:1-13')
    expect(result.reference).toBe('Romanos 8')
    expect(result.confidence.reference).toBe('filename')
    expect(detect('sermao.docx', 'Um sermão sem passagem').reference).toBeNull()
    expect(findReference('nada aqui')).toBeNull()
  })

  it('formata a forma canônica como as leituras da API', () => {
    expect(canonicalReference(parseReference('Romans 13:8-14')!)).toBe('Romanos 13:8-14')
    expect(canonicalReference(parseReference('Sl 119.33-40')!)).toBe('Salmo 119:33-40')
    expect(canonicalReference(parseReference('João 3:16-4:1')!)).toBe('João 3:16-4:1')
    expect(locateReferences('Texto: Mateus 25:1-13 hoje')).toEqual([
      {
        reference: { book: 'matthew', chapter: 25, startVerse: 1, endChapter: null, endVerse: 13 },
        index: 7,
        length: 14,
      },
    ])
  })
})

describe('título', () => {
  it('usa a primeira linha que não é só data ou passagem', () => {
    const result = detect(
      'sermao.docx',
      'Domingo, 12 de novembro de 2023\nTexto: Mateus 25:1-13\nAs dez virgens\nEra uma vez...',
    )
    expect(result.title).toBe('As dez virgens')
    expect(result.dateKey).toBe('2023-11-12')
    expect(result.reference).toBe('Mateus 25:1-13')
  })

  it('tira data e passagem das pontas da linha, mas conserva as que fazem parte da frase', () => {
    expect(titleFromLine('As dez virgens – Mateus 25:1-13', now)).toBe('As dez virgens')
    expect(titleFromLine('Mateus 25:1-13 - As dez virgens', now)).toBe('As dez virgens')
    expect(titleFromLine('As dez virgens (Mateus 25:1-13)', now)).toBe('As dez virgens')
    expect(titleFromLine('12/11/2023 · As dez virgens', now)).toBe('As dez virgens')
    expect(titleFromLine('O amor de Deus em João 3:16', now)).toBe('O amor de Deus em João 3:16')
    expect(titleFromLine('Título: A graça que basta', now)).toBe('A graça que basta')
    expect(titleFromLine('# A graça que basta', now)).toBe('A graça que basta')
  })

  it('reconhece linhas só de metadados', () => {
    expect(isMetadataOnlyLine('Texto: Mateus 25:1-13', now)).toBe(true)
    expect(isMetadataOnlyLine('Pregação de 12/11/2023', now)).toBe(true)
    expect(isMetadataOnlyLine('Domingo', now)).toBe(true)
    expect(isMetadataOnlyLine('Mateus 25 e a parábola das virgens', now)).toBe(false)
  })

  it('corta títulos longos em 120 caracteres quando o nome do arquivo não ajuda', () => {
    const long = 'Palavra '.repeat(40).trim()
    const title = detect('2023-11-12.docx', long).title
    expect(title.length).toBeLessThanOrEqual(120)
    expect(title.endsWith('…')).toBe(true)
  })

  it('prefere um nome de arquivo com palavras próprias à primeira frase do corpo do texto', () => {
    const body = 'O reino dos céus será semelhante a dez virgens que saíram ao encontro do noivo.'
    expect(detect('2023-11-12 As dez virgens.docx', body).title).toBe('As dez virgens')
    expect(detect('sermao.docx', `As dez virgens\n${body}`).title).toBe('As dez virgens')
    expect(detect('sermao.docx', body).title).toBe('sermao')
    expect(detect('2023-11-12.docx', 'Vigiai, pois.').title).toBe('Vigiai, pois')
  })

  it('cai no nome do arquivo sem extensão, sem a data e com _ e - virando espaços', () => {
    expect(detect('2023-11-12_as_dez_virgens.docx').title).toBe('as dez virgens')
    expect(detect('Mateus 25.1-13 - As dez virgens.docx').title).toBe('As dez virgens')
    expect(detect('2023-11-12.docx').title).toBe('2023 11 12')
    expect(titleFromFileName('sermao-domingo_manha.rtf')).toBe('sermao domingo manha')
    expect(detect('sermao.docx', 'Texto: Mateus 25:1-13\nData: 12/11/2023').title).toBe('sermao')
  })

  it('devolve tudo nulo ou vazio com confiança "none" quando não há dados', () => {
    expect(detect('x.txt', '')).toEqual({
      dateKey: null,
      reference: null,
      title: 'x',
      confidence: { date: 'none', reference: 'none' },
    })
  })
})

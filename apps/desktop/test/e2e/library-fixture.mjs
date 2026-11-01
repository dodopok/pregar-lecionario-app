// Gera PDFs pequenos à mão (sem bibliotecas): páginas de texto com Helvetica, sumário
// (bookmarks), metadados e, opcionalmente, uma página só com imagem para o OCR.
import { deflateSync } from 'node:zlib'

function pdfString(text) {
  if (/^[\x20-\x7e]*$/.test(text)) return `(${text.replace(/[\\()]/g, (char) => `\\${char}`)})`
  // Texto não ASCII: UTF-16BE com BOM, em hexadecimal.
  const units = [0xfeff, ...Array.from(text, (char) => char.charCodeAt(0))]
  return `<${units.map((unit) => unit.toString(16).padStart(4, '0')).join('')}>`
}

/**
 * @param {{
 *   title?: string, author?: string,
 *   pages: ({ lines: { text: string, size?: number, bold?: boolean }[] } | { image: { width: number, height: number, gray: Uint8Array } })[],
 *   outline?: { title: string, page: number, children?: { title: string, page: number }[] }[],
 * }} spec
 * @returns {Buffer}
 */
export function buildPdf(spec) {
  const objects = []
  const add = (body) => {
    objects.push(body)
    return objects.length
  }
  const catalog = add(null)
  const pagesRoot = add(null)
  const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const pageIds = []
  for (const page of spec.pages) {
    let content
    let xobject = ''
    if ('image' in page) {
      const { width, height, gray } = page.image
      const data = deflateSync(Buffer.from(gray))
      const image = add({
        dict: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>`,
        stream: data,
      })
      xobject = ` /XObject << /Im1 ${image} 0 R >>`
      content = `q 612 0 0 ${Math.round((612 * height) / width)} 0 ${792 - Math.round((612 * height) / width)} cm /Im1 Do Q`
    } else {
      let y = 740
      const parts = []
      for (const line of page.lines) {
        const size = line.size ?? 11
        parts.push(`BT /${line.bold ? 'F2' : 'F1'} ${size} Tf 72 ${y} Td ${pdfString(line.text)} Tj ET`)
        y -= Math.round(size * 1.6)
      }
      content = parts.join('\n')
    }
    const stream = Buffer.from(content, 'latin1')
    const contents = add({ dict: `<< /Length ${stream.length} >>`, stream })
    pageIds.push(
      add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >>${xobject} >> /Contents ${contents} 0 R >>`),
    )
  }
  objects[pagesRoot - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`

  let outlinesRef = ''
  if (spec.outline?.length) {
    const outlines = add(null)
    const build = (items, parent) => {
      const ids = items.map(() => add(null))
      items.forEach((item, index) => {
        const children = item.children?.length ? build(item.children, ids[index]) : null
        const fields = [
          `/Title ${pdfString(item.title)}`,
          `/Parent ${parent} 0 R`,
          `/Dest [${pageIds[item.page - 1]} 0 R /XYZ 0 792 0]`,
        ]
        if (index > 0) fields.push(`/Prev ${ids[index - 1]} 0 R`)
        if (index < ids.length - 1) fields.push(`/Next ${ids[index + 1]} 0 R`)
        if (children) fields.push(`/First ${children.first} 0 R /Last ${children.last} 0 R /Count ${children.count}`)
        objects[ids[index] - 1] = `<< ${fields.join(' ')} >>`
      })
      return { first: ids[0], last: ids.at(-1), count: ids.length }
    }
    const top = build(spec.outline, outlines)
    objects[outlines - 1] = `<< /Type /Outlines /First ${top.first} 0 R /Last ${top.last} 0 R /Count ${top.count} >>`
    outlinesRef = ` /Outlines ${outlines} 0 R /PageMode /UseOutlines`
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R${outlinesRef} >>`
  const infoFields = []
  if (spec.title) infoFields.push(`/Title ${pdfString(spec.title)}`)
  if (spec.author) infoFields.push(`/Author ${pdfString(spec.author)}`)
  const info = infoFields.length ? add(`<< ${infoFields.join(' ')} >>`) : null

  const chunks = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')]
  let offset = chunks[0].length
  const offsets = []
  objects.forEach((object, index) => {
    offsets.push(offset)
    const parts =
      typeof object === 'string'
        ? [Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'latin1')]
        : [Buffer.from(`${index + 1} 0 obj\n${object.dict}\nstream\n`, 'latin1'), object.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]
    for (const part of parts) {
      chunks.push(part)
      offset += part.length
    }
  })
  const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n', ...offsets.map((value) => `${String(value).padStart(10, '0')} 00000 n \n`)].join('')
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ''} >>\nstartxref\n${offset}\n%%EOF\n`
  chunks.push(Buffer.from(xref + trailer, 'latin1'))
  return Buffer.concat(chunks)
}

const prose = (label, count = 18) =>
  Array.from({ length: count }, (_, index) => ({ text: `${label} line ${index + 1}: plain commentary prose without any passage heading.` }))

/** Páginas no layout do Wright (Paul for Everyone): título da seção no topo, prosa depois. */
export function wrightPages() {
  return [
    { lines: [{ text: 'PAUL FOR EVERYONE', size: 24, bold: true }, { text: 'ROMANS PART 2', size: 18 }, { text: 'Chapters 9-16', size: 12 }] },
    { lines: [{ text: 'Romans 13:1-7 Submitting to the Authorities', size: 14, bold: true }, ...prose('Authorities')] },
    { lines: [{ text: 'Romans 13:8-14 Love, the Law and the Coming Day', size: 14, bold: true }, ...prose('Love')] },
    { lines: prose('Love continued', 24) },
    { lines: [{ text: 'Romans 14:1-6 Welcoming the Weak', size: 14, bold: true }, ...prose('Welcome')] },
  ]
}

export const WRIGHT_OUTLINE = [
  {
    title: 'Romans 13',
    page: 2,
    children: [
      { title: 'Romans 13:1-7 Submitting to the Authorities', page: 2 },
      { title: 'Romans 13:8-14 Love, the Law and the Coming Day', page: 3 },
    ],
  },
  { title: 'Romans 14:1-6 Welcoming the Weak', page: 5 },
]

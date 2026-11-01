// @vitest-environment node
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openPdfDocument } from '../../src/main/modules/library/pdf-source'

/** PDF mínimo com texto japonês numa fonte CID não embutida e o CMap predefinido UniJIS-UCS2-H. */
function japanesePdf(): Uint8Array {
  const content = 'BT /F1 24 Tf 20 100 Td <65E5672C8A9E> Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /KozMinPr6N-Regular /Encoding /UniJIS-UCS2-H /DescendantFonts [6 0 R] >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /KozMinPr6N-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> /FontDescriptor 7 0 R >>',
    '<< /Type /FontDescriptor /FontName /KozMinPr6N-Regular /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>',
  ]
  let pdf = '%PDF-1.7\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

async function extractText(): Promise<string> {
  const document = await openPdfDocument(japanesePdf())
  try {
    const page = await document.getPage(1)
    const content = await page.getTextContent()
    return content.items.map((item) => ('str' in item ? item.str : '')).join('')
  } finally {
    await document.loadingTask.destroy()
  }
}

const original = process.env.PREGAR_PDFJS_CMAPS
afterEach(() => {
  if (original === undefined) delete process.env.PREGAR_PDFJS_CMAPS
  else process.env.PREGAR_PDFJS_CMAPS = original
})

describe('CMaps do PDF.js no indexador', () => {
  it('extrai texto japonês de fonte não embutida quando os CMaps estão disponíveis', async () => {
    process.env.PREGAR_PDFJS_CMAPS = join(resolve(__dirname, '../../../..'), 'node_modules', 'pdfjs-dist', 'cmaps')
    expect(await extractText()).toBe('日本語')
  })

  it('sem os CMaps o texto não sai (a indexação continua sem quebrar)', async () => {
    delete process.env.PREGAR_PDFJS_CMAPS
    expect(await extractText()).not.toBe('日本語')
  })
})

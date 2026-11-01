/**
 * Recursos binários do PDF.js para o Leitor e a Biblioteca: decodificadores wasm (JBIG2, JPEG 2000,
 * perfis de cor), fontes padrão (PDFs com Helvetica/Times sem fonte embutida) e mapas de caracteres
 * (CMaps de PDFs em chinês, japonês e coreano sem fonte embutida). Tudo vem empacotado pelo Vite e é
 * entregue por esta fábrica; nada é buscado em endereço externo nem carregado como fonte por URL.
 */
const STATIC_ASSETS: Record<string, () => Promise<string>> = {
  'wasmUrl/openjpeg.wasm': () => import('pdfjs-dist/wasm/openjpeg.wasm?url').then((module) => module.default),
  'wasmUrl/jbig2.wasm': () => import('pdfjs-dist/wasm/jbig2.wasm?url').then((module) => module.default),
  'wasmUrl/qcms_bg.wasm': () => import('pdfjs-dist/wasm/qcms_bg.wasm?url').then((module) => module.default),
  'standardFontDataUrl/FoxitDingbats.pfb': () => import('pdfjs-dist/standard_fonts/FoxitDingbats.pfb?url').then((module) => module.default),
  'standardFontDataUrl/FoxitFixed.pfb': () => import('pdfjs-dist/standard_fonts/FoxitFixed.pfb?url').then((module) => module.default),
  'standardFontDataUrl/FoxitFixedBold.pfb': () => import('pdfjs-dist/standard_fonts/FoxitFixedBold.pfb?url').then((module) => module.default),
  'standardFontDataUrl/FoxitFixedBoldItalic.pfb': () => import('pdfjs-dist/standard_fonts/FoxitFixedBoldItalic.pfb?url').then((module) => module.default),
  'standardFontDataUrl/FoxitFixedItalic.pfb': () => import('pdfjs-dist/standard_fonts/FoxitFixedItalic.pfb?url').then((module) => module.default),
  'standardFontDataUrl/FoxitSerif.pfb': () => import('pdfjs-dist/standard_fonts/FoxitSerif.pfb?url').then((module) => module.default),
  'standardFontDataUrl/FoxitSerifBold.pfb': () => import('pdfjs-dist/standard_fonts/FoxitSerifBold.pfb?url').then((module) => module.default),
  'standardFontDataUrl/FoxitSerifBoldItalic.pfb': () => import('pdfjs-dist/standard_fonts/FoxitSerifBoldItalic.pfb?url').then((module) => module.default),
  'standardFontDataUrl/FoxitSerifItalic.pfb': () => import('pdfjs-dist/standard_fonts/FoxitSerifItalic.pfb?url').then((module) => module.default),
  'standardFontDataUrl/FoxitSymbol.pfb': () => import('pdfjs-dist/standard_fonts/FoxitSymbol.pfb?url').then((module) => module.default),
  'standardFontDataUrl/LiberationSans-Bold.ttf': () => import('pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf?url').then((module) => module.default),
  'standardFontDataUrl/LiberationSans-BoldItalic.ttf': () => import('pdfjs-dist/standard_fonts/LiberationSans-BoldItalic.ttf?url').then((module) => module.default),
  'standardFontDataUrl/LiberationSans-Italic.ttf': () => import('pdfjs-dist/standard_fonts/LiberationSans-Italic.ttf?url').then((module) => module.default),
  'standardFontDataUrl/LiberationSans-Regular.ttf': () => import('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf?url').then((module) => module.default),
}

// 169 CMaps (1,7 MB no total): cada um vira um recurso separado, carregado só quando um PDF pede.
const CMAPS = import.meta.glob<string>('../../../../../../node_modules/pdfjs-dist/cmaps/*.bcmap', { query: '?url', import: 'default' })
const CMAP_BY_NAME = new Map(Object.entries(CMAPS).map(([path, load]) => [path.slice(path.lastIndexOf('/') + 1), load]))

/** Nome dos CMaps disponíveis (para testes e diagnóstico). */
export function availableCMaps(): string[] {
  return [...CMAP_BY_NAME.keys()].sort()
}

function loaderFor(kind: string, filename: string): (() => Promise<string>) | undefined {
  if (kind === 'cMapUrl') return CMAP_BY_NAME.get(filename)
  return STATIC_ASSETS[`${kind}/${filename}`]
}

/** `BinaryDataFactory` do PDF.js (usar com `useWorkerFetch: false` e as opções de `pdfjsAssetOptions`). */
export class PregarBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const loader = loaderFor(kind, filename)
    if (!loader) throw new Error(`Recurso do PDF.js indisponível: ${filename}`)
    const response = await fetch(await loader())
    if (!response.ok) throw new Error(`Recurso do PDF.js indisponível: ${filename}`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

/**
 * Opções comuns do `getDocument`. A fábrica ignora os endereços abaixo; o PDF.js só exige que existam
 * para pedir cada tipo de recurso. Sem fontes do sistema: elas seriam carregadas por URL, o que a CSP
 * não permite, e o resultado mudaria de um sistema para outro.
 */
export const pdfjsAssetOptions = {
  BinaryDataFactory: PregarBinaryDataFactory,
  useWorkerFetch: false,
  useSystemFonts: false,
  cMapUrl: 'pregar-pdfjs://cmaps/',
  cMapPacked: true,
  standardFontDataUrl: 'pregar-pdfjs://fonts/',
  wasmUrl: 'pregar-pdfjs://wasm/',
} as const

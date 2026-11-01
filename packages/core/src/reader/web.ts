/** Mensagem do campo de endereço e da folha "Nova aba". */
export const INVALID_WEB_ADDRESS_MESSAGE = 'Informe um endereço http ou https válido.'

/** Esquema em minúsculas ("https"), ou `null` quando o texto não é um URL. */
export function urlScheme(value: string): string | null {
  try {
    return new URL(value).protocol.replace(/:$/, '').toLowerCase()
  } catch {
    return null
  }
}

export function isWebScheme(value: string): boolean {
  const scheme = urlScheme(value)
  return scheme === 'http' || scheme === 'https'
}

/**
 * Endereço digitado no Leitor: sem esquema, assume https; só aceita http(s) com host. Devolve o
 * URL normalizado ou `null` (por exemplo, para `javascript:` e `file://`).
 */
export function readerWebUrl(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = trimmed.includes('://') ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(value)
    const scheme = url.protocol.replace(/:$/, '').toLowerCase()
    if ((scheme !== 'http' && scheme !== 'https') || url.hostname === '') return null
    return url.href
  } catch {
    return null
  }
}

/** Host para o título de uma aba aberta por link, ou o próprio endereço. */
export function urlHost(value: string): string | null {
  try {
    const host = new URL(value).hostname
    return host === '' ? null : host
  } catch {
    return null
  }
}

/** Endereço sem o fragmento (`#...`): mudar só o fragmento não revoga a marcação de revisão. */
export function urlWithoutFragment(value: string): string {
  const index = value.indexOf('#')
  return index < 0 ? value : value.slice(0, index)
}

export interface LinkGesture {
  /** Botão do meio do mouse. */
  middleButton: boolean
  /** ⌘ no macOS (Ctrl nas demais plataformas). */
  commandKey: boolean
  shiftKey: boolean
}

/**
 * Como abrir um link: `null` navega na própria aba; `true` abre nova aba ao fundo; `false` abre
 * nova aba selecionada. Botão do meio e ⌘clique abrem ao fundo; ⇧ seleciona a nova aba; links
 * que pedem nova janela abrem nova aba selecionada.
 */
export function linkOpensNewTab(gesture: LinkGesture, newWindow = false): boolean | null {
  if (gesture.middleButton || gesture.commandKey) return !gesture.shiftKey
  return newWindow ? false : null
}

/** Largura das abas: até 220 pt, encolhendo até 108 pt; depois disso a barra rola. */
export function readerTabWidth(available: number, count: number): number {
  if (count <= 0) return 220
  return Math.min(220, Math.max(108, (available - (count - 1) * 4) / count))
}

/** Numeração impressa da página quando difere da física. */
export function printedPageLabel(label: string | null | undefined, pageNumber: number): string | null {
  if (label === null || label === undefined || label === '' || label === String(pageNumber)) return null
  return label
}

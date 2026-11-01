import { isAbsolute, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Diz se uma URL é uma página do próprio app: um arquivo dentro da pasta da interface compilada
 * ou, em desenvolvimento, a mesma origem do servidor do Vite. Outros arquivos locais (um HTML
 * baixado, por exemplo) nunca contam como app, para não receberem a ponte do preload.
 */
export function makeAppURLCheck(rendererDir: string, devServer?: string): (url: string) => boolean {
  const devOrigin = devServer ? safeOrigin(devServer) : null
  return (url) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    if (parsed.protocol === 'file:') {
      let path: string
      try {
        path = fileURLToPath(parsed)
      } catch {
        return false
      }
      const inside = relative(rendererDir, path)
      return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)
    }
    return devOrigin !== null && parsed.origin === devOrigin
  }
}

function safeOrigin(url: string): string | null {
  try {
    const origin = new URL(url).origin
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

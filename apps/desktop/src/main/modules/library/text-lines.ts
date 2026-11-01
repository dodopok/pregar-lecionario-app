/**
 * Monta as linhas de texto de uma página a partir dos itens da camada de texto do PDF.js.
 * Puro (sem PDF.js), para ser testado: as coordenadas já vêm no espaço do dispositivo
 * (origem no canto superior esquerdo, y na linha de base).
 */

export interface PositionedTextItem {
  str: string
  /** Início do item, na linha de base. */
  x: number
  y: number
  width: number
  /** Altura da fonte no espaço do dispositivo. */
  fontSize: number
  hasEOL?: boolean
}

export interface GroupedTextLine {
  text: string
  x: number
  y: number
  width: number
  height: number
}

interface WorkingLine {
  items: PositionedTextItem[]
  y: number
  fontSize: number
  right: number
  left: number
}

/** Dois itens estão na mesma linha quando as linhas de base diferem menos de metade da fonte. */
function sameBaseline(line: WorkingLine, item: PositionedTextItem): boolean {
  const size = Math.max(1, Math.min(line.fontSize || item.fontSize, item.fontSize || line.fontSize))
  return Math.abs(line.y - item.y) <= Math.max(1, size * 0.5)
}

function joinItems(items: readonly PositionedTextItem[]): string {
  const sorted = [...items].sort((a, b) => a.x - b.x)
  let text = ''
  let previousRight: number | null = null
  for (const item of sorted) {
    if (item.str === '') continue
    if (previousRight !== null && text !== '') {
      const gap = item.x - previousRight
      const threshold = Math.max(0.5, item.fontSize * 0.15)
      if (gap > threshold && !/\s$/u.test(text) && !/^\s/u.test(item.str)) text += ' '
    }
    text += item.str
    previousRight = Math.max(previousRight ?? -Infinity, item.x + item.width)
  }
  return text.replace(/\s+$/u, '')
}

/**
 * Agrupa os itens em linhas. Itens consecutivos com a mesma linha de base formam uma linha
 * (ordenada da esquerda para a direita). Em páginas de uma coluna, as linhas são ordenadas de
 * cima para baixo (cabeçalhos gravados no fim do conteúdo voltam ao topo); quando duas linhas
 * dividem a mesma altura (colunas), mantém-se a ordem do conteúdo, que é a de leitura.
 */
export function groupTextLines(items: readonly PositionedTextItem[]): GroupedTextLine[] {
  const lines: WorkingLine[] = []
  let current: WorkingLine | null = null
  let breakAfter = false
  for (const item of items) {
    const blank = item.str.trim() === ''
    if (blank && !current) {
      breakAfter = breakAfter || Boolean(item.hasEOL)
      continue
    }
    const continues =
      current !== null &&
      !breakAfter &&
      sameBaseline(current, item) &&
      // Voltar muito para a esquerda indica outra coluna ou outra linha na mesma altura.
      item.x >= current.left - Math.max(2, item.fontSize)
    if (continues && current) {
      current.items.push(item)
      current.right = Math.max(current.right, item.x + item.width)
      current.left = Math.min(current.left, item.x)
      if (!blank) current.fontSize = Math.max(current.fontSize, item.fontSize)
    } else if (!blank) {
      current = { items: [item], y: item.y, fontSize: item.fontSize, right: item.x + item.width, left: item.x }
      lines.push(current)
    }
    breakAfter = Boolean(item.hasEOL)
  }

  const built = lines
    .map((line) => ({
      text: joinItems(line.items),
      x: line.left,
      y: line.y,
      width: Math.max(0, line.right - line.left),
      height: line.fontSize,
    }))
    .filter((line) => line.text.trim() !== '')

  if (!sharesBaselines(built)) {
    // Ordenação estável de cima para baixo.
    return built
      .map((line, index) => ({ line, index }))
      .sort((a, b) => a.line.y - b.line.y || a.index - b.index)
      .map(({ line }) => line)
  }
  return built
}

/** Há linhas distintas na mesma altura (página com colunas ou tabela)? */
function sharesBaselines(lines: readonly GroupedTextLine[]): boolean {
  const sorted = [...lines].sort((a, b) => a.y - b.y)
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!
    const line = sorted[index]!
    const tolerance = Math.max(1, Math.min(previous.height, line.height) * 0.5)
    if (Math.abs(line.y - previous.y) <= tolerance) {
      const overlaps = line.x < previous.x + previous.width && previous.x < line.x + line.width
      if (!overlaps) return true
    }
  }
  return false
}

/** Texto da página: linhas unidas por quebra; `null` quando não há texto selecionável. */
export function pageTextFromItems(items: readonly PositionedTextItem[]): { text: string; lines: GroupedTextLine[] } | null {
  const lines = groupTextLines(items)
  if (lines.length === 0) return null
  return { text: lines.map((line) => line.text).join('\n'), lines }
}

/**
 * Anotação: nota particular do pregador dentro do manuscrito ("olhar para a Ana", "pausa aqui").
 * Fica gravada no JSON e aparece no editor como um aparte discreto, mas não faz parte do texto
 * falado: exportações, texto da revisão e contagem de palavras a ignoram (ver richDocument.ts).
 */
import { mergeAttributes, Node, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode, NodeRange, NodeType, ResolvedPos } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { findWrapping, liftTarget } from '@tiptap/pm/transform'
import { selectedTextblocks } from './commands'

export interface AnnotationOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    annotation: {
      /**
       * Envolve numa anotação os blocos da seleção: parágrafos, títulos (que viram parágrafos) e
       * anotações já existentes (que se fundem na nova). Falha dentro de listas e de anotações.
       */
      setAnnotation: () => ReturnType
      /** Devolve ao corpo os parágrafos da seleção que estão em anotações; um trecho parcial divide a anotação. */
      unsetAnnotation: () => ReturnType
      /** ⇧⌘A: desfaz a anotação quando toda a seleção já está anotada; senão, anota a seleção. */
      toggleAnnotation: () => ReturnType
    }
  }
}

/** Verdadeiro quando a posição está dentro de uma anotação. */
function insideAnnotation(doc: ProseMirrorNode, pos: number): boolean {
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth -= 1)
    if ($pos.node(depth).type.name === 'annotation') return true
  return false
}

/** O bloco do cursor é filho direto de uma anotação. */
function inAnnotationBlock($from: ResolvedPos, type: NodeType): boolean {
  return $from.depth >= 2 && $from.node(-1).type === type
}

/** Posições das anotações tocadas pelo intervalo, na ordem do documento. */
function annotationsBetween(doc: ProseMirrorNode, from: number, to: number, type: NodeType): number[] {
  const positions: number[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type !== type) return true
    positions.push(pos)
    return false
  })
  return positions
}

/** Tira da anotação os blocos do intervalo; um trecho parcial divide a anotação. */
function liftAnnotations(tr: Transaction, from: number, to: number, type: NodeType): boolean {
  let lifted = false
  // De trás para a frente, para as posições anteriores continuarem válidas.
  for (const pos of annotationsBetween(tr.doc, from, to, type).reverse()) {
    const node = tr.doc.nodeAt(pos)
    if (!node) continue
    const innerFrom = Math.max(from, pos + 1)
    const innerTo = Math.min(to, pos + node.nodeSize - 1)
    const range = tr.doc
      .resolve(innerFrom)
      .blockRange(tr.doc.resolve(innerTo), (parent) => parent.type === type)
    const target = range ? liftTarget(range) : null
    if (!range || target === null) continue
    tr.lift(range, target)
    lifted = true
  }
  return lifted
}

interface WrapPlan {
  range: NodeRange
  /** Blocos do intervalo que mudam antes de envolver: título vira parágrafo; anotação cede os seus. */
  changes: Array<{ pos: number; node: ProseMirrorNode }>
}

/**
 * Prepara o envolvimento dos blocos da seleção numa anotação, ou null quando o esquema não
 * permite (dentro de lista ou de anotação, ou com blocos que não são parágrafos nem títulos).
 * Toda a validação acontece aqui, antes de qualquer mudança na transação.
 */
function planWrap(state: EditorState, type: NodeType): WrapPlan | null {
  const paragraph = state.schema.nodes.paragraph
  const { $from, $to } = state.selection
  const range = $from.blockRange($to)
  if (!paragraph || !range || !range.parent.canReplaceWith(range.startIndex, range.endIndex, type))
    return null
  const changes: WrapPlan['changes'] = []
  let pos = range.start
  for (let index = range.startIndex; index < range.endIndex; index += 1) {
    const node = range.parent.child(index)
    if (node.type.name === 'heading' || node.type === type) changes.push({ pos, node })
    else if (node.type !== paragraph) return null
    pos += node.nodeSize
  }
  return { range, changes }
}

/** Aplica o plano: converte títulos, desfaz anotações internas e envolve o intervalo. */
function wrapInAnnotation(tr: Transaction, plan: WrapPlan, type: NodeType): boolean {
  const paragraph = tr.doc.type.schema.nodes.paragraph
  if (!paragraph) return false
  let end = plan.range.end
  for (const { pos, node } of [...plan.changes].reverse()) {
    if (node.type === type) {
      const inner = tr.doc.resolve(pos + 1).blockRange(tr.doc.resolve(pos + node.nodeSize - 1))
      const target = inner ? liftTarget(inner) : null
      if (!inner || target === null) return false
      tr.lift(inner, target)
      // Sem o invólucro, o intervalo encolhe duas posições.
      end -= 2
    } else {
      // Como "Texto normal": conserva id e alinhamento, descarta o resto do estilo do título.
      tr.setNodeMarkup(pos, paragraph, { id: node.attrs.id ?? null, textAlign: node.attrs.textAlign ?? null })
    }
  }
  const range = tr.doc.resolve(plan.range.start).blockRange(tr.doc.resolve(end))
  const wrapping = range ? findWrapping(range, type) : null
  if (!range || !wrapping) return false
  tr.wrap(range, wrapping)
  return true
}

/** Tira do invólucro o bloco do cursor (divide a anotação quando o bloco está no meio). */
function liftBlock(editor: Editor, $from: ResolvedPos): boolean {
  return editor.commands.command(({ tr, dispatch }) => {
    const range = $from.blockRange()
    const target = range ? liftTarget(range) : null
    if (!range || target === null) return false
    if (dispatch) tr.lift(range, target).scrollIntoView()
    return true
  })
}

export const Annotation = Node.create<AnnotationOptions>({
  name: 'annotation',
  group: 'block',
  content: 'paragraph+',
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} }
  },

  parseHTML() {
    return [{ tag: 'aside[data-annotation]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'aside',
      mergeAttributes(
        { 'data-annotation': '', class: 'manuscript-annotation' },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      0,
    ]
  },

  addCommands() {
    return {
      setAnnotation:
        () =>
        ({ state, tr, dispatch }) => {
          const plan = planWrap(state, this.type)
          if (!plan) return false
          if (!dispatch) return true
          if (!wrapInAnnotation(tr, plan, this.type)) return false
          tr.scrollIntoView()
          return true
        },

      unsetAnnotation:
        () =>
        ({ state, tr, dispatch }) => {
          const { from, to } = state.selection
          if (!annotationsBetween(state.doc, from, to, this.type).length) return false
          if (dispatch) {
            if (!liftAnnotations(tr, from, to, this.type)) return false
            tr.scrollIntoView()
          }
          return true
        },

      toggleAnnotation:
        () =>
        ({ state, commands }) => {
          const blocks = selectedTextblocks(state)
          if (!blocks.length) return false
          const annotated = blocks.every(({ pos }) => insideAnnotation(state.doc, pos))
          return annotated ? commands.unsetAnnotation() : commands.setAnnotation()
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-a': () => this.editor.commands.toggleAnnotation(),

      // Return numa linha vazia tira a linha da anotação (na última, sai dela), como na citação.
      Enter: () => {
        const { selection } = this.editor.state
        const { $from } = selection
        if (!selection.empty || $from.parent.content.size > 0 || !inAnnotationBlock($from, this.type))
          return false
        return liftBlock(this.editor, $from)
      },

      // Backspace no início do primeiro parágrafo devolve-o ao corpo, em vez de o juntar ao bloco anterior.
      Backspace: () => {
        const { selection } = this.editor.state
        const { $from } = selection
        if (!selection.empty || $from.parentOffset !== 0 || !inAnnotationBlock($from, this.type)) return false
        if ($from.index(-1) !== 0) return false
        return liftBlock(this.editor, $from)
      },
    }
  },
})

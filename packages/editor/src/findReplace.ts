/**
 * Localizar e substituir: um plugin pequeno que guarda o termo, calcula as ocorrências por
 * parágrafo e as destaca com decorações. Os comandos navegam e substituem preservando as marcas.
 */
import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface FindMatch {
  from: number
  to: number
}

export interface FindState {
  query: string
  matchCase: boolean
  matches: FindMatch[]
  /** Índice da ocorrência atual, ou -1. */
  current: number
  decorations: DecorationSet
}

interface FindMeta {
  query?: string
  matchCase?: boolean
  current?: number
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findReplace: {
      /** Define o termo procurado (vazio limpa) e seleciona a primeira ocorrência após o cursor. */
      setFindQuery: (query: string, options?: { matchCase?: boolean }) => ReturnType
      clearFind: () => ReturnType
      findNext: () => ReturnType
      findPrevious: () => ReturnType
      /** Substitui a ocorrência atual e avança para a próxima. */
      replaceMatch: (replacement: string) => ReturnType
      /** Substitui todas as ocorrências numa única transação (um desfazer). */
      replaceAllMatches: (replacement: string) => ReturnType
    }
  }
}

export const findReplacePluginKey = new PluginKey<FindState>('manuscriptFindReplace')

function foldCase(value: string): string {
  let result = ''
  for (const character of value) {
    const lower = character.toLocaleLowerCase('pt-BR')
    result += lower.length === character.length ? lower : character
  }
  return result
}

/** Ocorrências do termo, sem atravessar parágrafos, quebras ou notas. */
export function findMatches(doc: ProseMirrorNode, query: string, matchCase = false): FindMatch[] {
  if (!query) return []
  const needle = matchCase ? query : foldCase(query)
  const matches: FindMatch[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    node.forEach((child) => {
      text += child.isText ? (child.text ?? '') : '￼'.repeat(child.nodeSize)
    })
    const haystack = matchCase ? text : foldCase(text)
    let index = haystack.indexOf(needle)
    while (index >= 0) {
      matches.push({ from: pos + 1 + index, to: pos + 1 + index + needle.length })
      index = haystack.indexOf(needle, index + needle.length)
    }
    return false
  })
  return matches
}

function decorate(doc: ProseMirrorNode, matches: FindMatch[], current: number): DecorationSet {
  if (!matches.length) return DecorationSet.empty
  return DecorationSet.create(
    doc,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class: index === current ? 'manuscript-find-match manuscript-find-current' : 'manuscript-find-match',
      }),
    ),
  )
}

function emptyState(): FindState {
  return { query: '', matchCase: false, matches: [], current: -1, decorations: DecorationSet.empty }
}

/** Primeira ocorrência que começa no ponto indicado ou depois dele, com volta ao início. */
function indexAtOrAfter(matches: FindMatch[], pos: number): number {
  if (!matches.length) return -1
  const index = matches.findIndex((match) => match.from >= pos)
  return index >= 0 ? index : 0
}

export function getFindState(state: EditorState): FindState {
  return findReplacePluginKey.getState(state) ?? emptyState()
}

export const FindReplace = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findReplacePluginKey,
        state: {
          init: emptyState,
          apply(tr, previous) {
            const meta = tr.getMeta(findReplacePluginKey) as FindMeta | undefined
            if (!meta && !tr.docChanged) return previous
            const query = meta?.query ?? previous.query
            const matchCase = meta?.matchCase ?? previous.matchCase
            if (!query) return emptyState()
            const matches = findMatches(tr.doc, query, matchCase)
            let current: number
            if (meta?.current !== undefined) {
              current = matches.length ? ((meta.current % matches.length) + matches.length) % matches.length : -1
            } else if (meta?.query !== undefined) {
              current = indexAtOrAfter(matches, tr.selection.from)
            } else {
              const previousMatch = previous.matches[previous.current]
              current = previousMatch ? indexAtOrAfter(matches, tr.mapping.map(previousMatch.from)) : matches.length ? 0 : -1
            }
            return { query, matchCase, matches, current, decorations: decorate(tr.doc, matches, current) }
          },
        },
        props: {
          decorations: (state) => findReplacePluginKey.getState(state)?.decorations ?? DecorationSet.empty,
        },
      }),
    ]
  },

  addCommands() {
    const select = (tr: import('@tiptap/pm/state').Transaction, match: FindMatch | undefined) => {
      if (match) tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).scrollIntoView()
    }
    return {
      setFindQuery:
        (query, options = {}) =>
        ({ state, tr, dispatch }) => {
          if (!dispatch) return true
          const matchCase = options.matchCase ?? getFindState(state).matchCase
          const matches = findMatches(state.doc, query, matchCase)
          const current = indexAtOrAfter(matches, state.selection.from)
          tr.setMeta(findReplacePluginKey, { query, matchCase, current } satisfies FindMeta)
          select(tr, matches[current])
          return true
        },
      clearFind:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(findReplacePluginKey, { query: '' } satisfies FindMeta)
          return true
        },
      findNext:
        () =>
        ({ state, tr, dispatch }) => {
          const find = getFindState(state)
          if (!find.matches.length) return false
          const current = (find.current + 1) % find.matches.length
          if (dispatch) {
            tr.setMeta(findReplacePluginKey, { current } satisfies FindMeta)
            select(tr, find.matches[current])
          }
          return true
        },
      findPrevious:
        () =>
        ({ state, tr, dispatch }) => {
          const find = getFindState(state)
          if (!find.matches.length) return false
          const current = (find.current - 1 + find.matches.length) % find.matches.length
          if (dispatch) {
            tr.setMeta(findReplacePluginKey, { current } satisfies FindMeta)
            select(tr, find.matches[current])
          }
          return true
        },
      replaceMatch:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const find = getFindState(state)
          const match = find.matches[find.current]
          if (!match) return false
          if (dispatch) {
            if (replacement) tr.insertText(replacement, match.from, match.to)
            else tr.delete(match.from, match.to)
            const after = tr.mapping.map(match.to)
            const matches = findMatches(tr.doc, find.query, find.matchCase)
            const current = indexAtOrAfter(matches, after)
            tr.setMeta(findReplacePluginKey, { current } satisfies FindMeta)
            select(tr, matches[current])
          }
          return true
        },
      replaceAllMatches:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const find = getFindState(state)
          if (!find.matches.length) return false
          if (dispatch) {
            for (const match of [...find.matches].reverse()) {
              if (replacement) tr.insertText(replacement, match.from, match.to)
              else tr.delete(match.from, match.to)
            }
          }
          return true
        },
    }
  },
})

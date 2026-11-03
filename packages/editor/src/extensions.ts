/**
 * Lista de extensões TipTap do manuscrito. O componente Vue monta o editor com
 * `new Editor({ extensions: createManuscriptExtensions({...}) })`.
 */
import { getSchema, type AnyExtension, type JSONContent } from '@tiptap/core'
import { Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model'
import { Highlight } from '@tiptap/extension-highlight'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { TextAlign } from '@tiptap/extension-text-align'
import { BackgroundColor, Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import { CharacterCount, Placeholder } from '@tiptap/extensions'
import { StarterKit } from '@tiptap/starter-kit'
import { countWords } from '@pregar/core/util/text'
import { Annotation } from './annotation'
import { BlockId } from './blockId'
import { ManuscriptBlockquote } from './blockquote'
import { ManuscriptClipboard } from './clipboard'
import { ManuscriptCommands } from './commands'
import { FindReplace } from './findReplace'
import { Footnote } from './footnote'
import { ManuscriptKeymap, type ManuscriptShortcutHandler } from './keymap'
import { ParagraphFormat } from './paragraphFormat'
import { DEFAULT_PLACEHOLDER } from './styles'
import { defaultIdGenerator, isSafeLinkHref, type IdGenerator } from './util'

export interface ManuscriptExtensionOptions {
  /** Texto exibido no documento vazio; false desativa. */
  placeholder?: string | false
  /** Limite de caracteres (null = sem limite); false remove a contagem. */
  characterLimit?: number | null | false
  /** Ações de interface dos atalhos (link, localizar, salvar, imprimir, zoom...). */
  onShortcut?: ManuscriptShortcutHandler
  /** Gerador de ids de bloco e de nota (determinístico nos testes). */
  generateId?: IdGenerator
  /** Copiar/colar com HTML de estilos inline e slice embutido (padrão: true). */
  richClipboard?: boolean
  /** Mantém sempre um parágrafo vazio no fim do documento (padrão: false, como o Swift). */
  trailingNode?: boolean
  /** Passos de desfazer guardados (padrão do TipTap: 100). */
  undoDepth?: number
}

/** Protocolos aceitos em links: nada executável. */
export const LINK_PROTOCOLS = ['http', 'https', 'mailto', 'tel']

export function createManuscriptExtensions(options: ManuscriptExtensionOptions = {}): AnyExtension[] {
  const generateId = options.generateId ?? defaultIdGenerator
  const extensions: AnyExtension[] = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      // A citação do manuscrito (blockquote.ts) acrescenta o atributo kind: prosa ou poema.
      blockquote: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      trailingNode: options.trailingNode ? {} : false,
      undoRedo: options.undoDepth ? { depth: options.undoDepth } : {},
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        // Esquemas http/https/mailto/tel já são nativos do linkify; o filtro é isAllowedUri.
        protocols: [],
        defaultProtocol: 'https',
        isAllowedUri: (url) => isSafeLinkHref(url),
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
      },
    }),
    ManuscriptBlockquote,
    TextStyle,
    Color,
    BackgroundColor,
    FontFamily,
    FontSize,
    // ⇧⌘H é "Localizar e substituir" no Docs; o realce fica sem atalho.
    Highlight.extend({ addKeyboardShortcuts: () => ({}) }).configure({ multicolor: true }),
    TextAlign.configure({
      types: ['heading', 'paragraph'],
      alignments: ['left', 'center', 'right', 'justify'],
      defaultAlignment: null,
    }),
    Superscript.extend({ excludes: 'subscript' }),
    Subscript.extend({ excludes: 'superscript' }),
    TaskList,
    TaskItem.configure({ nested: true }),
    ParagraphFormat,
    BlockId.configure({ generateId }),
    Footnote.configure({ generateId }),
    Annotation,
    FindReplace,
    ManuscriptCommands,
    ManuscriptKeymap.configure({ onShortcut: options.onShortcut ?? null, generateId }),
  ]
  if (options.richClipboard !== false) extensions.push(ManuscriptClipboard)
  if (options.characterLimit !== false) {
    extensions.push(
      CharacterCount.configure({ limit: options.characterLimit ?? null, wordCounter: countWords }),
    )
  }
  if (options.placeholder !== false) {
    extensions.push(Placeholder.configure({ placeholder: options.placeholder ?? DEFAULT_PLACEHOLDER }))
  }
  return extensions
}

let cachedSchema: Schema | null = null

/** Esquema do manuscrito, para validar ou converter JSON sem montar um editor. */
export function manuscriptSchema(): Schema {
  cachedSchema ??= getSchema(createManuscriptExtensions())
  return cachedSchema
}

/** Lê o JSON no esquema do manuscrito; lança erro se for inválido. */
export function parseManuscriptJSON(json: JSONContent): ProseMirrorNode {
  const node = ProseMirrorNode.fromJSON(manuscriptSchema(), json)
  node.check()
  return node
}

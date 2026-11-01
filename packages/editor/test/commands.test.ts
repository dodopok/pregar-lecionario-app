import { afterEach, describe, expect, it } from 'vitest'
import type { Editor } from '@tiptap/core'
import { linkEditingState, manuscriptPlainText, toRichDocument } from '../src'
import { compact, createEditor, findText, press, selectText } from './helpers'

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function rich(current: Editor) {
  return toRichDocument(current.getJSON())
}

describe('formatação de caracteres (porta de DocumentEditorTests)', () => {
  it('desfazer e refazer preservam texto e estilos; sublinhado, tachado e link chegam ao modelo', () => {
    editor = createEditor('<p>Texto confiável.</p>')
    editor.commands.selectAll()
    editor.commands.toggleUnderline()
    expect(editor.isActive('underline')).toBe(true)
    editor.commands.undo()
    expect(editor.isActive('underline')).toBe(false)
    expect(editor.getText()).toBe('Texto confiável.')
    editor.commands.redo()
    expect(editor.isActive('underline')).toBe(true)
    editor.commands.toggleStrike()
    expect(editor.commands.applyLink({ href: 'https://example.org/reference' })).toBe(true)
    const runs = rich(editor).paragraphs[0]?.runs ?? []
    expect(runs.some((run) => run.underline && run.strike && run.link === 'https://example.org/reference')).toBe(true)
  })

  it('tamanho de fonte fracionário, espaçamento personalizado e entrelinha mantêm os valores', () => {
    editor = createEditor('<p>Um parágrafo.</p>')
    editor.commands.selectAll()
    expect(editor.commands.setFontSizePt(12.5)).toBe(true)
    editor.commands.setParagraphSpacing({ before: 6, after: 8 })
    editor.commands.setParagraphSpacing({ after: 12 })
    editor.commands.setLineSpacing(1.3)
    const paragraph = rich(editor).paragraphs[0]
    expect(paragraph?.runs[0]?.fontSizePt).toBe(12.5)
    expect(paragraph?.spaceBeforePt).toBe(6)
    expect(paragraph?.spaceAfterPt).toBe(12)
    expect(paragraph?.lineHeight).toBe(1.3)
    expect(editor.getHTML()).toContain('font-size: 12.5pt')
  })

  it('limita tamanho, entrelinha e espaçamento como o Swift', () => {
    editor = createEditor('<p>Texto</p>')
    editor.commands.selectAll()
    expect(editor.commands.setLineSpacing(0.2)).toBe(false)
    expect(editor.commands.setLineSpacing(Number.NaN)).toBe(false)
    expect(editor.commands.setFontSizePt(Number.POSITIVE_INFINITY)).toBe(false)
    editor.commands.setFontSizePt(900)
    editor.commands.setParagraphSpacing({ before: -5, after: 1000 })
    const paragraph = rich(editor).paragraphs[0]
    expect(paragraph?.runs[0]?.fontSizePt).toBe(400)
    expect(paragraph?.spaceBeforePt).toBe(0)
    expect(paragraph?.spaceAfterPt).toBe(400)
  })

  it('aumenta e diminui a fonte a partir do tamanho atual (⇧⌘. e ⇧⌘,)', () => {
    editor = createEditor('<p>Texto</p>')
    editor.commands.selectAll()
    expect(press(editor, 'Mod-Shift-.')).toBe(true)
    expect(rich(editor).paragraphs[0]?.runs[0]?.fontSizePt).toBe(12)
    press(editor, 'Mod-Shift-,')
    press(editor, 'Mod-Shift-,')
    expect(rich(editor).paragraphs[0]?.runs[0]?.fontSizePt).toBe(10)
  })

  it('cores de texto e realce viram cores #rrggbb no modelo e podem ser removidas', () => {
    editor = createEditor('<p>Uma palavra forte.</p>')
    selectText(editor, 'forte')
    editor.commands.setTextColor('rgb(18, 52, 86)')
    editor.commands.setHighlightColor('#ffff00')
    let run = rich(editor).paragraphs[0]?.runs.find((candidate) => candidate.text === 'forte')
    expect(run?.color).toBe('#123456')
    expect(run?.highlight).toBe('#ffff00')
    editor.commands.setTextColor(null)
    editor.commands.setHighlightColor(null)
    run = rich(editor).paragraphs[0]?.runs.find((candidate) => candidate.text.includes('forte'))
    expect(run?.color).toBeUndefined()
    expect(run?.highlight).toBeUndefined()
  })

  it('sobrescrito e subscrito se excluem (⌘. e ⌘,)', () => {
    editor = createEditor('<p>H2O</p>')
    editor.commands.setTextSelection({ from: 2, to: 3 })
    expect(press(editor, 'Mod-.')).toBe(true)
    expect(editor.isActive('superscript')).toBe(true)
    press(editor, 'Mod-,')
    expect(editor.isActive('subscript')).toBe(true)
    expect(editor.isActive('superscript')).toBe(false)
  })
})

describe('links', () => {
  it('insere, edita e remove o link só com o cursor dentro (porta de DocumentEditorTests)', () => {
    editor = createEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Referência: ' }] }] })
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.applyLink({ href: 'https://example.org/one', text: 'Fonte' })
    expect(editor.getText()).toBe('Referência: Fonte')
    const range = findText(editor, 'Fonte')
    editor.commands.setTextSelection(range.from + 2)
    expect(linkEditingState(editor.state)).toEqual({ text: 'Fonte', href: 'https://example.org/one' })
    editor.commands.applyLink({ href: 'https://example.org/two', text: 'Fonte' })
    expect(rich(editor).paragraphs[0]?.runs.some((run) => run.link === 'https://example.org/two')).toBe(true)
    expect(rich(editor).paragraphs[0]?.runs.some((run) => run.link === 'https://example.org/one')).toBe(false)
    editor.commands.setTextSelection(range.from + 2)
    editor.commands.applyLink({ href: null })
    expect(rich(editor).paragraphs[0]?.runs.some((run) => run.link)).toBe(false)
    expect(editor.getText()).toBe('Referência: Fonte')
  })

  it('substitui o texto exibido quando ele muda e recusa esquemas executáveis', () => {
    editor = createEditor('<p>Veja aqui.</p>')
    selectText(editor, 'aqui')
    expect(editor.commands.applyLink({ href: 'javascript:alert(1)' })).toBe(false)
    expect(editor.commands.setLink({ href: 'javascript:alert(1)' })).toBe(false)
    expect(editor.commands.applyLink({ href: 'mailto:pastor@example.org', text: 'o pastor' })).toBe(true)
    expect(editor.getText()).toBe('Veja o pastor.')
    expect(rich(editor).paragraphs[0]?.runs.find((run) => run.link)?.text).toBe('o pastor')
  })
})

describe('estilos de parágrafo', () => {
  it('título, alinhamento, entrelinha e espaçamento sobrevivem no modelo (porta de DocumentEditorTests)', () => {
    editor = createEditor('<p>Um título</p><p>Texto do documento.</p>')
    selectText(editor, 'Um título')
    editor.commands.setParagraphStyle('heading2')
    editor.commands.setTextAlign('center')
    editor.commands.setLineSpacing(1.5)
    editor.commands.setParagraphSpacing({ before: 6, after: 8 })
    const [heading, body] = rich(editor).paragraphs
    expect(heading).toMatchObject({ headingLevel: 2, alignment: 'center', lineHeight: 1.5, spaceBeforePt: 6, spaceAfterPt: 8 })
    expect(body?.headingLevel).toBe(0)
    expect(body?.alignment).toBeUndefined()
  })

  it('um título escolhido antes de digitar conserva o estilo', () => {
    editor = createEditor('')
    editor.commands.setParagraphStyle('heading1')
    editor.commands.insertContent('Um título novo')
    const paragraph = rich(editor).paragraphs[0]
    expect(paragraph?.headingLevel).toBe(1)
    expect(manuscriptPlainText(editor.getJSON())).toBe('Um título novo')
  })

  it('títulos guardam formatação independente por parágrafo e Unicode; negrito no corpo não é título', () => {
    editor = createEditor('<p>😀 Primeiro</p><p>Segundo</p><p><strong>Corpo em negrito.</strong></p>')
    editor.commands.setTextSelection({ from: 1, to: findText(editor, 'Segundo').to })
    editor.commands.setParagraphStyle('heading1')
    editor.commands.setTextSelection(2)
    editor.commands.setTextAlign('center')
    selectText(editor, 'Segundo')
    editor.commands.setTextAlign('left')
    const paragraphs = rich(editor).paragraphs
    expect(paragraphs.map((paragraph) => paragraph.headingLevel)).toEqual([1, 1, 0])
    expect(paragraphs.map((paragraph) => paragraph.alignment)).toEqual(['center', 'left', undefined])
    expect(paragraphs[0]?.runs[0]?.text).toBe('😀 Primeiro')
  })

  it('aplicar um estilo remove tamanho, cor e realce do texto, como o Swift', () => {
    editor = createEditor('<p><span style="font-size: 18pt; color: #ff0000">Grande</span> <mark data-color="#ffff00">realce</mark> <em>itálico</em></p>')
    editor.commands.setTextSelection(2)
    editor.commands.setParagraphStyle('heading3')
    const runs = rich(editor).paragraphs[0]?.runs ?? []
    expect(runs.some((run) => run.fontSizePt || run.color || run.highlight)).toBe(false)
    expect(runs.some((run) => run.italic)).toBe(true)
  })

  it('toggleHeading alterna o parágrafo: aplicar de novo volta ao corpo, em todos os selecionados', () => {
    editor = createEditor('<p>Um</p><p>Dois</p>')
    editor.commands.selectAll()
    editor.commands.toggleHeading({ level: 2 })
    expect(rich(editor).paragraphs.map((paragraph) => paragraph.headingLevel)).toEqual([2, 2])
    editor.commands.toggleHeading({ level: 2 })
    expect(rich(editor).paragraphs.map((paragraph) => paragraph.headingLevel)).toEqual([0, 0])
    const ids = rich(editor).paragraphs.map((paragraph) => paragraph.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('atalhos do Docs formatam o documento com o editor em foco (⇧⌘E, ⌥⌘1, ⌥⌘0)', () => {
    editor = createEditor('<p>Um parágrafo.</p>')
    expect(press(editor, 'Mod-Shift-e')).toBe(true)
    expect(rich(editor).paragraphs[0]?.alignment).toBe('center')
    expect(press(editor, 'Mod-Alt-1')).toBe(true)
    expect(rich(editor).paragraphs[0]?.headingLevel).toBe(1)
    press(editor, 'Mod-Alt-1')
    expect(rich(editor).paragraphs[0]?.headingLevel).toBe(1)
    press(editor, 'Mod-Alt-0')
    expect(rich(editor).paragraphs[0]?.headingLevel).toBe(0)
    expect(press(editor, 'Mod-Shift-x')).toBe(true)
    expect(editor.isActive('strike') || editor.state.storedMarks?.some((mark) => mark.type.name === 'strike')).toBe(true)
  })
})

describe('citação em bloco', () => {
  it('alterna a citação em todos os parágrafos selecionados e remove de novo', () => {
    editor = createEditor('<p>Antes</p><p>Uma frase citada.</p><p>Outra frase.</p><p>Depois</p>')
    editor.commands.setTextSelection({ from: findText(editor, 'Uma').from, to: findText(editor, 'Outra').to })
    editor.commands.toggleQuote()
    expect(compact(editor.getJSON()).content?.map((node) => node.type)).toEqual(['paragraph', 'blockquote', 'paragraph'])
    expect(rich(editor).paragraphs.map((paragraph) => paragraph.quote === true)).toEqual([false, true, true, false])
    expect(manuscriptPlainText(editor.getJSON())).toBe('Antes\nUma frase citada.\nOutra frase.\nDepois')
    editor.commands.toggleQuote()
    expect(rich(editor).paragraphs.every((paragraph) => !paragraph.quote)).toBe(true)
  })

  it('seleção mista vira uma só citação; citação vizinha é unida', () => {
    editor = createEditor('<blockquote><p>Citado</p></blockquote><p>Solto</p>')
    selectText(editor, 'Solto')
    editor.commands.toggleQuote()
    expect(compact(editor.getJSON()).content?.map((node) => node.type)).toEqual(['blockquote'])
    editor.commands.setTextSelection({ from: 2, to: findText(editor, 'Solto').to })
    editor.commands.toggleQuote()
    expect(rich(editor).paragraphs.every((paragraph) => !paragraph.quote)).toBe(true)
  })

  it('tirar um parágrafo do meio divide a citação', () => {
    editor = createEditor('<blockquote><p>Um</p><p>Dois</p><p>Três</p></blockquote>')
    selectText(editor, 'Dois')
    editor.commands.toggleQuote()
    expect(compact(editor.getJSON()).content?.map((node) => node.type)).toEqual(['blockquote', 'paragraph', 'blockquote'])
  })

  it('num parágrafo vazio prepara a citação do que for digitado', () => {
    editor = createEditor('<p>Texto</p><p></p>')
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.toggleQuote()
    editor.commands.insertContent('Citado depois')
    expect(rich(editor).paragraphs.map((paragraph) => [paragraph.quote === true, paragraph.runs.map((run) => run.text).join('')])).toEqual([
      [false, 'Texto'],
      [true, 'Citado depois'],
    ])
  })

  it('atribuição só vale dentro da citação', () => {
    editor = createEditor('<blockquote><p>Frase</p><p>— Autor</p></blockquote>')
    selectText(editor, 'Autor')
    expect(editor.commands.toggleAttribution()).toBe(true)
    expect(rich(editor).paragraphs[1]?.attribution).toBe(true)
    editor.commands.toggleQuote()
    expect(rich(editor).paragraphs[1]?.attribution).toBeUndefined()
    expect(editor.commands.toggleAttribution()).toBe(false)
  })

  it('insere a coleta como epígrafe no início, com atribuição, e deixa o cursor no texto', () => {
    editor = createEditor('<p>Primeiro parágrafo.</p>')
    editor.commands.setTextSelection(5)
    expect(editor.commands.insertEpigraph('  Deus eterno, que nos guias.  ')).toBe(true)
    const document = rich(editor)
    expect(document.paragraphs.map((paragraph) => [paragraph.quote === true, paragraph.attribution === true, paragraph.runs.map((run) => run.text).join('')])).toEqual([
      [true, false, '“Deus eterno, que nos guias.”'],
      [true, true, '— Coleta do dia'],
      [false, false, 'Primeiro parágrafo.'],
    ])
    expect(editor.state.selection.$from.parent.textContent).toBe('Primeiro parágrafo.')
    expect(editor.commands.insertEpigraph('   ')).toBe(false)
  })

  it('epígrafe num documento vazio cria o parágrafo seguinte', () => {
    editor = createEditor('')
    editor.commands.insertEpigraph('Texto', 'Salmo 34')
    expect(manuscriptPlainText(editor.getJSON())).toBe('“Texto”\n— Salmo 34\n')
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(editor.state.selection.$from.depth).toBe(1)
  })
})

describe('recuo, limpar e copiar formatação', () => {
  it('⌘] e ⌘[ mudam o recuo em 36 pt; em listas aprofundam e sobem o item', () => {
    editor = createEditor('<p>Parágrafo</p><ul><li><p>Um</p></li><li><p>Dois</p></li></ul>')
    editor.commands.setTextSelection(2)
    press(editor, 'Mod-]')
    press(editor, 'Mod-]')
    expect(rich(editor).paragraphs[0]?.indentStartPt).toBe(72)
    press(editor, 'Mod-[')
    expect(rich(editor).paragraphs[0]?.indentStartPt).toBe(36)
    editor.commands.outdent()
    editor.commands.outdent()
    expect(rich(editor).paragraphs[0]?.indentStartPt).toBeUndefined()
    editor.commands.setTextSelection(findText(editor, 'Dois').from)
    expect(press(editor, 'Mod-]')).toBe(true)
    expect(rich(editor).paragraphs[2]?.list).toMatchObject({ kind: 'bullet', level: 1 })
    press(editor, 'Mod-[')
    expect(rich(editor).paragraphs[2]?.list).toMatchObject({ kind: 'bullet', level: 0 })
  })

  it('recuo da primeira linha acompanha o recuo do parágrafo', () => {
    editor = createEditor('<p style="margin-left: 10pt; text-indent: 20pt">Texto</p>')
    expect(rich(editor).paragraphs[0]).toMatchObject({ indentStartPt: 10, indentFirstLinePt: 30 })
    editor.commands.indent()
    expect(rich(editor).paragraphs[0]).toMatchObject({ indentStartPt: 46, indentFirstLinePt: 66 })
  })

  it('limpar formatação volta ao corpo: sem marcas, sem título, sem citação', () => {
    editor = createEditor('<h2 style="text-align: center">Título <strong>forte</strong></h2><blockquote><p><em><a href="https://example.org">citação</a></em></p></blockquote>')
    editor.commands.selectAll()
    expect(press(editor, 'Mod-\\')).toBe(true)
    const paragraphs = rich(editor).paragraphs
    expect(paragraphs.map((paragraph) => [paragraph.headingLevel, paragraph.quote === true, paragraph.alignment])).toEqual([
      [0, false, undefined],
      [0, false, undefined],
    ])
    expect(paragraphs.flatMap((paragraph) => paragraph.runs).every((run) => !run.bold && !run.italic && !run.link)).toBe(true)
  })

  it('copiar e colar formatação aplica marcas e estilo de parágrafo (⌥⌘C, ⌥⌘V)', () => {
    editor = createEditor('<h3><strong><em>Modelo</em></strong></h3><p>Alvo comum</p>')
    selectText(editor, 'Modelo')
    expect(press(editor, 'Mod-Alt-c')).toBe(true)
    expect(editor.storage.manuscript.copiedFormatting).not.toBeNull()
    selectText(editor, 'Alvo')
    expect(press(editor, 'Mod-Alt-v')).toBe(true)
    const target = rich(editor).paragraphs[1]
    expect(target?.headingLevel).toBe(3)
    expect(target?.runs[0]).toMatchObject({ text: 'Alvo', bold: true, italic: true })
    expect(target?.runs[1]?.bold).toBeUndefined()
  })
})

describe('selectQuote', () => {
  it('seleciona o trecho citado pela revisão, tolerando espaços e aspas', () => {
    editor = createEditor('<p>Ele disse: “A esperança</p><p>não decepciona.”</p>')
    expect(editor.commands.selectQuote('"A esperança   não decepciona."')).toBe(true)
    const { from, to } = editor.state.selection
    expect(editor.state.doc.textBetween(from, to, '\n')).toBe('“A esperança\nnão decepciona.”')
    expect(editor.commands.selectQuote('texto inexistente')).toBe(false)
  })
})

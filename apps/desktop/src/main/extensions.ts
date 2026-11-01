import type { MainContext } from './context'
import { registerLibrary } from './modules/library'
import { registerReader } from './modules/reader'
import { registerAI } from './modules/ai'
import { registerContent } from './modules/content'

/** Módulos que registram canais adicionais. A Biblioteca vem antes: o Leitor e a revisão a usam. */
export function registerExtensions(context: MainContext): void {
  registerLibrary(context)
  registerReader(context)
  registerAI(context)
  registerContent(context)
}

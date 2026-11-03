import type { MainContext } from '../../context'
import { registerBackup } from './backup'
import { registerDrive } from './drive'
import { registerHistory } from './history'
import { registerImport } from './import'
import { registerSources } from './sources'
import { registerTablet } from './tablet'

export function registerContent(context: MainContext): void {
  registerSources(context)
  registerHistory(context)
  registerDrive(context)
  registerTablet(context)
  registerBackup(context)
  registerImport(context)
}

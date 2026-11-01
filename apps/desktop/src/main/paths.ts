import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Pastas do app em userData (Application Support / AppData / .config). */
export function appPaths() {
  const root = app.getPath('userData')
  const paths = {
    root,
    database: join(root, 'pregar.sqlite'),
    secrets: join(root, 'secrets.bin'),
    logs: join(root, 'Logs'),
    library: join(root, 'Library'),
    thumbnails: join(root, 'Library', 'Capas'),
    tessdata: join(root, 'tessdata'),
    backups: join(root, 'Backups'),
  }
  for (const dir of [paths.logs, paths.library, paths.thumbnails, paths.tessdata]) mkdirSync(dir, { recursive: true })
  return paths
}

export type AppPaths = ReturnType<typeof appPaths>

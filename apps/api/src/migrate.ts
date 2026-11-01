import { loadConfig } from './config'
import { createDatabase, migrateToLatest } from './db'

const config = loadConfig()
const { db } = createDatabase({ connectionString: config.DATABASE_URL, ssl: config.DATABASE_SSL, max: 2 })
try {
  const applied = await migrateToLatest(db)
  console.warn(applied.length > 0 ? `Migrações aplicadas: ${applied.join(', ')}` : 'Banco já está atualizado.')
} finally {
  await db.destroy()
}

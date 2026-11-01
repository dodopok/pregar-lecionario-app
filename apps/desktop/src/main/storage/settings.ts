import { DEFAULT_SETTINGS, mergeSettings } from '@shared/settings'
import type { AppSettings, SettingsPatch } from '@shared/settings'
import type { LocalDatabase } from './db'

export class SettingsRepository {
  private cached: AppSettings | null = null

  constructor(private readonly database: LocalDatabase) {}

  get(): AppSettings {
    if (this.cached) return this.cached
    const row = this.database.get<{ value: string }>("select value from settings where key = 'app'")
    let stored: SettingsPatch = {}
    if (row) {
      try {
        stored = JSON.parse(row.value) as SettingsPatch
      } catch {
        stored = {}
      }
    }
    // Novos campos ganham o valor padrão sem perder o que já estava salvo.
    this.cached = mergeSettings(DEFAULT_SETTINGS, stored)
    return this.cached
  }

  update(patch: SettingsPatch): AppSettings {
    const next = mergeSettings(this.get(), patch)
    this.database.run(
      "insert into settings (key, value) values ('app', ?) on conflict(key) do update set value = excluded.value",
      JSON.stringify(next),
    )
    this.cached = next
    return next
  }
}

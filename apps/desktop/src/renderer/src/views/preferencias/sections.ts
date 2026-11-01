import type { Component } from 'vue'
import { Cloud, Contrast, FileSearch, Globe, Info, Library, Network, Sparkles, Tablet, UserRound } from 'lucide-vue-next'
import AccountSection from './AccountSection.vue'
import EstevaoSection from './EstevaoSection.vue'
import AISection from './AISection.vue'
import AppearanceSection from './AppearanceSection.vue'
import TabletSection from './TabletSection.vue'
import DriveSection from './DriveSection.vue'
import LibrarySection from './LibrarySection.vue'
import SourcesSection from './SourcesSection.vue'
import LogsSection from './LogsSection.vue'
import AboutSection from './AboutSection.vue'

export type PreferencesSectionId =
  | 'conta'
  | 'estevao'
  | 'ia'
  | 'aparencia'
  | 'tablet'
  | 'drive'
  | 'biblioteca'
  | 'fontes'
  | 'registros'
  | 'sobre'

export interface PreferencesSection {
  id: PreferencesSectionId
  title: string
  subtitle: string
  footer: string
  icon: Component
  component: Component
}

/** Ordem da barra lateral. Textos do Swift onde existiam ("Mac" virou "computador"). */
export const PREFERENCES_SECTIONS: readonly PreferencesSection[] = [
  {
    id: 'conta',
    title: 'Conta e assinatura',
    subtitle: 'Entre com o seu email para assinar ou acompanhar a assinatura.',
    footer: 'A conta fica no servidor do Pregar; os sermões ficam neste computador.',
    icon: UserRound,
    component: AccountSection,
  },
  {
    id: 'estevao',
    title: 'Estêvão API',
    subtitle: 'A conexão usa sempre a Estêvão API v2.',
    footer: 'A chave fica salva no cofre de senhas deste computador.',
    icon: Network,
    component: EstevaoSection,
  },
  {
    id: 'ia',
    title: 'Inteligência artificial',
    subtitle: 'Pela assinatura do Pregar ou por provedores externos com suas próprias chaves.',
    footer: 'Credenciais no cofre de senhas; preferências neste computador.',
    icon: Sparkles,
    component: AISection,
  },
  {
    id: 'aparencia',
    title: 'Aparência',
    subtitle: 'Claro, escuro ou automático.',
    footer: 'Preferência salva neste computador.',
    icon: Contrast,
    component: AppearanceSection,
  },
  {
    id: 'tablet',
    title: 'Tablet',
    subtitle: 'Formato de leitura no tablet.',
    footer: 'Preferências locais de leitura no tablet.',
    icon: Tablet,
    component: TabletSection,
  },
  {
    id: 'drive',
    title: 'Google Drive',
    subtitle: 'Sermões, cópia do tablet e ideias no seu Drive.',
    footer: 'O Pregar só acessa os arquivos que ele mesmo cria no seu Drive.',
    icon: Cloud,
    component: DriveSection,
  },
  {
    id: 'biblioteca',
    title: 'Biblioteca',
    subtitle: 'Backup e restauração de tudo o que o app guarda.',
    footer: 'Os arquivos PDF permanecem na pasta original.',
    icon: Library,
    component: LibrarySection,
  },
  {
    id: 'fontes',
    title: 'Fontes',
    subtitle: 'Sites e autores consultados por passagem.',
    footer: 'As fontes ficam neste computador e aparecem na Mesa.',
    icon: Globe,
    component: SourcesSection,
  },
  {
    id: 'registros',
    title: 'Registros',
    subtitle: 'Registro das chamadas externas, para diagnosticar erros.',
    footer: 'O registro fica neste computador, sem chaves nem manuscrito.',
    icon: FileSearch,
    component: LogsSection,
  },
  {
    id: 'sobre',
    title: 'Sobre',
    subtitle: 'Versão, atualizações e privacidade.',
    footer: 'Pregar · Caminho Anglicano',
    icon: Info,
    component: AboutSection,
  },
]

/** Aceita também nomes alternativos usados por outras janelas ("ia", "inteligencia-artificial", "assinatura"). */
const ALIASES: Record<string, PreferencesSectionId> = {
  assinatura: 'conta',
  account: 'conta',
  'estevao-api': 'estevao',
  api: 'estevao',
  'inteligencia-artificial': 'ia',
  ai: 'ia',
  appearance: 'aparencia',
  library: 'biblioteca',
  backup: 'biblioteca',
  sources: 'fontes',
  logs: 'registros',
  about: 'sobre',
}

export function findSection(value: unknown): PreferencesSection {
  const raw = (Array.isArray(value) ? value[0] : value) as string | undefined
  const key = (raw ?? '').toLowerCase()
  const id = ALIASES[key] ?? key
  return PREFERENCES_SECTIONS.find((section) => section.id === id) ?? PREFERENCES_SECTIONS[0]!
}

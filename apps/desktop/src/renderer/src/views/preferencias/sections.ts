import type { Component } from 'vue'
import { Church, Cloud, Contrast, Globe, Info, Library, Network, Sparkles, Timer, UserRound } from 'lucide-vue-next'
import AccountSection from './AccountSection.vue'
import EstevaoSection from './EstevaoSection.vue'
import AISection from './AISection.vue'
import AppearanceSection from './AppearanceSection.vue'
import TabletSection from './TabletSection.vue'
import RhythmSection from './RhythmSection.vue'
import DriveSection from './DriveSection.vue'
import LibrarySection from './LibrarySection.vue'
import SourcesSection from './SourcesSection.vue'
import AboutSection from './AboutSection.vue'

export type PreferencesSectionId =
  | 'conta'
  | 'estevao'
  | 'ia'
  | 'aparencia'
  | 'ritmo'
  | 'pulpito'
  | 'drive'
  | 'biblioteca'
  | 'fontes'
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
    subtitle: 'Sua conta do Proper, a assinatura por Pix e o uso do mês.',
    footer: 'A conta fica no servidor do Proper; os sermões ficam neste computador.',
    icon: UserRound,
    component: AccountSection,
  },
  {
    id: 'estevao',
    title: 'Leituras e calendário',
    subtitle: 'De onde vêm as leituras: assinatura, chave própria da Estêvão API ou degustação.',
    footer: 'A chave fica salva no cofre de senhas deste computador.',
    icon: Network,
    component: EstevaoSection,
  },
  {
    id: 'ia',
    title: 'Revisão e pesquisa',
    subtitle: 'A revisão por IA e a pesquisa de materiais: pela assinatura ou com as suas chaves.',
    footer: 'Credenciais no cofre de senhas; preferências neste computador.',
    icon: Sparkles,
    component: AISection,
  },
  {
    id: 'ritmo',
    title: 'Ritmo e duração',
    subtitle: 'O dia em que prega, a meta de minutos e o seu ritmo de fala.',
    footer: 'As estimativas da Mesa e do Ensaio usam estes valores.',
    icon: Timer,
    component: RhythmSection,
  },
  {
    id: 'aparencia',
    title: 'Aparência e texto',
    subtitle: 'Claro, escuro ou automático, e o tamanho do texto da interface.',
    footer: 'Preferência salva neste computador.',
    icon: Contrast,
    component: AppearanceSection,
  },
  {
    id: 'pulpito',
    title: 'Levar para o púlpito',
    subtitle: 'Tipografia da folha impressa ou em PDF, notas e pasta.',
    footer: 'Preferências locais da folha do púlpito.',
    icon: Church,
    component: TabletSection,
  },
  {
    id: 'drive',
    title: 'Google Drive',
    subtitle: 'Sermões, cópia do tablet e ideias no seu Drive.',
    footer: 'O Proper só acessa os arquivos que ele mesmo cria no seu Drive.',
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
    id: 'sobre',
    title: 'Sobre',
    subtitle: 'Versão, atualizações, privacidade e os registros para o suporte.',
    footer: 'Proper · Caminho Anglicano',
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
  tablet: 'pulpito',
  pulpit: 'pulpito',
  rhythm: 'ritmo',
  registros: 'sobre',
  library: 'biblioteca',
  backup: 'biblioteca',
  sources: 'fontes',
  logs: 'sobre',
  about: 'sobre',
}

export function findSection(value: unknown): PreferencesSection {
  const raw = (Array.isArray(value) ? value[0] : value) as string | undefined
  const key = (raw ?? '').toLowerCase()
  const id = ALIASES[key] ?? key
  return PREFERENCES_SECTIONS.find((section) => section.id === id) ?? PREFERENCES_SECTIONS[0]!
}

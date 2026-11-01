<script setup lang="ts">
/** Cartão da conta: iniciais, nome editável, email, plano e saída. */
import { computed, nextTick, ref } from 'vue'
import { LogOut, Pencil } from 'lucide-vue-next'
import PButton from '@/components/PButton.vue'
import { errorMessage, invoke } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useToasts } from '@/stores/toasts'
import { accountInitials, formatLongDate } from '../format'

const app = useAppStore()
const toasts = useToasts()

const account = computed(() => app.account.account)
const email = computed(() => account.value?.user.email ?? app.account.email ?? '')
const name = computed(() => account.value?.user.name?.trim() || '')
const isPro = computed(() => account.value?.plan === 'pro')

const editing = ref(false)
const draft = ref('')
const saving = ref(false)
const error = ref<string | null>(null)
const leaving = ref(false)
const nameInput = ref<HTMLInputElement | null>(null)

async function startEditing(): Promise<void> {
  draft.value = name.value
  error.value = null
  editing.value = true
  await nextTick()
  nameInput.value?.focus()
  nameInput.value?.select()
}

async function save(): Promise<void> {
  const value = draft.value.trim()
  if (!value) {
    error.value = 'Digite um nome.'
    return
  }
  saving.value = true
  error.value = null
  try {
    app.account = await invoke('account:rename', { name: value })
    editing.value = false
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    saving.value = false
  }
}

async function logout(): Promise<void> {
  leaving.value = true
  try {
    app.account = await invoke('account:logout')
    toasts.show('Você saiu da conta neste computador.', 'info')
  } catch (caught) {
    toasts.show(errorMessage(caught), 'error')
  } finally {
    leaving.value = false
  }
}
</script>

<template>
  <div class="account-card">
    <div class="account-card__avatar" aria-hidden="true">{{ accountInitials(name, email) }}</div>
    <div class="account-card__main">
      <form v-if="editing" class="account-card__edit" @submit.prevent="save" @keydown.esc.stop="editing = false">
        <label class="visually-hidden" for="account-name">Seu nome</label>
        <input id="account-name" ref="nameInput" v-model="draft" class="field" maxlength="120" autocomplete="name" />
        <PButton variant="primary" compact type="submit" :busy="saving">Salvar</PButton>
        <PButton compact @click="editing = false">Cancelar</PButton>
      </form>
      <div v-else class="account-card__name-row">
        <span class="account-card__name" :class="{ 'account-card__name--empty': !name }">{{ name || 'Sem nome' }}</span>
        <PButton variant="icon" compact label="Editar nome" @click="startEditing"><Pencil :size="13" /></PButton>
      </div>
      <p v-if="error" class="account-card__error" role="alert">{{ error }}</p>
      <span class="account-card__email selectable">{{ email }}</span>
      <span v-if="account?.user.createdAt" class="account-card__since">Conta criada em {{ formatLongDate(account.user.createdAt) }}</span>
    </div>
    <div class="account-card__side">
      <span class="plan-badge" :class="{ 'plan-badge--pro': isPro }">{{ isPro ? 'Assinatura' : 'Gratuito' }}</span>
      <PButton compact :busy="leaving" @click="logout"><LogOut :size="13" aria-hidden="true" />Sair</PButton>
    </div>
  </div>
</template>

<style scoped>
.account-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 0;
}
.account-card__avatar {
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-family: var(--font-serif);
  font-size: 18px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
}
.account-card__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.account-card__name-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.account-card__name {
  font-family: var(--font-serif);
  font-size: 18px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-card__name--empty {
  color: var(--muted);
  font-weight: 500;
}
.account-card__edit {
  display: flex;
  gap: 6px;
  align-items: center;
}
.account-card__edit .field {
  width: min(280px, 100%);
}
.account-card__email {
  font-size: 13px;
}
.account-card__since {
  font-size: 11px;
  color: var(--muted);
}
.account-card__error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}
.account-card__side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.plan-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
  color: var(--muted);
  background: color-mix(in srgb, var(--ink) 7%, transparent);
}
.plan-badge--pro {
  color: var(--accent);
  background: var(--accent-soft);
}
</style>

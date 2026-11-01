<script setup lang="ts">
/** Login sem senha: email → código de 6 dígitos (com reenvio temporizado). */
import { computed, nextTick, ref } from 'vue'
import { Mail } from 'lucide-vue-next'
import PButton from '@/components/PButton.vue'
import { errorMessage, invoke } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useToasts } from '@/stores/toasts'
import { formatCountdown, isPlausibleEmail, sanitizeLoginCode } from '../format'
import { useNow } from '../composables'

const RESEND_COOLDOWN_MS = 60_000

const app = useAppStore()
const toasts = useToasts()
const now = useNow()

const step = ref<'email' | 'code'>('email')
const email = ref(app.account.email ?? '')
const code = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
const expiresInMinutes = ref(10)
const sentAt = ref(0)
const codeInput = ref<HTMLInputElement | null>(null)
const emailInput = ref<HTMLInputElement | null>(null)

const resendWait = computed(() => Math.max(0, sentAt.value + RESEND_COOLDOWN_MS - now.value))

async function sendCode(): Promise<void> {
  error.value = null
  const value = email.value.trim().toLowerCase()
  if (!isPlausibleEmail(value)) {
    error.value = 'Confira o email: ele precisa ter o formato nome@exemplo.com.'
    emailInput.value?.focus()
    return
  }
  busy.value = true
  try {
    const result = await invoke('account:startLogin', { email: value })
    email.value = value
    expiresInMinutes.value = result.expiresInMinutes
    sentAt.value = Date.now()
    now.value = Date.now()
    code.value = ''
    step.value = 'code'
    await nextTick()
    codeInput.value?.focus()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    busy.value = false
  }
}

async function verify(): Promise<void> {
  error.value = null
  if (code.value.length !== 6) {
    error.value = 'O código tem 6 dígitos.'
    codeInput.value?.focus()
    return
  }
  busy.value = true
  try {
    const state = await invoke('account:verifyLogin', { email: email.value, code: code.value })
    app.account = state
    toasts.show(`Você entrou como ${state.email ?? email.value}.`, 'success')
  } catch (caught) {
    error.value = errorMessage(caught)
    code.value = ''
    await nextTick()
    codeInput.value?.focus()
  } finally {
    busy.value = false
  }
}

function onCodeInput(event: Event): void {
  const target = event.target as HTMLInputElement
  code.value = sanitizeLoginCode(target.value)
  target.value = code.value
  if (code.value.length === 6 && !busy.value) void verify()
}

async function changeEmail(): Promise<void> {
  step.value = 'email'
  code.value = ''
  error.value = null
  await nextTick()
  emailInput.value?.focus()
}
</script>

<template>
  <div class="login">
    <div class="login__head">
      <div class="login__icon" aria-hidden="true"><Mail :size="18" /></div>
      <div>
        <h3 class="login__title">{{ step === 'email' ? 'Entrar ou criar conta' : 'Digite o código' }}</h3>
        <p v-if="step === 'email'" class="login__lead">
          Digite seu email. Enviaremos um código de 6 dígitos; não precisa criar senha.
        </p>
        <p v-else class="login__lead">
          Enviamos um código para <strong>{{ email }}</strong>. Ele vale por {{ expiresInMinutes }} minutos. Se não chegar, confira a
          caixa de spam.
        </p>
      </div>
    </div>

    <form v-if="step === 'email'" class="login__form" novalidate @submit.prevent="sendCode">
      <label class="login__label" for="login-email">Email</label>
      <div class="login__inline">
        <input
          id="login-email"
          ref="emailInput"
          v-model="email"
          class="field login__email"
          type="email"
          autocomplete="email"
          inputmode="email"
          placeholder="voce@exemplo.com"
          :aria-invalid="Boolean(error)"
          aria-describedby="login-error"
          spellcheck="false"
        />
        <PButton variant="primary" type="submit" :busy="busy">Enviar código</PButton>
      </div>
    </form>

    <form v-else class="login__form" novalidate @submit.prevent="verify">
      <label class="login__label" for="login-code">Código de 6 dígitos</label>
      <div class="login__inline">
        <input
          id="login-code"
          ref="codeInput"
          :value="code"
          class="field login__code"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          placeholder="000000"
          :aria-invalid="Boolean(error)"
          aria-describedby="login-error"
          @input="onCodeInput"
        />
        <PButton variant="primary" type="submit" :busy="busy" :disabled="code.length !== 6">Entrar</PButton>
      </div>
      <div class="login__links">
        <PButton variant="link" compact :disabled="resendWait > 0 || busy" @click="sendCode">
          {{ resendWait > 0 ? `Reenviar código em ${formatCountdown(resendWait)}` : 'Reenviar código' }}
        </PButton>
        <PButton variant="link" compact :disabled="busy" @click="changeEmail">Usar outro email</PButton>
      </div>
    </form>

    <p v-if="error" id="login-error" class="login__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.login {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 0 14px;
}
.login__head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.login__icon {
  flex: none;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-card);
  color: var(--accent);
  background: var(--accent-soft);
}
.login__title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 600;
}
.login__lead {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.45;
}
.login__lead strong {
  color: var(--ink);
}
.login__form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-left: 48px;
}
.login__label {
  font-size: 12px;
  font-weight: 500;
}
.login__inline {
  display: flex;
  gap: 8px;
  align-items: center;
}
.login__email {
  height: 32px;
  width: min(340px, 100%);
  font-size: 14px;
}
.login__code {
  height: 40px;
  width: 168px;
  font-family: var(--font-mono);
  font-size: 22px;
  letter-spacing: 0.32em;
  text-align: center;
}
.login__links {
  display: flex;
  gap: 4px;
  margin-left: -6px;
}
.login__error {
  margin: 0 0 0 48px;
  font-size: 12px;
  color: var(--danger);
}
</style>

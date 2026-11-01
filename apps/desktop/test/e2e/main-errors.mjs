// Acompanha o stderr do processo principal e guarda os erros não tratados que ele registrar
// (ver src/main/crash-guard.ts). Cada roteiro falha se a lista não terminar vazia.
const MARKER = '[pregar] erro não tratado no processo principal'

export function watchMainErrors(app) {
  const errors = []
  let buffer = ''
  app.process().stderr?.on('data', (chunk) => {
    buffer += chunk.toString()
    const index = buffer.indexOf(MARKER)
    if (index >= 0) {
      errors.push(buffer.slice(index, index + 1500))
      buffer = ''
    } else if (buffer.length > 8000) buffer = buffer.slice(-2000)
  })
  return errors
}

/** Mensagem curta para o relatório, ou `null` se não houve erro. */
export function describeMainErrors(errors) {
  return errors.length === 0 ? null : `erro não tratado no processo principal:\n${errors.slice(0, 2).join('\n---\n')}`
}

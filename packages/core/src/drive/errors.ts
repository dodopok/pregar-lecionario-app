/** Erros da integração Google Drive/Docs, com as mensagens do app Swift. */

export type GoogleDriveErrorCode =
  | 'missingClientID'
  | 'notConnected'
  | 'invalidClientID'
  | 'invalidOAuthResponse'
  | 'invalidPublicDriveFolderLink'
  | 'missingPublicDriveAPIKey'
  | 'publicDriveFolderIsNotAccessible'
  | 'noPDFsInPublicDriveFolder'
  | 'authorizationDenied'
  | 'authorizationTimedOut'
  | 'api'
  | 'documentConflict'
  | 'emptyDocument'
  | 'syncInProgress'
  | 'driveImportFileTooLarge'
  | 'driveImportInvalidPDF'
  | 'driveImportIntegrityMismatch'
  | 'driveImportTooManyFiles'

export interface GoogleDriveErrorDetails {
  /** Código HTTP, para `api`. */
  status?: number
  /** Mensagem do Google (`api`), motivo da recusa (`authorizationDenied`) ou nome do arquivo (importação). */
  detail?: string
  /** Código de erro OAuth (`invalid_grant`, por exemplo), quando a resposta do token trouxe um. */
  oauthError?: string
}

export function googleDriveErrorMessage(
  code: GoogleDriveErrorCode,
  details: GoogleDriveErrorDetails = {},
): string {
  const detail = details.detail ?? ''
  switch (code) {
    case 'missingClientID':
      return 'Informe o OAuth Client ID na conexão do Google Drive.'
    case 'notConnected':
      return 'Conecte o Google Drive pela Mesa e tente novamente.'
    case 'invalidClientID':
      return 'O Client ID não parece ser de um aplicativo Google para desktop.'
    case 'invalidOAuthResponse':
      return 'O Google não concluiu a autorização. Tente conectar novamente.'
    case 'invalidPublicDriveFolderLink':
      return 'Cole o link compartilhável de uma pasta do Google Drive.'
    case 'missingPublicDriveAPIKey':
      return 'Informe uma chave de API Google com a Drive API ativada.'
    case 'publicDriveFolderIsNotAccessible':
      return 'A pasta não está pública ou o link não permite acesso. Confira o compartilhamento “Qualquer pessoa com o link”.'
    case 'noPDFsInPublicDriveFolder':
      return 'Nenhum PDF foi encontrado nessa pasta pública.'
    case 'authorizationDenied':
      return `A autorização do Google foi recusada: ${detail}`
    case 'authorizationTimedOut':
      return 'A autorização expirou. Volte ao app e conecte o Google Drive novamente.'
    case 'api':
      return `Google Drive (HTTP ${details.status ?? 0}): ${detail}`
    case 'documentConflict':
      return 'O Google Doc mudou fora do app desde a última sincronização. Sua cópia local foi preservada. Compare as versões antes de substituir a cópia do Drive.'
    case 'emptyDocument':
      return 'Escreva algum texto antes de salvar o sermão no Google Drive.'
    case 'syncInProgress':
      return 'A sincronização anterior ainda está em andamento.'
    case 'driveImportFileTooLarge':
      return `O PDF ${detail} excede o limite de 128 MB e foi ignorado.`
    case 'driveImportInvalidPDF':
      return `O arquivo ${detail} não parece ser um PDF válido.`
    case 'driveImportIntegrityMismatch':
      return `O PDF ${detail} não passou na verificação de integridade e não foi guardado.`
    case 'driveImportTooManyFiles':
      return 'A pasta contém mais de 5.000 PDFs. Escolha uma pasta menor para importar com segurança.'
  }
}

export class GoogleDriveError extends Error {
  readonly code: GoogleDriveErrorCode
  readonly status?: number
  readonly detail?: string
  readonly oauthError?: string

  constructor(code: GoogleDriveErrorCode, details: GoogleDriveErrorDetails = {}) {
    super(googleDriveErrorMessage(code, details))
    this.name = 'GoogleDriveError'
    this.code = code
    this.status = details.status
    this.detail = details.detail
    this.oauthError = details.oauthError
  }

  static api(status: number, message: string, oauthError?: string): GoogleDriveError {
    return new GoogleDriveError('api', { status, detail: message, oauthError })
  }

  static authorizationDenied(reason: string): GoogleDriveError {
    return new GoogleDriveError('authorizationDenied', { detail: reason })
  }

  static fileTooLarge(name: string): GoogleDriveError {
    return new GoogleDriveError('driveImportFileTooLarge', { detail: name })
  }

  static invalidPDF(name: string): GoogleDriveError {
    return new GoogleDriveError('driveImportInvalidPDF', { detail: name })
  }

  static integrityMismatch(name: string): GoogleDriveError {
    return new GoogleDriveError('driveImportIntegrityMismatch', { detail: name })
  }
}

export function isGoogleDriveError(error: unknown, code?: GoogleDriveErrorCode): error is GoogleDriveError {
  return error instanceof GoogleDriveError && (code === undefined || error.code === code)
}

/** Mensagem apresentável de qualquer erro (equivalente ao `localizedDescription`). */
export function localizedDescription(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

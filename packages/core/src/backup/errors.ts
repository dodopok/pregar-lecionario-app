/** Erros do backup, com as mensagens de `PregarBackupError` do app Swift. */

export type BackupErrorCode =
  | 'invalidPackage'
  | 'unsupportedVersion'
  | 'corruptedFile'
  | 'missingAsset'
  | 'missingPDF'
  | 'assetCollision'
  | 'restoreFailed'

export class BackupError extends Error {
  readonly code: BackupErrorCode

  private constructor(code: BackupErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'BackupError'
    this.code = code
  }

  static invalidPackage(cause?: unknown): BackupError {
    return new BackupError('invalidPackage', 'Esta pasta não contém um backup válido do Pregar.', { cause })
  }

  static unsupportedVersion(): BackupError {
    return new BackupError(
      'unsupportedVersion',
      'A versão deste backup não é compatível com esta versão do Pregar.',
    )
  }

  static corruptedFile(): BackupError {
    return new BackupError('corruptedFile', 'Um arquivo do backup está incompleto ou foi alterado.')
  }

  static missingAsset(): BackupError {
    return new BackupError('missingAsset', 'O backup referencia um arquivo que não está incluído no pacote.')
  }

  static missingPDF(title: string): BackupError {
    return new BackupError(
      'missingPDF',
      `Não foi possível incluir o PDF “${title}” no backup. Confira se o arquivo ainda está disponível.`,
    )
  }

  static assetCollision(): BackupError {
    return new BackupError(
      'assetCollision',
      'Um arquivo local destinado à restauração não corresponde ao conteúdo do backup.',
    )
  }

  static restoreFailed(detail: string, cause?: unknown): BackupError {
    return new BackupError(
      'restoreFailed',
      `Não foi possível concluir a restauração. Os dados anteriores foram preservados. ${detail}`,
      { cause },
    )
  }
}

export function isBackupError(error: unknown, code?: BackupErrorCode): error is BackupError {
  return error instanceof BackupError && (code === undefined || error.code === code)
}

const encoder = new TextEncoder()

function toBytes(data: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof data === 'string') return encoder.encode(data)
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/** SHA-256 em hexadecimal, via Web Crypto (Node 22+, Electron e navegadores). */
export async function sha256Hex(data: Uint8Array | ArrayBuffer | string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', toBytes(data) as BufferSource)
  return bytesToHex(new Uint8Array(digest))
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

export function randomId(length = 16): string {
  return base64UrlEncode(randomBytes(length))
}

/** Comparação em tempo constante para segredos de mesmo tamanho. */
export function timingSafeEqualString(a: string, b: string): boolean {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  let diff = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return diff === 0
}

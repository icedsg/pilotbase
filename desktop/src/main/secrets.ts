import { safeStorage } from 'electron'
import { randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface Secrets {
  secretKey: string
  encryptionKey: string
}

function generateFernetKey(): string {
  // Fernet key = 32 random bytes, urlsafe-base64 encoded (matches Python's
  // cryptography.fernet.Fernet.generate_key() format exactly).
  return randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
}

/** Loads `<dataDir>/secrets.bin`, generating it on first run. These values
 * never change afterwards (docs/desktop-plan.md §2 step 2). */
export function loadOrCreateSecrets(dataDir: string): Secrets {
  const path = join(dataDir, 'secrets.bin')

  if (existsSync(path)) {
    const encrypted = readFileSync(path)
    const json = safeStorage.decryptString(encrypted)
    return JSON.parse(json)
  }

  const secrets: Secrets = {
    secretKey: randomBytes(32).toString('hex'),
    encryptionKey: generateFernetKey(),
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(secrets))
  writeFileSync(path, encrypted)
  return secrets
}

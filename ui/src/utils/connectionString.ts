// Reads a pasted connection string into the connection form's fields. Nothing here
// keeps the string: the form saves the fields as usual, password encrypted.

export interface ParsedConnection {
  db_type?: string
  host: string
  port?: number
  database?: string
  username?: string
  password?: string
  ssl_mode?: string
  api_key?: string
}

const SCHEMES: Record<string, string> = {
  postgres: 'postgresql',
  postgresql: 'postgresql',
  cockroachdb: 'cockroachdb',
  mysql: 'mysql',
  mariadb: 'mariadb',
  mssql: 'mssql',
  sqlserver: 'mssql',
  oracle: 'oracle',
  mongodb: 'mongodb',
  redis: 'redis',
  couchdb: 'couchdb',
  qdrant: 'qdrant',
  chroma: 'chroma',
  weaviate: 'weaviate',
  milvus: 'milvus',
}

const ENCRYPTED_FLAGS = new Set(['require', 'required', 'true', '1', 'on'])
const LIBPQ_MODES = new Set(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'])
// These clients take a bare host name and use the SSL setting, not an https:// host.
const BARE_HOST_TYPES = new Set(['qdrant'])
const HTTP_TYPES = new Set(['couchdb', 'qdrant', 'chroma', 'weaviate', 'milvus'])

function sslFromQuery(q: URLSearchParams): string | undefined {
  const mode = (q.get('sslmode') ?? q.get('ssl-mode') ?? q.get('ssl_mode'))?.toLowerCase()
  if (mode) {
    if (LIBPQ_MODES.has(mode)) return mode
    if (mode === 'verify_identity') return 'verify-full'
    if (mode === 'verify_ca') return 'verify-ca'
    if (mode === 'required') return 'require'
    if (mode === 'disabled') return 'disable'
  }
  const flag = (q.get('ssl') ?? q.get('tls'))?.toLowerCase()
  if (flag) return ENCRYPTED_FLAGS.has(flag) ? 'require' : 'disable'
  return undefined
}

/**
 * @param text the pasted string
 * @param currentType the type already picked in the form: it decides between mysql/mariadb
 *   (a MariaDB server is usually given as mysql://) and what an http(s):// address is.
 * @returns the fields, or an error to show under the input
 */
export function parseConnectionString(text: string, currentType?: string): ParsedConnection | { error: string } {
  const raw = text.trim()
  const match = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw)
  if (!match) return { error: "That doesn't look like a connection string, e.g. postgresql://user:password@host:5432/db" }

  const scheme = match[1].toLowerCase()
  if (scheme === 'mongodb+srv') {
    return { error: "mongodb+srv:// addresses aren't supported yet. Use the host and port of one server." }
  }
  const isHttp = scheme === 'http' || scheme === 'https'
  const base = scheme.split('+')[0] // postgresql+psycopg2://, mysql+pymysql://
  if (!isHttp && base !== 'rediss' && !SCHEMES[base]) return { error: `Pilotbase can't read ${scheme}:// addresses.` }

  let url: URL
  try {
    // URL only splits user, password and port reliably for the schemes it knows.
    url = new URL(raw.replace(/^[^:]+:/, 'http:'))
  } catch {
    return { error: "That connection string can't be read. Check it for a missing part or a stray character." }
  }
  if (!url.hostname) return { error: 'That connection string has no host.' }

  let dbType: string | undefined
  if (isHttp) {
    dbType = currentType && HTTP_TYPES.has(currentType) ? currentType : undefined
  } else if (base === 'rediss') {
    dbType = 'redis'
  } else if (base === 'mysql' && currentType === 'mariadb') {
    dbType = 'mariadb'
  } else {
    dbType = SCHEMES[base]
  }

  const encryptedScheme = scheme === 'https' || base === 'rediss'
  let host = url.hostname
  if (isHttp && !(dbType && BARE_HOST_TYPES.has(dbType))) host = `${scheme}://${host}`

  const out: ParsedConnection = { db_type: dbType, host }
  // The stand-in http: above swallows port 80, so read the port as written.
  const writtenPort = /:(\d+)(?:[/?#]|$)/.exec(raw.slice(raw.lastIndexOf('@') + 1))
  if (writtenPort) out.port = Number(writtenPort[1])
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, '').replace(/\/+$/, ''))
  if (database) out.database = database
  if (url.username) out.username = decodeURIComponent(url.username)
  if (url.password) out.password = decodeURIComponent(url.password)
  const apiKey = url.searchParams.get('api_key') ?? url.searchParams.get('apiKey')
  if (apiKey) out.api_key = apiKey
  const ssl = sslFromQuery(url.searchParams) ?? (encryptedScheme ? 'require' : undefined)
  if (ssl) out.ssl_mode = ssl
  return out
}

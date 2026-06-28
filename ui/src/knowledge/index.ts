import pgTypes    from '@knowledge/postgresql/data_types.json'
import myTypes    from '@knowledge/mysql/data_types.json'
import mbTypes    from '@knowledge/mariadb/data_types.json'
import slTypes    from '@knowledge/sqlite/data_types.json'
import msTypes    from '@knowledge/mssql/data_types.json'
import mgTypes    from '@knowledge/mongodb/data_types.json'

export interface KnowledgeTypeEntry {
  name: string
  aliases: string[]
  params: string | null
  default_expr: string
  description: string
  storage?: string
  min_version?: string
  notes?: string
  bson_code?: number
}

export interface KnowledgeTypeCategory {
  category: string
  types: KnowledgeTypeEntry[]
}

export interface KnowledgeDataTypes {
  db_type: string
  version_info: string
  source: string
  notes?: string
  categories: KnowledgeTypeCategory[]
}

const RAW: Record<string, KnowledgeDataTypes> = {
  postgresql: pgTypes as KnowledgeDataTypes,
  mysql:      myTypes as KnowledgeDataTypes,
  mariadb:    mbTypes as KnowledgeDataTypes,
  sqlite:     slTypes as KnowledgeDataTypes,
  mssql:      msTypes as KnowledgeDataTypes,
  mongodb:    mgTypes as KnowledgeDataTypes,
}

export function getTypeCategories(dbType: string): KnowledgeTypeCategory[] {
  return (RAW[dbType] ?? RAW.postgresql).categories
}

export function getVersionInfo(dbType: string): string {
  return (RAW[dbType] ?? RAW.postgresql).version_info
}

export function getSource(dbType: string): string {
  return (RAW[dbType] ?? RAW.postgresql).source
}

export function getAllTypes(dbType: string): KnowledgeTypeEntry[] {
  return getTypeCategories(dbType).flatMap(c => c.types)
}

export function findType(dbType: string, typeName: string): KnowledgeTypeEntry | undefined {
  const needle = typeName.toUpperCase().split('(')[0].trim()
  return getAllTypes(dbType).find(t =>
    t.name.toUpperCase() === needle ||
    t.aliases.some(a => a.toUpperCase() === needle)
  )
}

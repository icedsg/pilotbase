// node --test ui/tests/connectionString.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseConnectionString as parse } from '../src/utils/connectionString.ts'

test('managed PostgreSQL address', () => {
  assert.deepEqual(parse('postgresql://admin:p%40ss%2Fw0rd@db1.example.net:21034/app?sslmode=require'), {
    db_type: 'postgresql', host: 'db1.example.net', port: 21034, database: 'app',
    username: 'admin', password: 'p@ss/w0rd', ssl_mode: 'require',
  })
})

test('postgres:// and driver suffixes', () => {
  const r = parse('postgres+psycopg2://u:p@h/d') as any
  assert.equal(r.db_type, 'postgresql')
  assert.equal(r.port, undefined)
  assert.equal(r.ssl_mode, undefined)
})

test('mysql:// stays MariaDB when MariaDB is picked', () => {
  assert.equal((parse('mysql://a:b@h:3306/x', 'mariadb') as any).db_type, 'mariadb')
  assert.equal((parse('mysql://a:b@h:3306/x', 'postgresql') as any).db_type, 'mysql')
})

test('mysql ssl spellings', () => {
  assert.equal((parse('mysql://a:b@h/x?ssl-mode=REQUIRED') as any).ssl_mode, 'require')
  assert.equal((parse('mysql://a:b@h/x?ssl=true') as any).ssl_mode, 'require')
  assert.equal((parse('mysql://a:b@h/x?ssl-mode=VERIFY_IDENTITY') as any).ssl_mode, 'verify-full')
  assert.equal((parse('mysql://a:b@h/x?ssl=false') as any).ssl_mode, 'disable')
})

test('https address keeps the picked vector or document engine', () => {
  assert.deepEqual(parse('https://admin:s3cret@db2.example.net:21100', 'couchdb'), {
    db_type: 'couchdb', host: 'https://db2.example.net', port: 21100,
    username: 'admin', password: 's3cret', ssl_mode: 'require',
  })
  const q = parse('https://db2.example.net:21100?api_key=k1', 'qdrant') as any
  assert.equal(q.host, 'db2.example.net')
  assert.equal(q.ssl_mode, 'require')
  assert.equal(q.api_key, 'k1')
})

test('https address with a SQL engine picked leaves the type alone', () => {
  assert.equal((parse('https://h:1', 'postgresql') as any).db_type, undefined)
})

test('port 80 written out is kept', () => {
  assert.equal((parse('http://h:80', 'chroma') as any).port, 80)
})

test('rediss means encrypted', () => {
  const r = parse('rediss://:pw@h:6380/2') as any
  assert.equal(r.db_type, 'redis')
  assert.equal(r.password, 'pw')
  assert.equal(r.database, '2')
  assert.equal(r.ssl_mode, 'require')
})

test('things it refuses', () => {
  for (const s of ['hello', 'localhost:5432', 'ftp://h/x', 'mongodb+srv://a:b@c/d', 'postgresql://']) {
    assert.ok('error' in parse(s), s)
  }
})

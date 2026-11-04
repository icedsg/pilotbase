// node --test ui/tests/download.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rowsToCsv } from '../src/utils/download.ts'

test('CSV uses Excel-friendly CRLF and quotes commas, quotes, and newlines', () => {
  assert.equal(
    rowsToCsv(['name', 'note'], [{ name: 'José', note: 'a,"b"\nline' }]),
    'name,note\r\nJosé,"a,""b""\nline"',
  )
})

test('CSV keeps database NULL empty but preserves the text NULL and empty strings', () => {
  assert.equal(
    rowsToCsv(['database_null', 'text_null', 'empty'], [{ database_null: null, text_null: 'NULL', empty: '' }]),
    'database_null,text_null,empty\r\n,NULL,',
  )
})

test('CSV serializes structured cell values as JSON', () => {
  assert.equal(rowsToCsv(['value'], [{ value: { ok: true } }]), 'value\r\n"{""ok"":true}"')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { createClientId } from './id'

test('uses randomUUID when the runtime provides it', () => {
  const id = createClientId('upload', { randomUUID: () => 'fixed-uuid' })

  assert.equal(id, 'upload_fixed-uuid')
})

test('falls back when randomUUID is unavailable in an insecure context', () => {
  const first = createClientId('upload', {})
  const second = createClientId('upload', {})

  assert.match(first, /^upload_[a-z0-9]+_[a-z0-9]+$/)
  assert.notEqual(first, second)
})

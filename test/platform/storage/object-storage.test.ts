import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AppError } from '@ai-reflow/core'
import {
  LocalObjectStorage,
  defaultObjectStoragePath,
} from '../../../packages/platform/src/storage/object-storage'

test('local object storage round-trips bytes and blocks path traversal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ai-reflow-storage-'))
  try {
    const storage = new LocalObjectStorage(root)
    const bytes = Buffer.from('knowledge document')
    await storage.put({
      key: 'kb/doc_1/source.pdf',
      bytes,
      contentType: 'application/pdf',
    })

    assert.deepEqual(
      await storage.get('kb/doc_1/source.pdf'),
      bytes,
    )
    await assert.rejects(
      storage.put({
        key: '../escape.pdf',
        bytes,
        contentType: 'application/pdf',
      }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === 'OBJECT_STORAGE_KEY_INVALID',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('default object storage path is stable across process working directories', async () => {
  const original = process.cwd()
  const directory = await mkdtemp(join(tmpdir(), 'ai-reflow-cwd-'))
  try {
    const baseline = defaultObjectStoragePath()
    process.chdir(directory)
    assert.equal(defaultObjectStoragePath(), baseline)
  } finally {
    process.chdir(original)
    await rm(directory, { recursive: true, force: true })
  }
})

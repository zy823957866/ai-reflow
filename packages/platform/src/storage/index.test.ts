import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '@ai-reflow/core'
import {
  createObjectStorage,
  requireObjectStorage,
  type ObjectStorageConfig,
} from './index'

const config: ObjectStorageConfig = {
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1',
  bucket: 'ai-reflow',
  accessKeyId: 'miniokey',
  secretAccessKey: 'minio-secret',
  forcePathStyle: true,
}

test('creates an S3-compatible adapter when configuration is complete', () => {
  const storage = createObjectStorage(config)
  assert.ok(storage)
  assert.equal(typeof storage.putObject, 'function')
  assert.equal(typeof storage.getObject, 'function')
  assert.equal(typeof storage.deleteObject, 'function')
})

test('rejects operations when object storage is not configured', () => {
  assert.throws(
    () => requireObjectStorage(undefined),
    (error: unknown) => {
      assert.ok(error instanceof AppError)
      assert.equal(error.code, 'OBJECT_STORAGE_NOT_CONFIGURED')
      assert.equal(error.status, 503)
      assert.equal(error.retryable, true)
      return true
    },
  )
})

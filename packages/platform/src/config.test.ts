import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getObjectStorageConfig,
  loadEnvironment,
  type ServerEnvironment,
} from './config'

const baseEnvironment: Record<string, string> = {
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
  DEFAULT_WORKSPACE_ID: '00000000-0000-7000-8000-000000000001',
  ENCRYPTION_KEY: '0123456789abcdef',
}

function environment(source: Record<string, string>) {
  return {
    ...baseEnvironment,
    ...source,
  }
}

test('returns undefined when object storage is completely disabled', () => {
  const loaded = loadEnvironment(environment({}))
  assert.equal(getObjectStorageConfig(loaded), undefined)
})

test('returns a complete S3 configuration and defaults path-style on', () => {
  const loaded = loadEnvironment(environment({
    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_BUCKET: 'ai-reflow',
    S3_ACCESS_KEY_ID: 'minio',
    S3_SECRET_ACCESS_KEY: 'minio-secret',
  }))
  assert.deepEqual(getObjectStorageConfig(loaded), {
    endpoint: 'http://127.0.0.1:9000',
    region: 'us-east-1',
    bucket: 'ai-reflow',
    accessKeyId: 'minio',
    secretAccessKey: 'minio-secret',
    forcePathStyle: true,
  })
})

test('accepts AWS S3 without a custom endpoint and parses path-style false', () => {
  const loaded = loadEnvironment(environment({
    S3_REGION: 'eu-west-1',
    S3_BUCKET: 'ai-reflow-prod',
    S3_ACCESS_KEY_ID: 'access',
    S3_SECRET_ACCESS_KEY: 'secret',
    S3_FORCE_PATH_STYLE: 'false',
  }))
  assert.deepEqual(getObjectStorageConfig(loaded), {
    endpoint: undefined,
    region: 'eu-west-1',
    bucket: 'ai-reflow-prod',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
    forcePathStyle: false,
  })
})

test('rejects partial object storage configuration', () => {
  assert.throws(
    () => loadEnvironment(environment({ S3_BUCKET: 'ai-reflow' })),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /S3_ACCESS_KEY_ID/)
      return true
    },
  )
})

test('rejects an invalid force path style flag', () => {
  assert.throws(
    () => loadEnvironment(environment({
      S3_BUCKET: 'ai-reflow',
      S3_ACCESS_KEY_ID: 'access',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_FORCE_PATH_STYLE: 'yes',
    })),
    /S3_FORCE_PATH_STYLE/,
  )
})

test('exposes storage fields on the loaded environment type', () => {
  const loaded: ServerEnvironment = loadEnvironment(environment({
    S3_BUCKET: 'ai-reflow',
    S3_ACCESS_KEY_ID: 'access',
    S3_SECRET_ACCESS_KEY: 'secret',
  }))
  assert.equal(loaded.S3_BUCKET, 'ai-reflow')
})

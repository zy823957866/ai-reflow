import assert from 'node:assert/strict'
import test from 'node:test'
import type { KnowledgeDocument, UploadItem } from '../../../apps/web/src/pages/knowledge-page/types'
import {
  getUploadValidationError,
  isUploadBatchSettled,
  syncUploadBatchFromDocuments,
} from '../../../apps/web/src/pages/knowledge-page/uploadBatch'

test('sync keeps ready uploads visible while updating their status', () => {
  const upload = {
    id: 'upload_1',
    name: 'notes.txt',
    sizeLabel: '1 KB',
    progress: 50,
    stage: '向量化',
    status: 'processing',
    documentId: 'doc_1',
  } as UploadItem
  const document = {
    id: 'doc_1',
    kbId: 'kb_1',
    name: 'notes.txt',
    extension: 'txt',
    status: 'ready',
    progress: 100,
  } as KnowledgeDocument

  assert.deepEqual(syncUploadBatchFromDocuments([upload], [document]), [upload])
  assert.equal(upload.status, 'ready')
  assert.equal(upload.progress, 100)
})

test('upload batch stays open while one attachment is still processing', () => {
  const uploads = [
    {
      id: 'upload_ready',
      status: 'ready',
    },
    {
      id: 'upload_processing',
      status: 'processing',
    },
  ] as UploadItem[]

  assert.equal(isUploadBatchSettled(uploads), false)
})

test('upload batch settles when every attachment is ready or failed', () => {
  const uploads = [
    {
      id: 'upload_ready',
      status: 'ready',
    },
    {
      id: 'upload_failed',
      status: 'failed',
    },
  ] as UploadItem[]

  assert.equal(isUploadBatchSettled(uploads), true)
})

test('upload validation rejects unsupported file extensions', () => {
  assert.equal(
    getUploadValidationError({ name: 'script.exe', size: 1024 }),
    '格式不支持',
  )
})

test('upload validation rejects files larger than 50 MB', () => {
  assert.equal(
    getUploadValidationError({ name: 'manual.pdf', size: 50 * 1024 * 1024 + 1 }),
    '超过 50 MB',
  )
})

test('upload validation accepts supported files within the size limit', () => {
  assert.equal(
    getUploadValidationError({ name: 'manual.pdf', size: 50 * 1024 * 1024 }),
    undefined,
  )
})

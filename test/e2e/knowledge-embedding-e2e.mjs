import assert from 'node:assert/strict'

const apiBaseUrl = process.env.API_BASE_URL
  ?? `http://${process.env.API_HOST ?? '127.0.0.1'}:${process.env.API_PORT ?? '8787'}`
const stamp = Date.now().toString(36)
const marker = `EMBEDDING_E2E_${stamp}_ORBITAL_LANTERN`
const documentText = [
  `The integration marker is ${marker}.`,
  'This temporary document verifies that a TXT upload is parsed, chunked, embedded with Ollama, and retrieved through pgvector.',
  'The launch code for the fictional Aurora archive is cobalt-47.',
].join('\n')

let knowledgeBaseId
let documentId
let ingestJobId

try {
  const health = await request('/api/health')
  assert.equal(health.data.ok, true)
  assert.equal(health.data.database, 'up')

  const created = await request('/api/knowledge-bases', {
    method: 'POST',
    expectedStatus: [201],
    json: {
      name: `Embedding E2E ${stamp}`,
      description: 'Temporary knowledge base for the real embedding smoke test.',
    },
  })
  knowledgeBaseId = created.data.id
  assert.ok(knowledgeBaseId)
  assert.equal(created.data.embeddingModel, 'nomic-embed-text')
  assert.equal(created.data.dimensions, 768)

  const form = new FormData()
  form.append(
    'file',
    new Blob([documentText], { type: 'text/plain' }),
    `embedding-e2e-${stamp}.txt`,
  )
  const uploaded = await request(
    `/api/knowledge-bases/${knowledgeBaseId}/documents`,
    {
      method: 'POST',
      expectedStatus: [201],
      body: form,
    },
  )
  documentId = uploaded.data.document?.id
  ingestJobId = uploaded.data.job?.id
  assert.ok(documentId)
  assert.ok(ingestJobId)

  const job = await waitForIngestJob(ingestJobId)
  assert.equal(job.status, 'succeeded')
  assert.equal(job.stage, 'index')

  const document = await request(`/api/documents/${documentId}`)
  assert.equal(document.data.status, 'ready')
  assert.ok(document.data.chunks > 0)

  const stats = await request(`/api/knowledge-bases/${knowledgeBaseId}/stats`)
  assert.ok(stats.data.embeddedChunks > 0)
  assert.equal(stats.data.embeddedChunks, stats.data.chunks)

  for (const retrievalMode of ['vector', 'hybrid']) {
    const search = await request(
      `/api/knowledge-bases/${knowledgeBaseId}/search`,
      {
        method: 'POST',
        json: {
          query: marker,
          retrievalMode,
          topK: 3,
          scoreThreshold: 0,
        },
      },
    )
    assert.ok(search.data.chunks.length > 0)
    assert.equal(
      search.data.warnings.some((warning) =>
        String(warning).includes('EMBEDDING_UNAVAILABLE'),
      ),
      false,
    )
    const hit = search.data.chunks.find((chunk) =>
      chunk.snippet.includes(marker),
    )
    assert.ok(hit, `${retrievalMode} search did not return the uploaded chunk.`)
    assert.equal(typeof hit.vectorScore, 'number')
    assert.ok(hit.vectorScore >= 0)
    assert.ok(search.data.citations.length > 0)
  }

  console.log(
    `Knowledge embedding E2E passed: upload -> ingest -> vector/hybrid (${marker}).`,
  )
} finally {
  if (ingestJobId) {
    const job = await request(`/api/knowledge-ingest-jobs/${ingestJobId}`)
      .catch(() => undefined)
    if (job?.data?.status === 'queued' || job?.data?.status === 'running') {
      await request(`/api/knowledge-ingest-jobs/${ingestJobId}/cancel`, {
        method: 'POST',
      }).catch(() => undefined)
    }
  }
  if (documentId) {
    await request(`/api/documents/${documentId}`, {
      method: 'DELETE',
    }).catch(() => undefined)
  }
  if (knowledgeBaseId) {
    await request(`/api/knowledge-bases/${knowledgeBaseId}`, {
      method: 'DELETE',
    }).catch(() => undefined)
  }
}

async function waitForIngestJob(jobId) {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    const response = await request(`/api/knowledge-ingest-jobs/${jobId}`)
    const job = response.data
    if (job.status === 'succeeded') return job
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new Error(
        `Ingest ${job.status} at ${job.stage}: `
        + `${job.errorCode ?? 'UNKNOWN'} ${job.errorMessage ?? ''}`.trim(),
      )
    }
    await sleep(1000)
  }
  throw new Error(`Ingest job ${jobId} did not finish within 180 seconds.`)
}

async function request(path, options = {}) {
  const {
    method = 'GET',
    expectedStatus = [200],
    json,
    body,
  } = options
  const payload = body ?? (
    json === undefined ? undefined : JSON.stringify(json)
  )
  const headers = {
    Accept: 'application/json',
    ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: payload,
  })
  const text = await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!expectedStatus.includes(response.status)) {
    throw new Error(
      `${method} ${path} returned ${response.status}, expected `
      + `${expectedStatus.join('/')}: ${JSON.stringify(data)}`,
    )
  }
  return { status: response.status, data }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

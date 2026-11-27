import assert from 'node:assert/strict'
import test from 'node:test'
import { runRolePool } from '../../../apps/worker/src/roles/role-pool'

test('role pool honors concurrency and drains active jobs after abort', async () => {
  const controller = new AbortController()
  let next = 1
  let active = 0
  let maxActive = 0
  let completed = 0

  await runRolePool({
    concurrency: 2,
    pollIntervalMs: 5,
    signal: controller.signal,
    async claim() {
      return next <= 4 ? { id: next++ } : null
    },
    async execute() {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active -= 1
      completed += 1
      if (completed === 4) controller.abort()
    },
  })

  assert.equal(maxActive, 2)
  assert.equal(completed, 4)
})

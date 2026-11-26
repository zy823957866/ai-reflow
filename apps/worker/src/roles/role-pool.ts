export interface RolePoolOptions<Job> {
  concurrency: number
  pollIntervalMs: number
  signal: AbortSignal
  claim(): Promise<Job | null>
  execute(job: Job): Promise<void>
  onError?(error: unknown, phase: 'claim' | 'execute'): void
}

/**
 * 以固定并发运行一个 worker 角色，停止时等待在途任务结束。
 * @param options 角色领取与执行函数。
 */
export async function runRolePool<Job>(options: RolePoolOptions<Job>) {
  const concurrency = Math.max(1, Math.floor(options.concurrency))
  const workers = Array.from({ length: concurrency }, async () => {
    while (!options.signal.aborted) {
      let job: Job | null
      try {
        job = await options.claim()
      } catch (error) {
        options.onError?.(error, 'claim')
        await delay(options.pollIntervalMs, options.signal)
        continue
      }
      if (!job) {
        await delay(options.pollIntervalMs, options.signal)
        continue
      }
      try {
        await options.execute(job)
      } catch (error) {
        options.onError?.(error, 'execute')
      }
    }
  })
  await Promise.all(workers)
}

function delay(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, milliseconds)
    signal.addEventListener('abort', done, { once: true })

    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

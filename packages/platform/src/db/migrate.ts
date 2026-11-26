import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvironment } from '../config'
import { createDatabase } from './client'

const migrationDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
)

/**
 * 计算迁移文件内容摘要。
 * @param content SQL 文本。
 * @returns 十六进制 SHA-256。
 */
function checksum(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * 按文件名顺序执行尚未应用的 SQL 迁移。
 *
 * 已执行迁移若文件摘要变化会立即失败，避免静默改写历史。
 *
 * @param databaseUrl PostgreSQL 连接串。
 * @returns 已应用与已跳过的迁移文件数量。
 */
export async function migrateDatabase(databaseUrl: string) {
  const { sql } = createDatabase(databaseUrl)
  try {
    await sql`
      create table if not exists schema_migrations (
        version text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `
    const files = (await readdir(migrationDirectory))
      .filter((file) => file.endsWith('.sql'))
      .sort((left, right) => left.localeCompare(right))
    let applied = 0
    let skipped = 0
    for (const file of files) {
      const content = await readFile(path.join(migrationDirectory, file), 'utf8')
      const digest = checksum(content)
      const [existing] = await sql<{ checksum: string }[]>`
        select checksum from schema_migrations where version = ${file}
      `
      if (existing) {
        if (existing.checksum !== digest) {
          throw new Error(`迁移 ${file} 已执行但文件内容发生变化`)
        }
        skipped += 1
        continue
      }
      await sql.begin(async (transaction) => {
        await transaction.unsafe(content)
        await transaction`
          insert into schema_migrations (version, checksum)
          values (${file}, ${digest})
        `
      })
      applied += 1
      console.log(`已应用迁移 ${file}`)
    }
    return { applied, skipped, total: files.length }
  } finally {
    await sql.end()
  }
}

/**
 * 命令行迁移入口。
 */
async function main() {
  const config = loadEnvironment()
  const result = await migrateDatabase(config.DATABASE_URL)
  console.log(`迁移完成：应用 ${result.applied} 个，跳过 ${result.skipped} 个`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

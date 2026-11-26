import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { schema } from './schema'

export type DatabaseClient = postgres.Sql<Record<string, never>>

/**
 * 创建 PostgreSQL 连接与 Drizzle 客户端。
 *
 * 业务 SQL 只允许出现在 Repository 或迁移/种子脚本中；Controller
 * 与前端永远不直接连接数据库。
 *
 * @param databaseUrl PostgreSQL 连接串。
 * @returns 原始 postgres.js 连接与 Drizzle 查询入口。
 */
export function createDatabase(databaseUrl: string) {
  const sql = postgres(databaseUrl, {
    max: 12,
    idle_timeout: 20,
    connect_timeout: 10,
  })
  const db = drizzle(sql, { schema })
  return { sql, db }
}

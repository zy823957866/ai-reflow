import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { AppError } from '@ai-reflow/core'
import { loadEnvironment } from '../../config'
import { jsonb, type Transaction } from './helpers'

/**
 * 将 secret:// 引用加密后保存为 workspace 凭据。
 *
 * 数据库只保存密文和掩码；同名引用可重复使用，不会覆盖已有密文。
 *
 * @param transaction 当前数据库事务。
 * @param workspaceId 当前 workspace 内部 ID。
 * @param secretRef 外部密钥引用。
 * @param input 凭据类型和展示来源。
 * @returns 凭据内部 ID。
 */
export async function resolveSecretReference(
  transaction: Transaction,
  workspaceId: string,
  secretRef: string,
  input: {
    kind?: 'api_key' | 'bearer' | 'basic' | 'oauth2' | 'hmac'
    source: string
  },
) {
  if (!secretRef.startsWith('secret://')) {
    throw new AppError({
      code: 'SECRET_REF_REQUIRED',
      message: '凭据只能通过 secret:// 引用保存。',
      status: 422,
    })
  }
  const name = secretRef.split('/').filter(Boolean).at(-1) ?? 'default'
  const [existing] = await transaction<Array<{ id: string }>>`
    select id
    from credentials
    where workspace_id = ${workspaceId}
      and name = ${name}
    limit 1
  `
  if (existing) return existing.id
  const encrypted = encryptSecretReference(secretRef)
  const [created] = await transaction<Array<{ id: string }>>`
    insert into credentials (
      workspace_id, name, kind, ciphertext, iv, auth_tag, key_version,
      masked_hint, metadata
    )
    values (
      ${workspaceId}, ${name}, ${input.kind ?? 'api_key'}, ${encrypted.ciphertext},
      ${encrypted.iv}, ${encrypted.authTag}, ${1},
      ${`${input.source} · •••• ${name.slice(-4).toUpperCase()}`},
      ${jsonb(transaction, { external: true, secretRefName: name })}
    )
    returning id
  `
  return created.id
}

/**
 * 将入站 MCP 访问令牌加密保存，并仅暴露摘要和掩码。
 *
 * @param transaction 当前数据库事务。
 * @param workspaceId 当前 workspace 内部 ID。
 * @param input 暴露 ID、令牌、作用域和可选过期时间。
 * @returns 凭据内部 ID、掩码与不可逆摘要。
 */
export async function storeInboundMcpToken(
  transaction: Transaction,
  workspaceId: string,
  input: {
    exposurePublicId: string
    token: string
    scopes: string[]
    expiresAt?: string | null
  },
) {
  const tokenHash = createHash('sha256').update(input.token).digest('hex')
  const name = `mcp-inbound-${input.exposurePublicId}-${randomBytes(4).toString('hex')}`
  const encrypted = encryptSecretReference(input.token)
  const maskedHint = `AI Reflow MCP · •••• ${input.token.slice(-4).toUpperCase()}`
  const [created] = await transaction<Array<{ id: string }>>`
    insert into credentials (
      workspace_id, name, kind, ciphertext, iv, auth_tag, key_version,
      masked_hint, metadata
    )
    values (
      ${workspaceId}, ${name}, ${'bearer'}, ${encrypted.ciphertext},
      ${encrypted.iv}, ${encrypted.authTag}, ${1}, ${maskedHint},
      ${jsonb(transaction, {
        external: false,
        type: 'mcp-inbound',
        exposurePublicId: input.exposurePublicId,
        tokenHash,
        scopes: input.scopes,
        expiresAt: input.expiresAt ?? null,
        revokedAt: null,
      })}
    )
    returning id
  `
  return {
    credentialId: created.id,
    maskedHint,
    tokenHash,
    name,
  }
}

/**
 * 使用 AES-256-GCM 加密 secret_ref。
 *
 * @param secretRef 只描述外部密钥位置的引用。
 * @returns 数据库 ciphertext、iv 和 auth tag。
 */
function encryptSecretReference(secretRef: string) {
  const key = createHash('sha256')
    .update(loadEnvironment().ENCRYPTION_KEY)
    .digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(secretRef, 'utf8'),
    cipher.final(),
  ]).toString('base64')
  return {
    ciphertext,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  }
}

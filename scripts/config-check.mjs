import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const compose = await readFile('infra/compose/docker-compose.yml', 'utf8')
const composeEnvironment = await readFile('infra/compose/.env.example', 'utf8')
const rootEnvironment = await readFile('.env.example', 'utf8')
const nginx = await readFile('infra/nginx/default.conf', 'utf8')
const composeReadme = await readFile('infra/compose/README.md', 'utf8')
const packageJson = JSON.parse(await readFile('package.json', 'utf8'))

const checks = [
  ['Compose defines MinIO service', /^\s{2}minio:\s*$/m.test(compose)],
  ['Compose defines bucket init service', /^\s{2}minio-init:\s*$/m.test(compose)],
  ['Compose persists MinIO data', /minio-data:\/data/.test(compose)],
  ['Compose declares minio-data volume', /^\s{2}minio-data:\s*$/m.test(compose)],
  ['Compose exposes MinIO only on loopback', /127\.0\.0\.1:\$\{MINIO_PORT:-9000\}:9000/.test(compose)],
  ['Compose passes S3 endpoint', /S3_ENDPOINT:\s*http:\/\/minio:9000/.test(compose)],
  ['Compose passes S3 bucket', /S3_BUCKET:\s*\$\{S3_BUCKET/.test(compose)],
  ['Compose passes S3 access key', /S3_ACCESS_KEY_ID:\s*\$\{S3_ACCESS_KEY_ID/.test(compose)],
  ['Compose passes S3 secret', /S3_SECRET_ACCESS_KEY:\s*\$\{S3_SECRET_ACCESS_KEY/.test(compose)],
  ['Compose passes path-style setting', /S3_FORCE_PATH_STYLE:/.test(compose)],
  ['Compose env example documents bucket', /^S3_BUCKET=/m.test(composeEnvironment)],
  ['Compose env example documents access key', /^S3_ACCESS_KEY_ID=/m.test(composeEnvironment)],
  ['Root env example documents S3 endpoint', /^S3_ENDPOINT=/m.test(rootEnvironment)],
  ['Nginx accepts 55 MiB uploads', /client_max_body_size\s+55m;/.test(nginx)],
  ['Nginx streams request bodies', /proxy_request_buffering\s+off;/.test(nginx)],
  ['Compose README documents MinIO', /MinIO/.test(composeReadme)],
  ['Compose README documents minio-data', /minio-data/.test(composeReadme)],
  ['Package exposes test:config', packageJson.scripts?.['test:config'] === 'node scripts/config-check.mjs'],
]

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name)
assert.deepEqual(failures, [], `配置检查失败：\n${failures.join('\n')}`)
console.log(`配置检查通过：${checks.length} 项`)

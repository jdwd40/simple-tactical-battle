import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--help') {
  console.log('npm run batch -- --seeds 1[,2,...] --out /tmp/tsb-batch [--limit 200] [--policies concealed-search,scan-search,pursuit-laser,predictive-missile]\nnpm run batch -- --replay /tmp/tsb-batch/pursuit-laser-seed-1.json\nAt most 5 seeds per policy; cutoff is diagnostic-only. See tools/batch/README.md.')
} else {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'tools/batch/vitest.config.ts', '--maxWorkers=1'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, TSB_BATCH_ARGS: JSON.stringify(args), TSB_BATCH_SOURCE: JSON.stringify({ revision, dirty }) },
  })
  if (result.error) { console.error(result.error.message); process.exitCode = 1 }
  else process.exitCode = result.status ?? 1
}

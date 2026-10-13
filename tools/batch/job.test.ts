import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { it } from 'vitest'
import { parseArguments } from './arguments'
import { runEncounter } from './encounter'
import { replayFile, writeArtifact } from './files'

it('runs the explicitly requested optional headless diagnostics', () => {
  if (!process.env.TSB_BATCH_ARGS || !process.env.TSB_BATCH_SOURCE) throw new Error('Use npm run batch -- ...')
  const request = parseArguments(JSON.parse(process.env.TSB_BATCH_ARGS) as string[])
  const source = JSON.parse(process.env.TSB_BATCH_SOURCE) as { revision: string; dirty: boolean }
  if (request.mode === 'replay') { console.log(JSON.stringify(replayFile(resolve(request.path)), null, 2)); return }
  const output = resolve(request.output)
  mkdirSync(output, { recursive: true })
  const metrics = []
  for (const policy of request.policies) for (const seed of request.seeds) {
    const artifact = runEncounter({ seed, policy, normalTurnLimit: request.limit, sourceRevision: source.revision, sourceDirty: source.dirty })
    const name = `${policy}-seed-${seed}.json`
    writeArtifact(join(output, name), artifact)
    // Verify every artifact immediately; a cutoff remains a diagnostic, never an outcome.
    const replay = replayFile(join(output, name))
    metrics.push({ ...artifact.metrics, reproduction: name, replayVerified: replay.verified })
    console.log(JSON.stringify({ seed, policy, status: artifact.metrics.status, outcome: artifact.metrics.outcome,
      normalTurns: artifact.metrics.normalTurns, automaticTurns: artifact.metrics.automaticTurns, fired: artifact.metrics.fired, rejections: artifact.metrics.rejections.length }))
  }
  writeFileSync(join(output, 'metrics.json'), JSON.stringify({ runMetadata: { outputDirectory: output }, runs: metrics }, null, 2) + '\n')
  console.log(`Metrics and exact private reproductions: ${output}`)
  if (metrics.some((m) => m.status === 'failure')) throw new Error('Diagnostic failure recorded; inspect reproduction files')
})

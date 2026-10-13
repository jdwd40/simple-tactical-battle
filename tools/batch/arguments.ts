import { POLICY_NAMES, type PolicyName } from './policies'
import { validateRunInput } from './encounter'

export type Request = { mode: 'replay'; path: string } | { mode: 'run'; seeds: number[]; policies: PolicyName[]; limit: number; output: string }
export function parseArguments(args: readonly string[]): Request {
  const values = new Map<string, string>()
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]
    const value = args[i + 1]
    if (!['--seeds', '--policies', '--limit', '--out', '--replay'].includes(flag) || !value || value.startsWith('--') || values.has(flag)) throw new Error(`Invalid or duplicate argument: ${flag}`)
    values.set(flag, value)
  }
  if (values.has('--replay')) {
    if (values.size !== 1) throw new Error('--replay cannot be combined with run arguments')
    return { mode: 'replay', path: values.get('--replay')! }
  }
  if (!values.has('--seeds') || !values.has('--out')) throw new Error('Specify --seeds 1[,2,...] and --out /tmp/task-directory')
  const seedText = values.get('--seeds')!.split(',')
  if (seedText.some((s) => !/^\d+$/.test(s))) throw new Error('Seeds must be comma-separated uint32 integers')
  const seeds = seedText.map(Number)
  if (seeds.length > 5 || new Set(seeds).size !== seeds.length) throw new Error('Provide 1..5 distinct seeds (at most 20 runs)')
  const limitText = values.get('--limit') ?? '200'
  if (!/^\d+$/.test(limitText)) throw new Error('Limit must be an integer')
  const limit = Number(limitText)
  for (const seed of seeds) validateRunInput(seed, limit)
  const names = (values.get('--policies') ?? POLICY_NAMES.join(',')).split(',')
  if (names.some((p) => !POLICY_NAMES.some((name) => name === p)) || new Set(names).size !== names.length) throw new Error(`Policies must be distinct names: ${POLICY_NAMES.join(',')}`)
  return { mode: 'run', seeds, policies: names as PolicyName[], limit, output: values.get('--out')! }
}

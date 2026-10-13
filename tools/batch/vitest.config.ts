import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { environment: 'node', include: ['tools/batch/job.test.ts'], maxWorkers: 1, testTimeout: 180_000 } })

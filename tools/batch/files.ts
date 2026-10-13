import { readFileSync, writeFileSync } from 'node:fs'
import type { Artifact } from './encounter'
import { replayArtifact } from './encounter'
import { diagnosticJSON, parseDiagnosticJSON } from './json'

export const writeArtifact = (path: string, artifact: Artifact) => writeFileSync(path, diagnosticJSON(artifact, 2) + '\n')
export const replayFile = (path: string) => replayArtifact(parseDiagnosticJSON(readFileSync(path, 'utf8')) as Artifact)

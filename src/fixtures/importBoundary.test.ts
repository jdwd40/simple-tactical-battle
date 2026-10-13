import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const src = resolve(root, 'src')
const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile)
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options

/** Authoritative modules: the private controller (src/game), engine and private contracts/scenarios. */
const AUTHORITY = /^(game\/|simulation\/|contracts\/private(?:\.|\/)|scenarios\/private(?:\.|\/))/
/** Presentation and public data: must never reach authority, directly or transitively. */
const PRESENTATION = /^(ui\/|rendering\/|ai\/|fixtures\/)/
/** Application composition roots: may import only the controller factory barrel. */
const COMPOSITION = /^(App\.tsx|main\.tsx)$/
const CONTROLLER_BARREL = 'game/index.ts'

interface ModuleHost {
  read(file: string): string
  /** Resolved absolute file for a specifier, or undefined when it cannot be resolved. */
  resolve(specifier: string, from: string): string | undefined
}

const fileHost: ModuleHost = {
  read: (file) => readFileSync(file, 'utf8'),
  resolve: (specifier, from) => ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule?.resolvedFileName,
}

/** Static, re-export, dynamic import(), require(), import type and import = require specifiers. */
function specifiers(file: string, text: string): string[] {
  const found: string[] = []
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const inspect = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text)
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) found.push(node.arguments[0].text)
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) found.push(node.argument.literal.text)
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) found.push(node.moduleReference.expression.text)
    ts.forEachChild(node, inspect)
  }
  inspect(source)
  return found
}

/** Every chain from a presentation root to authority, including through barrels and re-exports. */
function presentationViolations(srcRoot: string, roots: readonly string[], host: ModuleHost): string[] {
  const visited = new Set<string>()
  const violations: string[] = []
  const visit = (file: string, chain: readonly string[]) => {
    const path = relative(srcRoot, file)
    if (AUTHORITY.test(path)) {
      violations.push([...chain, path].join(' -> '))
      return
    }
    if (visited.has(file)) return
    visited.add(file)
    for (const specifier of specifiers(file, host.read(file))) {
      const resolved = host.resolve(specifier, file)
      if (resolved && !relative(srcRoot, resolved).startsWith('../')) visit(resolve(resolved), [...chain, path])
      else if (!resolved && specifier.startsWith('.') && !/\.(css|woff2)$/.test(specifier)) violations.push(`${path}: unresolved local import ${specifier} from ${dirname(file)}`)
    }
  }
  for (const file of roots) visit(file, [])
  return violations
}

/** Composition roots may reach authority only through the controller factory barrel. */
function compositionViolations(srcRoot: string, roots: readonly string[], host: ModuleHost): string[] {
  return roots.flatMap((file) => specifiers(file, host.read(file)).flatMap((specifier) => {
    const resolved = host.resolve(specifier, file)
    const path = resolved ? relative(srcRoot, resolve(resolved)) : null
    return path && AUTHORITY.test(path) && path !== CONTROLLER_BARREL ? [`${relative(srcRoot, file)} -> ${path}`] : []
  }))
}

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return productionFiles(path)
    return /\.(ts|tsx)$/.test(path) && !/\.(test|spec)\./.test(path) ? [path] : []
  })
}

describe('import boundary', () => {
  const files = productionFiles(src)
  const presentation = files.filter((file) => PRESENTATION.test(relative(src, file)))
  const composition = files.filter((file) => COMPOSITION.test(relative(src, file)))

  it('presentation, observer fixtures and AI cannot import authority, including through barrels', () => {
    expect(presentation.length).toBeGreaterThan(0)
    expect(presentationViolations(src, presentation, fileHost)).toEqual([])
  })

  it('App/main compose only the controller factory barrel, never engine or private modules directly', () => {
    expect(composition.map((file) => relative(src, file)).sort()).toEqual(['App.tsx', 'main.tsx'])
    expect(compositionViolations(src, composition, fileHost)).toEqual([])
    const appImports = specifiers('App.tsx', readFileSync(resolve(src, 'App.tsx'), 'utf8'))
      .map((specifier) => fileHost.resolve(specifier, resolve(src, 'App.tsx')))
      .filter((path): path is string => path !== undefined)
      .map((path) => relative(src, resolve(path)))
    expect(appImports).toContain(CONTROLLER_BARREL)
    expect(existsSync(resolve(src, CONTROLLER_BARREL))).toBe(true)
  })
})

describe('import boundary checker negative evidence', () => {
  const virtualSrc = '/virtual/src'
  function virtualHost(sources: Record<string, string>): ModuleHost {
    const files = new Map(Object.entries(sources).map(([path, text]) => [resolve(virtualSrc, path), text]))
    return {
      read: (file) => files.get(file) ?? '',
      resolve: (specifier, from) => {
        if (!specifier.startsWith('.')) return undefined
        const base = resolve(dirname(from), specifier)
        return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((candidate) => files.has(candidate))
      },
    }
  }
  const at = (path: string) => resolve(virtualSrc, path)

  it('reports a UI component that reaches the controller through a helper and barrel', () => {
    const host = virtualHost({
      'ui/Panel.tsx': "import { helper } from './helper'\nexport const Panel = helper",
      'ui/helper.ts': "export { createGameController as helper } from '../game'",
      'game/index.ts': "export { createGameController } from './createGameController'",
      'game/createGameController.ts': 'export const createGameController = 1',
    })
    expect(presentationViolations(virtualSrc, [at('ui/Panel.tsx')], host)).toEqual(['ui/Panel.tsx -> ui/helper.ts -> game/index.ts'])
  })

  it('reports dynamic imports, require and type-only imports of private modules from rendering and fixtures', () => {
    const host = virtualHost({
      'rendering/plot.ts': "export const load = () => import('../simulation')",
      'fixtures/frames.ts': "import type { Scenario } from '../contracts/private'\nconst x = require('../scenarios/private')",
      'simulation/index.ts': '',
      'contracts/private.ts': '',
      'scenarios/private.ts': '',
    })
    expect(presentationViolations(virtualSrc, [at('rendering/plot.ts'), at('fixtures/frames.ts')], host).sort()).toEqual([
      'fixtures/frames.ts -> contracts/private.ts',
      'fixtures/frames.ts -> scenarios/private.ts',
      'rendering/plot.ts -> simulation/index.ts',
    ])
  })

  it('allows App to import the controller barrel but not the engine, private contracts or game internals', () => {
    const host = virtualHost({
      'App.tsx': "import { createGameController } from './game'\nimport { resolveTurn } from './simulation'\nimport type { SimulationState } from './contracts/private'\nimport { x } from './game/createGameController'",
      'game/index.ts': '',
      'game/createGameController.ts': '',
      'simulation/index.ts': '',
      'contracts/private.ts': '',
    })
    expect(compositionViolations(virtualSrc, [at('App.tsx')], host)).toEqual([
      'App.tsx -> simulation/index.ts',
      'App.tsx -> contracts/private.ts',
      'App.tsx -> game/createGameController.ts',
    ])
  })
})

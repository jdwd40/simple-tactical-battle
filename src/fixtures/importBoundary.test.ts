import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const src = resolve(root, 'src')
const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile)
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return productionFiles(path)
    return /\.(ts|tsx)$/.test(path) && !/\.(test|spec)\./.test(path) ? [path] : []
  })
}

it('presentation, observer fixtures and AI cannot import hidden world modules, including through barrels', () => {
  const roots = productionFiles(src).filter((file) => /^(App\.tsx|main\.tsx|ui\/|rendering\/|ai\/|fixtures\/)/.test(relative(src, file)))
  const visited = new Set<string>()
  const violations: string[] = []
  const visitFile = (file: string, chain: readonly string[]) => {
    if (visited.has(file)) return
    visited.add(file)
    const path = relative(src, file)
    if (/^(contracts\/private(?:\.|\/)|scenarios\/private(?:\.|\/)|simulation\/)/.test(path)) {
      violations.push([...chain, path].join(' -> '))
      return
    }
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const inspect = (node: ts.Node) => {
      let specifier: string | undefined
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) specifier = node.argument.literal.text
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) specifier = node.moduleReference.expression.text
      if (specifier) {
        const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName
        if (resolved && relative(src, resolved).startsWith('../') === false) visitFile(resolve(resolved), [...chain, path])
        else if (!resolved && specifier.startsWith('.') && !/\.(css|woff2)$/.test(specifier)) violations.push(`${path}: unresolved local import ${specifier} from ${dirname(file)}`)
      }
      ts.forEachChild(node, inspect)
    }
    inspect(source)
  }
  for (const file of roots) visitFile(file, [])
  expect(roots.length).toBeGreaterThan(0)
  expect(violations).toEqual([])
})

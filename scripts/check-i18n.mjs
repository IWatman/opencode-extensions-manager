#!/usr/bin/env node
/*
 * Verifies that every UI locale keeps the English catalog's keys and {{placeholder}} sets.
 * Also flags accidental Cyrillic text outside the `ru` locale, matching the localization rules.
 *
 * `feat/locales-extra` is expected to replace or extend this with its own checker. Until then this
 * script is the source of truth and runs as part of `npm test`.
 */
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"
import ts from "typescript"

const root = path.resolve(import.meta.dirname, "..")
const guiDir = path.join(root, "src", "gui")
const i18nFile = path.join(guiDir, "i18n.ts")
const CYRILLIC = /[\u0400-\u04ff]/u
const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g

function parseTs(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text
  return undefined
}

function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literalText(node.left)
    const right = literalText(node.right)
    return left === undefined || right === undefined ? undefined : left + right
  }
  return undefined
}

function collectCatalog(object, label, issues) {
  const values = new Map()
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) {
      issues.push(`${label}: unsupported catalog entry (expected "key": "value")`)
      continue
    }
    const key = propertyName(property.name)
    if (!key) {
      issues.push(`${label}: unsupported catalog key`)
      continue
    }
    if (values.has(key)) issues.push(`${label}: duplicate key "${key}"`)
    const value = literalText(property.initializer)
    if (value === undefined) {
      issues.push(`${label}: "${key}" is not a string literal`)
      continue
    }
    values.set(key, value)
  }
  return values
}

async function readLocaleFile(file, locale, issues) {
  let text
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    issues.push(`${locale}: could not read ${file}: ${error instanceof Error ? error.message : String(error)}`)
    return new Map()
  }
  const source = parseTs(file, text)
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer)) {
        return collectCatalog(declaration.initializer, `${locale} (${path.relative(root, file)})`, issues)
      }
    }
  }
  issues.push(`${locale}: no exported catalog object found in ${path.relative(root, file)}`)
  return new Map()
}

async function readCatalogs(issues) {
  const text = await readFile(i18nFile, "utf8")
  const source = parseTs(i18nFile, text)
  const imports = new Map()
  let catalogObject

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text
      if (!specifier.startsWith(".")) continue
      const base = path.resolve(path.dirname(i18nFile), specifier)
      const file = existsSync(`${base}.ts`) ? `${base}.ts` : base
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) imports.set(element.name.text, file)
      }
      continue
    }
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === "catalog" &&
        declaration.initializer &&
        ts.isObjectLiteralExpression(declaration.initializer)
      ) {
        catalogObject = declaration.initializer
      }
    }
  }

  if (!catalogObject) throw new Error(`${path.relative(root, i18nFile)} does not declare a catalog object`)

  const catalogs = new Map()
  for (const property of catalogObject.properties) {
    let locale
    let initializer
    if (ts.isPropertyAssignment(property)) {
      locale = propertyName(property.name)
      initializer = property.initializer
      if (!locale) {
        issues.push("catalog: unsupported locale property")
        continue
      }
    } else if (ts.isShorthandPropertyAssignment(property)) {
      locale = property.name.text
      initializer = property.name
    } else {
      issues.push("catalog: unsupported locale entry")
      continue
    }

    if (ts.isObjectLiteralExpression(initializer)) {
      catalogs.set(locale, collectCatalog(initializer, `${locale} (i18n.ts)`, issues))
    } else if (ts.isIdentifier(initializer)) {
      const file = imports.get(initializer.text)
      if (!file) {
        issues.push(`${locale}: no locale module import for "${initializer.text}"`)
        continue
      }
      catalogs.set(locale, await readLocaleFile(file, locale, issues))
    } else {
      issues.push(`${locale}: locale value must be an object literal or an imported catalog`)
    }
  }
  return catalogs
}

function placeholders(value) {
  return new Set(Array.from(value.matchAll(PLACEHOLDER), (match) => match[1]))
}

export async function checkI18n() {
  const issues = []
  const catalogs = await readCatalogs(issues)
  const english = catalogs.get("en")
  if (!english) {
    issues.push("catalog: the en locale is missing")
    return { issues, stats: { locales: catalogs.size, keys: 0 } }
  }

  const englishPlaceholders = new Map(
    Array.from(english, ([key, value]) => [key, placeholders(value)]),
  )

  for (const [locale, values] of catalogs) {
    if (locale === "en") continue
    for (const key of english.keys()) {
      if (!values.has(key)) issues.push(`${locale}: missing key "${key}"`)
    }
    for (const key of values.keys()) {
      if (!english.has(key)) issues.push(`${locale}: extra key "${key}"`)
    }
    for (const [key, value] of values) {
      const expected = englishPlaceholders.get(key)
      if (expected) {
        const actual = placeholders(value)
        const missing = [...expected].filter((placeholder) => !actual.has(placeholder))
        const extra = [...actual].filter((placeholder) => !expected.has(placeholder))
        if (missing.length > 0) {
          issues.push(`${locale}: "${key}" is missing placeholder(s): ${missing.join(", ")}`)
        }
        if (extra.length > 0) {
          issues.push(`${locale}: "${key}" has extra placeholder(s): ${extra.join(", ")}`)
        }
      }
      if (locale !== "ru" && CYRILLIC.test(value)) {
        issues.push(`${locale}: "${key}" contains Cyrillic text outside the ru locale`)
      }
    }
  }

  return { issues, stats: { locales: catalogs.size, keys: english.size } }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  try {
    const { issues, stats } = await checkI18n()
    if (issues.length > 0) {
      console.error(`i18n failed with ${issues.length} issue(s):`)
      for (const issue of issues) console.error(`  - ${issue}`)
      process.exitCode = 1
    } else {
      console.log(`i18n ok: ${stats.keys} keys across ${stats.locales} locales`)
    }
  } catch (error) {
    console.error(`i18n check failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    process.exitCode = 1
  }
}

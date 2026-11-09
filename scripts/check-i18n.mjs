#!/usr/bin/env node
/**
 * Verifies localization parity between the English catalog in src/gui/i18n.ts
 * and every catalog in src/gui/locales/*.ts.
 *
 * Checks:
 *  - every locale has every English key;
 *  - no duplicate keys;
 *  - every {{placeholder}} set matches English for each key;
 *  - src/gui/i18n.ts imports and registers every locale file;
 *  - only the ru and uk catalogs contain Cyrillic text.
 *
 * Missing keys are always errors; the runtime English fallback is only a safety net.
 *
 * The catalogs are parsed as plain object literals so the script does not
 * depend on TypeScript compilation or on a specific Node.js version.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const i18nPath = path.join(root, "src", "gui", "i18n.ts")
const localesDir = path.join(root, "src", "gui", "locales")

const errors = []
const fail = (message) => errors.push(message)

function skipWhitespace(source, index) {
  while (index < source.length && /\s/.test(source[index])) index += 1
  return index
}

function readString(source, index) {
  if (source[index] !== '"') throw new Error(`expected a string at offset ${index}`)
  let escaped = false
  for (let i = index + 1; i < source.length; i += 1) {
    const char = source[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === '"') {
      const raw = source.slice(index, i + 1)
      return { value: JSON.parse(raw), end: i + 1 }
    }
  }
  throw new Error(`unterminated string at offset ${index}`)
}

function findObjectStart(source, marker) {
  const markerIndex = source.indexOf(marker)
  if (markerIndex === -1) throw new Error(`could not find ${JSON.stringify(marker)}`)
  const start = source.indexOf("{", markerIndex)
  if (start === -1) throw new Error(`could not find the object after ${JSON.stringify(marker)}`)
  return start
}

function findObjectEnd(source, start) {
  let depth = 0
  for (let i = start; i < source.length; i += 1) {
    const char = source[i]
    if (char === '"') {
      i = readString(source, i).end - 1
      continue
    }
    if (char === "{") depth += 1
    if (char === "}") {
      depth -= 1
      if (depth === 0) return i
    }
  }
  throw new Error(`unterminated object starting at offset ${start}`)
}

/** Parses an object literal of the form { "key": "value", ... }. */
function parseCatalog(source, marker) {
  const start = findObjectStart(source, marker)
  const end = findObjectEnd(source, start)
  const entries = new Map()
  const duplicates = new Set()
  let index = start + 1

  while (index < end) {
    index = skipWhitespace(source, index)
    if (index >= end || source[index] === "}") break
    if (source[index] === ",") {
      index += 1
      continue
    }
    if (source[index] !== '"') throw new Error(`expected a key at offset ${index}`)

    const key = readString(source, index)
    index = skipWhitespace(source, key.end)
    if (source[index] !== ":") throw new Error(`expected ":" after key ${key.value}`)
    index = skipWhitespace(source, index + 1)

    let value
    if (source[index] !== '"') {
      throw new Error(`expected a string value for key ${key.value}`)
    }

    const first = readString(source, index)
    value = first.value
    index = skipWhitespace(source, first.end)
    // Allow implicit concatenation written as "part" + "part".
    while (source[index] === "+") {
      index = skipWhitespace(source, index + 1)
      const next = readString(source, index)
      value += next.value
      index = skipWhitespace(source, next.end)
    }

    if (entries.has(key.value)) duplicates.add(key.value)
    entries.set(key.value, value)
  }

  return { entries, duplicates }
}

function placeholders(value) {
  return [...new Set([...value.matchAll(/\{\{[^{}]+\}\}/g)].map((match) => match[0]))].sort()
}

function describe(list) {
  return list.length === 0 ? "none" : list.join(", ")
}

// --- English catalog -------------------------------------------------------

const i18nSource = fs.readFileSync(i18nPath, "utf8")
let english
try {
  english = parseCatalog(i18nSource, "en: {")
} catch (error) {
  console.error(`check:i18n: cannot parse the English catalog: ${error.message}`)
  process.exit(1)
}

const englishKeys = [...english.entries.keys()]
const englishKeySet = new Set(englishKeys)

if (english.duplicates.size > 0) {
  fail(`src/gui/i18n.ts: en: duplicate keys: ${describe([...english.duplicates])}`)
}

function checkCatalog(label, catalog, { allowCyrillic = false } = {}) {
  const keys = [...catalog.entries.keys()]
  const keySet = new Set(keys)
  const missing = englishKeys.filter((key) => !keySet.has(key))
  const extra = keys.filter((key) => !englishKeySet.has(key))
  const duplicates = [...catalog.duplicates]

  if (missing.length > 0) fail(`${label}: missing keys: ${describe(missing)}`)
  if (extra.length > 0) fail(`${label}: extra keys: ${describe(extra)}`)
  if (duplicates.length > 0) fail(`${label}: duplicate keys: ${describe(duplicates)}`)

  for (const key of keys) {
    if (!englishKeySet.has(key)) continue
    const expected = placeholders(english.entries.get(key))
    const actual = placeholders(catalog.entries.get(key))
    if (expected.join("\u0000") !== actual.join("\u0000")) {
      fail(
        `${label}: ${key}: placeholders [${describe(actual)}] do not match English [${describe(expected)}]`,
      )
    }
  }

  if (!allowCyrillic) {
    const cyrillic = [...catalog.entries.values()].filter((value) => /[\u0400-\u04FF]/.test(value))
    if (cyrillic.length > 0) {
      fail(`${label}: contains Cyrillic text outside the ru/uk catalogs`)
    }
  }
}

// --- Locale catalogs -------------------------------------------------------

const localeFiles = fs
  .readdirSync(localesDir)
  .filter((file) => file.endsWith(".ts"))
  .sort()

if (localeFiles.length === 0) fail("no locale files found in src/gui/locales")

const localeVariables = new Map()
let translatedEntries = 0

for (const file of localeFiles) {
  const name = path.basename(file, ".ts")
  const source = fs.readFileSync(path.join(localesDir, file), "utf8")
  localeVariables.set(name, file)

  let catalog
  try {
    catalog = parseCatalog(source, "= {")
  } catch (error) {
    fail(`${file}: cannot parse catalog: ${error.message}`)
    continue
  }

  translatedEntries += catalog.entries.size
  checkCatalog(file, catalog, { allowCyrillic: name === "uk" })
}

// The Russian catalog is inline in src/gui/i18n.ts.
try {
  const russian = parseCatalog(i18nSource, "ru: {")
  translatedEntries += russian.entries.size
  checkCatalog("src/gui/i18n.ts: ru", russian, { allowCyrillic: true })
} catch (error) {
  fail(`src/gui/i18n.ts: cannot parse the Russian catalog: ${error.message}`)
}

// --- Registration in src/gui/i18n.ts ---------------------------------------

const imported = new Map()
for (const match of i18nSource.matchAll(
  /import\s*\{\s*([A-Za-z0-9_$]+)\s*\}\s*from\s*"\.\/locales\/([^"]+)"/g,
)) {
  imported.set(match[1], match[2])
}

const catalogMarker = "export const catalog: Catalog = {"
const catalogStart = i18nSource.indexOf(catalogMarker)
if (catalogStart === -1) {
  fail("src/gui/i18n.ts: cannot find the catalog declaration")
} else {
  const bodyStart = catalogStart + catalogMarker.length
  const bodyEnd = findObjectEnd(i18nSource, bodyStart - 1)
  const catalogBody = i18nSource.slice(bodyStart, bodyEnd)

  for (const [name, file] of localeVariables.entries()) {
    if (imported.get(name) !== name) {
      fail(`src/gui/i18n.ts: ${file} is not imported as "${name}" from "./locales/${name}"`)
    }
    const registered = new RegExp(`(?:^|\\n)\\s*${name}\\s*,?\\s*(?:\\n|$)`).test(catalogBody)
    if (!registered) fail(`src/gui/i18n.ts: locale "${name}" is not registered in the catalog`)
  }

  for (const [variable, target] of imported.entries()) {
    if (!localeVariables.has(target)) {
      fail(`src/gui/i18n.ts: imports "./locales/${target}", but the file does not exist`)
    }
    if (variable !== target) {
      fail(`src/gui/i18n.ts: import name "${variable}" does not match the file "${target}"`)
    }
  }
}

// --- Result ----------------------------------------------------------------

if (errors.length > 0) {
  console.error(`check:i18n: ${errors.length} problem(s) found`)
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log(
  `check:i18n: ${localeFiles.length} locales, ${englishKeys.length} English keys, ` +
    `${translatedEntries} translated entries, all checks passed`,
)

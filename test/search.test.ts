import assert from "node:assert/strict"
import test from "node:test"
import type { ManagerState, MarketplacePlugin } from "../src/rpc.ts"
import {
  buildSearchRecords,
  groupSearchResults,
  matchesSearchFilter,
  normalizeSearchText,
  searchRecords,
} from "../src/gui/search.ts"

const scopeInfo = {
  root: "/home/user/.config/opencode",
  configDir: "/home/user/.config/opencode",
  configPath: "/home/user/.config/opencode/opencode.json",
  configExists: true,
  skillsDir: "/home/user/.config/opencode/skills",
}

const state = {
  global: scopeInfo,
  project: {
    ...scopeInfo,
    root: "/work/project",
    configDir: "/work/project/.opencode",
    configPath: "/work/project/.opencode/opencode.json",
    skillsDir: "/work/project/.opencode/skills",
  },
  mcp: [
    {
      scope: "global",
      name: "github",
      config: { type: "remote", url: "https://api.github.com/mcp" },
    },
    {
      scope: "project",
      name: "files",
      config: { type: "local", command: ["npx", "-y", "server-filesystem", "C:\\work"] },
    },
  ],
  plugins: [
    {
      scope: "global",
      index: 0,
      raw: "@acme/tools",
      package: "@acme/tools",
      options: { token: "secret-value" },
      removal: false,
    },
    {
      scope: "global",
      index: 1,
      raw: "-old-plugin",
      package: "old-plugin",
      removal: true,
    },
  ],
  skills: [
    {
      scope: "global",
      id: "pdf-tools",
      name: "PDF Tools",
      description: "Work with PDF files",
      path: "/home/user/.config/opencode/skills/pdf-tools/SKILL.md",
      dir: "/home/user/.config/opencode/skills/pdf-tools",
      kind: "dir",
      disabled: false,
      content: "---",
    },
    {
      scope: "global",
      id: "cafe-helper",
      name: "Café Helper",
      description: "Coffee order notes",
      path: "/home/user/.config/opencode/skills/cafe-helper/SKILL.md",
      dir: "/home/user/.config/opencode/skills/cafe-helper",
      kind: "dir",
      disabled: true,
      content: "---",
    },
  ],
  diagnostics: [],
  marketplaces: [
    {
      id: "official",
      name: "Official Anthropic",
      description: "Claude plugins",
      url: "https://github.com/anthropics/claude-plugins-official",
      builtin: true,
    },
  ],
  installedPlugins: [
    {
      key: "official/context7",
      marketplace: "official",
      marketplaceName: "Official Anthropic",
      plugin: "context7",
      displayName: "Context7 Docs",
      description: "Up-to-date library docs",
      scope: "global",
      enabled: true,
      installedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      mcp: ["context7"],
      skills: [],
      plugins: [],
      unsupported: [],
    },
  ],
} as unknown as ManagerState

const catalogs: Record<string, readonly MarketplacePlugin[]> = {
  official: [
    {
      marketplace: "official",
      name: "context7",
      displayName: "Context7",
      description: "Documentation lookup service",
      author: "Upstash",
      category: "docs",
      homepage: "https://context7.com",
    },
    {
      marketplace: "official",
      name: "pdf-master",
      displayName: "PDF Master",
      description: "Fill and split PDF files",
    },
  ],
}

test("buildSearchRecords indexes every manager source", () => {
  const records = buildSearchRecords(state, catalogs)
  const categories = new Set(records.map((record) => record.category))

  assert.deepEqual([...categories].sort(), ["catalog", "installed", "marketplace", "mcp", "plugins", "skills"])
  assert.equal(records.find((record) => record.title === "github")?.elementId, "oem-mcp-global-github")
  assert.equal(
    records.find((record) => record.title === "@acme/tools")?.elementId,
    "oem-plugin-global-0",
  )
  assert.equal(records.find((record) => record.title === "PDF Tools")?.elementId, "oem-skill-global-pdf-tools")
  assert.equal(
    records.find((record) => record.title === "Official Anthropic")?.elementId,
    "oem-marketplace-official",
  )
  assert.equal(
    records.find((record) => record.title === "Context7" && record.category === "catalog")?.elementId,
    "oem-catalog-official/context7",
  )
  assert.equal(records.find((record) => record.title === "Context7 Docs")?.elementId, "oem-installed-official/context7")
})

test("searchRecords matches names, commands, options, URLs, descriptions and artifacts", () => {
  const records = buildSearchRecords(state, catalogs)

  assert.deepEqual(searchRecords(records, "github").map((record) => record.title).slice(0, 2), [
    "github",
    "Official Anthropic",
  ])
  assert.equal(searchRecords(records, "server-filesystem work")[0]?.title, "files")
  assert.equal(searchRecords(records, "secret-value")[0]?.title, "@acme/tools")
  assert.equal(searchRecords(records, "pdf-tools")[0]?.title, "PDF Tools")
  assert.equal(searchRecords(records, "up-to-date docs")[0]?.title, "Context7 Docs")
  assert.equal(searchRecords(records, "anthropics github")[0]?.title, "Official Anthropic")
  assert.equal(searchRecords(records, "fill split")[0]?.title, "PDF Master")
})

test("searchRecords is case- and accent-insensitive", () => {
  const records = buildSearchRecords(state, catalogs)
  assert.equal(normalizeSearchText("Café"), "cafe")
  assert.equal(searchRecords(records, "CAFE")[0]?.title, "Café Helper")
})

test("searchRecords applies category filters", () => {
  const records = buildSearchRecords(state, catalogs)

  assert.deepEqual(
    searchRecords(records, "context7", "mcp").map((record) => record.title),
    [],
  )
  assert.deepEqual(
    searchRecords(records, "context7", "marketplaces").map((record) => record.title),
    ["Context7", "Context7 Docs"],
  )
  assert.deepEqual(
    searchRecords(records, "pdf", "skills").map((record) => record.title),
    ["PDF Tools"],
  )
  assert.equal(matchesSearchFilter("installed", "marketplaces"), true)
  assert.equal(matchesSearchFilter("installed", "plugins"), false)
})

test("empty or blank queries return no matches", () => {
  const records = buildSearchRecords(state, catalogs)
  assert.deepEqual(searchRecords(records, ""), [])
  assert.deepEqual(searchRecords(records, "   "), [])
})

test("groupSearchResults keeps category order and caps each group", () => {
  const records = buildSearchRecords(state, catalogs)
  const matches = searchRecords(records, "pdf")
  const groups = groupSearchResults(matches, 1)

  assert.deepEqual(
    groups.map((group) => group.category),
    ["skills", "catalog"],
  )
  assert.equal(groups[0]?.items.length, 1)
  assert.equal(groups[0]?.total, 1)
  assert.equal(groups[1]?.total, 1)

  const broad = groupSearchResults(records, 2)
  const mcp = broad.find((group) => group.category === "mcp")
  assert.equal(mcp?.items.length, 2)
  assert.equal(mcp?.total, 2)
})

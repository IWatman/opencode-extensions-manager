/**
 * Pure search index helpers for the global search field. They only depend on the RPC state
 * types, so they can be unit-tested without a running OpenCode app.
 */
import type { ManagerState, MarketplacePlugin, Scope } from "../rpc"
import { formatJson, mcpSummary } from "./helpers.ts"

export type SearchCategory = "mcp" | "plugins" | "skills" | "marketplace" | "catalog" | "installed"
export type SearchFilter = "all" | "mcp" | "plugins" | "skills" | "marketplaces"
export type SearchTab = "mcp" | "plugins" | "skills" | "marketplaces"

export interface SearchFocus {
  readonly kind: "catalog"
  readonly marketplace: string
  readonly plugin: string
  readonly elementId: string
  readonly nonce: number
}

export interface SearchRecord {
  readonly id: string
  readonly category: SearchCategory
  readonly title: string
  readonly subtitle?: string
  readonly keywords: readonly string[]
  readonly tab: SearchTab
  /** Element id of the list row that should be revealed after switching tabs. */
  readonly elementId: string
  readonly scope?: Scope
  /** Marketplace id for catalog and installed records. */
  readonly marketplace?: string
  /** Plugin name for catalog records. */
  readonly plugin?: string
}

export interface SearchGroup {
  readonly category: SearchCategory
  readonly items: readonly SearchRecord[]
  readonly total: number
}

export const searchCategoryOrder: readonly SearchCategory[] = [
  "mcp",
  "plugins",
  "skills",
  "marketplace",
  "catalog",
  "installed",
]

const filterCategories: Record<Exclude<SearchFilter, "all">, readonly SearchCategory[]> = {
  mcp: ["mcp"],
  plugins: ["plugins"],
  skills: ["skills"],
  marketplaces: ["marketplace", "catalog", "installed"],
}

export function matchesSearchFilter(category: SearchCategory, filter: SearchFilter) {
  if (filter === "all") return true
  return filterCategories[filter].includes(category)
}

export function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
}

function optionsText(options: unknown) {
  if (options === undefined) return ""
  if (typeof options === "string") return options
  try {
    return JSON.stringify(options)
  } catch {
    return formatJson(options)
  }
}

/** Flattens every searchable list in the manager state into compact records. */
export function buildSearchRecords(
  state: ManagerState,
  catalogs: Readonly<Record<string, readonly MarketplacePlugin[]>> = {},
): SearchRecord[] {
  const records: SearchRecord[] = []

  for (const entry of state.mcp) {
    const summary = mcpSummary(entry.config)
    records.push({
      id: `mcp:${entry.scope}:${entry.name}`,
      category: "mcp",
      title: entry.name,
      ...(summary ? { subtitle: summary } : {}),
      keywords: [entry.name, summary, entry.scope, "mcp"],
      scope: entry.scope,
      tab: "mcp",
      elementId: `oem-mcp-${entry.scope}-${entry.name}`,
    })
  }

  for (const entry of state.plugins) {
    const options = optionsText(entry.options)
    const title = entry.removal ? `-${entry.package}` : entry.package
    records.push({
      id: `plugin:${entry.scope}:${entry.index}`,
      category: "plugins",
      title: title || `#${entry.index}`,
      ...(options ? { subtitle: options } : {}),
      keywords: [entry.package, options, entry.scope, entry.removal ? "removal" : "plugin"],
      scope: entry.scope,
      tab: "plugins",
      elementId: `oem-plugin-${entry.scope}-${entry.index}`,
    })
  }

  for (const entry of state.skills) {
    records.push({
      id: `skill:${entry.scope}:${entry.id}`,
      category: "skills",
      title: entry.name || entry.id,
      ...(entry.description ? { subtitle: entry.description } : {}),
      keywords: [entry.id, entry.name, entry.description ?? "", entry.path, entry.scope, "skill"],
      scope: entry.scope,
      tab: "skills",
      elementId: `oem-skill-${entry.scope}-${entry.id}`,
    })
  }

  for (const marketplace of state.marketplaces) {
    records.push({
      id: `marketplace:${marketplace.id}`,
      category: "marketplace",
      title: marketplace.name,
      ...(marketplace.description ? { subtitle: marketplace.description } : {}),
      keywords: [marketplace.id, marketplace.name, marketplace.url, marketplace.description ?? "", marketplace.owner ?? ""],
      tab: "marketplaces",
      elementId: `oem-marketplace-${marketplace.id}`,
      marketplace: marketplace.id,
    })
  }

  const marketplaceNames = new Map(state.marketplaces.map((marketplace) => [marketplace.id, marketplace.name]))
  for (const [marketplace, plugins] of Object.entries(catalogs)) {
    const marketplaceName = marketplaceNames.get(marketplace) ?? marketplace
    for (const plugin of plugins) {
      records.push({
        id: `catalog:${marketplace}:${plugin.name}`,
        category: "catalog",
        title: plugin.displayName ?? plugin.name,
        ...(plugin.description ? { subtitle: plugin.description } : {}),
        keywords: [
          plugin.name,
          plugin.displayName ?? "",
          plugin.description ?? "",
          plugin.author ?? "",
          plugin.category ?? "",
          plugin.homepage ?? "",
          marketplaceName,
          marketplace,
        ],
        tab: "marketplaces",
        elementId: `oem-catalog-${marketplace}/${plugin.name}`,
        marketplace,
        plugin: plugin.name,
      })
    }
  }

  for (const item of state.installedPlugins) {
    records.push({
      id: `installed:${item.key}`,
      category: "installed",
      title: item.displayName ?? item.plugin,
      ...(item.description ? { subtitle: item.description } : {}),
      keywords: [
        item.key,
        item.plugin,
        item.displayName ?? "",
        item.description ?? "",
        item.marketplace,
        item.marketplaceName,
        item.project ?? "",
        item.version ?? "",
        ...item.mcp,
        ...item.skills,
        ...item.plugins,
      ],
      scope: item.scope,
      tab: "marketplaces",
      elementId: `oem-installed-${item.key}`,
      marketplace: item.marketplace,
      plugin: item.plugin,
    })
  }

  return records
}

function queryTokens(query: string) {
  return normalizeSearchText(query).split(/\s+/).filter(Boolean)
}

function scoreRecord(record: SearchRecord, tokens: readonly string[]) {
  const title = normalizeSearchText(record.title)
  const subtitle = normalizeSearchText(record.subtitle ?? "")
  const keywords = normalizeSearchText(record.keywords.join(" "))
  let score = 0

  for (const token of tokens) {
    if (title.includes(token)) score += 4
    else if (subtitle.includes(token)) score += 2
    else if (keywords.includes(token)) score += 1
    else return -1
  }

  if (tokens[0] && title.startsWith(tokens[0])) score += 3
  return score
}

/** Returns records matching every query token, best matches first. */
export function searchRecords(
  records: readonly SearchRecord[],
  query: string,
  filter: SearchFilter = "all",
  limit = Number.POSITIVE_INFINITY,
): SearchRecord[] {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return []

  return records
    .filter((record) => matchesSearchFilter(record.category, filter))
    .map((record) => ({ record, score: scoreRecord(record, tokens) }))
    .filter((hit) => hit.score >= 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.record.title.localeCompare(right.record.title, undefined, {
          sensitivity: "base",
          numeric: true,
        }),
    )
    .slice(0, limit)
    .map((hit) => hit.record)
}

/** Groups already-ranked matches in category order and caps each group for the compact panel. */
export function groupSearchResults(
  records: readonly SearchRecord[],
  limitPerGroup = 8,
): SearchGroup[] {
  const grouped = new Map<SearchCategory, SearchRecord[]>()
  for (const record of records) {
    const list = grouped.get(record.category) ?? []
    list.push(record)
    grouped.set(record.category, list)
  }

  return searchCategoryOrder.flatMap((category) => {
    const items = grouped.get(category)
    if (!items || items.length === 0) return []
    return [{ category, items: items.slice(0, limitPerGroup), total: items.length }]
  })
}

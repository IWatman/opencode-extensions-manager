import { For, Show } from "solid-js"
import type { GuiContext } from "./helpers"
import type { SearchCategory, SearchFilter, SearchGroup, SearchRecord } from "./search"

const filterValues: readonly SearchFilter[] = ["all", "mcp", "plugins", "skills", "marketplaces"]
const filterKey: Record<SearchFilter, string> = {
  all: "search.filter.all",
  mcp: "search.filter.mcp",
  plugins: "search.filter.plugins",
  skills: "search.filter.skills",
  marketplaces: "search.filter.marketplaces",
}

const groupKey: Record<SearchCategory, string> = {
  mcp: "search.group.mcp",
  plugins: "search.group.plugins",
  skills: "search.group.skills",
  marketplace: "search.group.marketplace",
  catalog: "search.group.catalog",
  installed: "search.group.installed",
}

/** Compact grouped results shown above the Overview widgets while a search is active. */
export function SearchPanel(props: {
  ctx: GuiContext
  query: string
  filter: SearchFilter
  groups: readonly SearchGroup[]
  loading: boolean
  catalogError?: boolean
  onFilter: (filter: SearchFilter) => void
  onPick: (record: SearchRecord) => void
}) {
  const ctx = props.ctx
  const total = () => props.groups.reduce((count, group) => count + group.total, 0)

  return (
    <div class="oem-search-panel" role="region" aria-label={ctx.t("search.label")}>
      <div class="oem-search-panel-head">
        <span class="oem-search-count">{ctx.t("search.results", { count: total() })}</span>
        <ctx.ui.Select
          label={ctx.t("search.filter")}
          value={props.filter}
          options={filterValues.map((value) => ({ value, label: ctx.t(filterKey[value]) }))}
          onChange={(value) => props.onFilter(value as SearchFilter)}
        />
      </div>

      <Show when={props.loading}>
        <span class="oem-hint">{ctx.t("search.loadingCatalogs")}</span>
      </Show>
      <Show when={props.catalogError && !props.loading}>
        <span class="oem-hint oem-error">{ctx.t("search.catalogError")}</span>
      </Show>

      <Show when={!props.loading && props.groups.length === 0}>
        <span class="oem-search-empty">{ctx.t("search.empty", { query: props.query.trim() })}</span>
      </Show>

      <For each={props.groups}>
        {(group) => (
          <div class="oem-search-group">
            <span class="oem-search-group-title">{ctx.t(groupKey[group.category])}</span>
            <For each={group.items}>
              {(record) => (
                <button type="button" class="oem-search-item" onClick={() => props.onPick(record)}>
                  <span class="oem-search-item-title">
                    <span>{record.title}</span>
                    <Show when={record.scope}>
                      <span class="oem-badge">
                        {ctx.t(record.scope === "global" ? "scope.global" : "scope.project")}
                      </span>
                    </Show>
                  </span>
                  <Show when={record.subtitle}>
                    <span class="oem-search-item-subtitle">{record.subtitle}</span>
                  </Show>
                </button>
              )}
            </For>
            <Show when={group.total > group.items.length}>
              <span class="oem-hint oem-search-more">
                {ctx.t("search.more", { count: group.total - group.items.length })}
              </span>
            </Show>
          </div>
        )}
      </For>
    </div>
  )
}

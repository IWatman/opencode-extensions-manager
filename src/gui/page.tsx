import { createEffect, createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import type { IconName } from "@opencode/plugin/gui"
import { ManagerRpc, type ManagerState, type MarketplacePlugin, type Scope } from "../rpc"
import { AboutSection } from "./about"
import { ClaudeImportSection } from "./claude"
import { DoctorSection } from "./doctor"
import { errorText, revealPath, runtimeStatus, type GuiContext } from "./helpers"
import { McpSection, type McpStatusMap } from "./mcp"
import { MarketplacesSection } from "./marketplaces"
import { PluginsSection } from "./plugins"
import {
  buildSearchRecords,
  groupSearchResults,
  searchRecords,
  type SearchFilter,
  type SearchFocus,
  type SearchRecord,
} from "./search"
import { SearchPanel } from "./search-panel"
import { SkillsSection } from "./skills"
import { autoCheckSelfUpdate, selfUpdateAvailable } from "./self-update-state"
import { SkeletonRows } from "./ui"
import { UpdatesSection } from "./updates"

type Tab = "overview" | "mcp" | "plugins" | "skills" | "marketplaces" | "about"

const tabOrder: readonly Tab[] = ["overview", "mcp", "plugins", "skills", "marketplaces", "about"]

interface TabItem {
  readonly id: Tab
  readonly label: string
  readonly icon: IconName
  readonly count?: number
  readonly warning?: boolean
}

function tabFromTarget(target?: string): Tab {
  if (!target || target === "extensions-manager" || target.startsWith("oem-scope")) return "overview"
  if (target.startsWith("oem-doctor")) return "about"
  if (target.startsWith("oem-about")) return "about"
  if (target.startsWith("oem-claude")) return "plugins"
  if (target.startsWith("oem-updates")) return "overview"
  if (target.startsWith("oem-mcp")) return "mcp"
  if (target.startsWith("oem-plugin")) return "plugins"
  if (target.startsWith("oem-skill")) return "skills"
  if (target.startsWith("oem-marketplace")) return "marketplaces"
  return "overview"
}

export function ExtensionsPage(props: { ctx: GuiContext; target?: string }) {
  const ctx = props.ctx
  const [state, setState] = createSignal<ManagerState>()
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [scope, setScope] = createSignal<Scope>("global")
  const [project, setProject] = createSignal<string | undefined>(ctx.sessions.current()?.location?.directory)
  const [busy, setBusy] = createSignal<string>()
  const [statuses, setStatuses] = createSignal<Record<Scope, McpStatusMap>>({ global: {}, project: {} })
  const [tab, setTab] = createSignal<Tab>(tabFromTarget(props.target))
  const [search, setSearch] = createSignal("")
  const [searchFilter, setSearchFilter] = createSignal<SearchFilter>("all")
  const [catalogs, setCatalogs] = createSignal<Record<string, readonly MarketplacePlugin[]>>({})
  const [catalogLoading, setCatalogLoading] = createSignal(false)
  const [catalogError, setCatalogError] = createSignal(false)
  const [catalogFocus, setCatalogFocus] = createSignal<SearchFocus>()
  const catalogAttempts = new Set<string>()

  let generation = 0

  const statusMap = (servers: readonly { name: string; status: unknown }[] | undefined) => {
    const next: Record<string, McpStatusMap[string]> = {}
    for (const server of servers ?? []) next[server.name] = runtimeStatus(server.status)
    return next
  }

  const loadStatuses = async () => {
    try {
      // Runtime status is per Location. Load both scopes so Doctor can report every server without mixing names.
      const path = project()?.trim()
      const [globalServers, projectServers] = await Promise.all([
        ctx.client.mcp.list({}).then(
          (output) => output.data,
          () => undefined,
        ),
        path
          ? ctx.client.mcp.list({ location: { directory: path } }).then(
              (output) => output.data,
              () => undefined,
            )
          : Promise.resolve(undefined),
      ])
      setStatuses({ global: statusMap(globalServers), project: statusMap(projectServers) })
    } catch {
      // Runtime status is best-effort: the page still manages config when the server is unreachable.
    }
  }

  const refresh = async () => {
    const current = ++generation
    setLoading(true)
    try {
      const path = project()?.trim()
      const next = await ctx.client.rpc(ManagerRpc).state(path ? { project: path } : {})
      if (current !== generation) return
      setState(next)
      setError(undefined)
      if (!project() && next.project) setProject(next.project.root)
    } catch (refreshError) {
      if (current === generation) setError(errorText(refreshError))
    } finally {
      if (current === generation) setLoading(false)
    }
    void loadStatuses()
  }

  const saved = (next: ManagerState, message: string) => {
    setState(next)
    setError(undefined)
    ctx.toast.show({
      title: ctx.t("saved.title"),
      description: message,
      variant: "success",
      icon: "circle-check",
    })
    window.setTimeout(() => void loadStatuses(), 800)
  }

  const failed = (failure: unknown) => {
    ctx.toast.show({
      title: ctx.t("error.title"),
      description: errorText(failure),
      variant: "error",
    })
  }

  const info = () => (scope() === "global" ? state()?.global : state()?.project)

  const mcp = () => (state()?.mcp ?? []).filter((entry) => entry.scope === scope())
  const plugins = () => (state()?.plugins ?? []).filter((entry) => entry.scope === scope())
  const skills = () => (state()?.skills ?? []).filter((entry) => entry.scope === scope())
  const installed = () => (state()?.installedPlugins ?? []).filter((entry) => entry.scope === scope())
  const marketplaces = () => state()?.marketplaces ?? []
  const diagnostics = () => {
    const current = state()
    if (!current) return []
    const list = [...current.diagnostics]
    if (current.projectError) list.unshift({ scope: "project" as const, message: current.projectError })
    return list
  }
  const allEmpty = () => mcp().length + plugins().length + skills().length + installed().length === 0

  const globalSearchRecords = createMemo(() => {
    const current = state()
    return current ? buildSearchRecords(current, catalogs()) : []
  })
  const searchGroups = createMemo(() =>
    groupSearchResults(searchRecords(globalSearchRecords(), search(), searchFilter())),
  )

  const loadCatalogs = async () => {
    const pending = marketplaces().filter((marketplace) => !catalogAttempts.has(marketplace.id))
    if (pending.length === 0) return
    for (const marketplace of pending) catalogAttempts.add(marketplace.id)
    setCatalogLoading(true)
    try {
      const path = project()?.trim()
      const results = await Promise.allSettled(
        pending.map((marketplace) =>
          ctx.client.rpc(ManagerRpc).catalog({
            marketplace: marketplace.id,
            scope: scope(),
            ...(path ? { project: path } : {}),
          }),
        ),
      )
      const next = { ...catalogs() }
      let failed = false
      results.forEach((result, index) => {
        const marketplace = pending[index]!
        if (result.status === "fulfilled") next[marketplace.id] = result.value.plugins
        else failed = true
      })
      setCatalogs(next)
      setCatalogError(failed)
    } catch {
      setCatalogError(true)
    } finally {
      setCatalogLoading(false)
    }
  }

  createEffect(() => {
    const query = search().trim()
    const filter = searchFilter()
    if (query.length < 2) return
    if (filter !== "all" && filter !== "marketplaces") return
    if (!state() || marketplaces().length === 0) return
    void loadCatalogs()
  })

  const revealElement = (id: string, attempt = 0) => {
    window.setTimeout(
      () => {
        const element = document.getElementById(id)
        if (!element) {
          if (attempt < 6) revealElement(id, attempt + 1)
          return
        }
        element.scrollIntoView({ block: "center", behavior: "smooth" })
        element.classList.add("oem-focus")
        window.setTimeout(() => element.classList.remove("oem-focus"), 1800)
      },
      attempt === 0 ? 100 : 150,
    )
  }

  const changeSearch = (value: string) => {
    setSearch(value)
    if (value.trim() && tab() !== "overview") setTab("overview")
  }

  const pickSearchResult = (record: SearchRecord) => {
    if (record.scope) setScope(record.scope)
    setTab(record.tab)
    setSearch("")
    if (record.category === "catalog" && record.marketplace && record.plugin) {
      setCatalogFocus({
        kind: "catalog",
        marketplace: record.marketplace,
        plugin: record.plugin,
        elementId: record.elementId,
        nonce: Date.now(),
      })
      return
    }
    setCatalogFocus(undefined)
    revealElement(record.elementId)
  }

  const count = (value: number) => (value > 0 ? { count: value } : {})
  const tabItems = (): TabItem[] => [
    { id: "overview", label: ctx.t("tabs.overview"), icon: "dot-grid" },
    { id: "mcp", label: ctx.t("tabs.mcp"), icon: "server", ...count(mcp().length) },
    { id: "plugins", label: ctx.t("tabs.plugins"), icon: "extensions", ...count(plugins().length) },
    { id: "skills", label: ctx.t("tabs.skills"), icon: "post-skill", ...count(skills().length) },
    {
      id: "marketplaces",
      label: ctx.t("tabs.marketplaces"),
      icon: "grid-plus",
      ...count(marketplaces().length),
    },
    {
      id: "about",
      label: ctx.t("tabs.about"),
      icon: "info",
      ...(diagnostics().length + (selfUpdateAvailable() ? 1 : 0) > 0
        ? { count: diagnostics().length + (selfUpdateAvailable() ? 1 : 0), warning: true }
        : {}),
    },
  ]

  const pickProject = async () => {
    try {
      const picked = (await ctx.desktop?.pick({ directory: true, title: ctx.t("scope.pickFolder") })) ?? []
      const [folder] = picked
      if (!folder) return
      setProject(folder)
      setScope("project")
      await refresh()
    } catch (pickError) {
      failed(pickError)
    }
  }

  const reveal = (path: string | undefined) => {
    if (!path) return
    revealPath(ctx, path)
  }

  createEffect(() => {
    const target = props.target
    if (target) setTab(tabFromTarget(target))
  })

  onMount(() => {
    void refresh()
    void autoCheckSelfUpdate(ctx)

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return
      const target = event.target
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) return
        const tag = target.tagName
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      }
      const match = /^Digit([1-6])$/.exec(event.code)
      if (!match) return
      const next = tabOrder[Number(match[1]) - 1]
      if (!next) return
      event.preventDefault()
      setTab(next)
    }

    window.addEventListener("keydown", onKeyDown)
    onCleanup(() => window.removeEventListener("keydown", onKeyDown))
  })

  return (
    <ctx.ui.SettingsLayout
      title={ctx.t("page.title")}
      description={ctx.t("page.description")}
      actions={
        <ctx.ui.Button icon="refresh" size="small" busy={loading()} onClick={() => void refresh()}>
          {ctx.t("common.refresh")}
        </ctx.ui.Button>
      }
    >
      <Show when={error()}>
        <ctx.ui.SettingsSection title={ctx.t("error.title")}>
          <ctx.ui.SettingsRow title={ctx.t("error.load")} description={<span class="oem-error">{error()}</span>} />
        </ctx.ui.SettingsSection>
      </Show>

      <Show
        when={state()}
        fallback={
          <ctx.ui.SettingsSection>
            <div role="status" aria-label={ctx.t("common.loading")}>
              <SkeletonRows count={4} />
            </div>
          </ctx.ui.SettingsSection>
        }
      >
        {(current) => (
          <>
            <div class="oem-toolbar">
              <div class="oem-toolbar-item oem-toolbar-search">
                <ctx.ui.TextInput
                  type="search"
                  value={search()}
                  onInput={changeSearch}
                  onSubmit={() => {
                    if (search().trim()) setTab("overview")
                  }}
                  label={ctx.t("search.label")}
                  placeholder={ctx.t("search.placeholder")}
                  class="oem-input"
                />
                <Show when={search()}>
                  <ctx.ui.IconButton
                    icon="close-small"
                    size="small"
                    label={ctx.t("search.clear")}
                    onClick={() => setSearch("")}
                  />
                </Show>
              </div>

              <div class="oem-toolbar-item">
                <span class="oem-toolbar-label">{ctx.t("common.scope")}</span>
                <ctx.ui.Select
                  label={ctx.t("scope.mode")}
                  value={scope()}
                  options={[
                    { value: "global", label: ctx.t("scope.global") },
                    { value: "project", label: ctx.t("scope.project") },
                  ]}
                  onChange={(value) => setScope(value as Scope)}
                />
              </div>

              <Show when={scope() === "project"}>
                <div class="oem-toolbar-item oem-toolbar-grow">
                  <ctx.ui.TextInput
                    value={project() ?? ""}
                    onInput={setProject}
                    onSubmit={() => void refresh()}
                    label={ctx.t("scope.projectDir")}
                    placeholder="C:\path\to\project"
                    class="oem-input"
                  />
                  <ctx.ui.Button icon="folder-add-left" size="small" onClick={() => void pickProject()}>
                    {ctx.t("scope.pickFolder")}
                  </ctx.ui.Button>
                </div>
              </Show>

              <Show when={info()}>
                {(scopeInfo) => (
                  <div class="oem-toolbar-actions">
                    <ctx.ui.IconButton
                      icon="file-document"
                      size="small"
                      label={ctx.t("scope.configFile")}
                      onClick={() => reveal(scopeInfo().configPath)}
                    />
                    <ctx.ui.IconButton
                      icon="folder"
                      size="small"
                      label={ctx.t("scope.skillsDir")}
                      onClick={() => reveal(scopeInfo().skillsDir)}
                    />
                  </div>
                )}
              </Show>
            </div>

            <div class="oem-tabs" role="tablist" aria-label={ctx.t("page.title")}>
              <For each={tabItems()}>
                {(item, index) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab() === item.id}
                    aria-keyshortcuts={`Alt+${index() + 1}`}
                    class={`oem-tab${tab() === item.id ? " oem-tab-active" : ""}`}
                    onClick={() => setTab(item.id)}
                  >
                    <ctx.ui.Icon name={item.icon} size="small" />
                    <span>{item.label}</span>
                    <Show when={(item.count ?? 0) > 0}>
                      <span class={`oem-tab-count${item.warning ? " oem-tab-warning" : ""}`}>{item.count}</span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
            <span class="oem-hint oem-tab-hint">{ctx.t("hotkeys.tabs")}</span>

            <Switch>
              <Match when={tab() === "overview"}>
                <Show when={search().trim()}>
                  <SearchPanel
                    ctx={ctx}
                    query={search()}
                    filter={searchFilter()}
                    groups={searchGroups()}
                    loading={catalogLoading()}
                    catalogError={catalogError()}
                    onFilter={setSearchFilter}
                    onPick={pickSearchResult}
                  />
                </Show>

                <UpdatesSection
                  ctx={ctx}
                  project={project()}
                  state={current()}
                  saved={saved}
                  failed={failed}
                  refresh={refresh}
                />

                <div class="oem-overview-grid">
                  <button type="button" class="oem-stat" onClick={() => setTab("mcp")}>
                    <span class="oem-stat-value">{mcp().length}</span>
                    <span class="oem-stat-label">{ctx.t("mcp.title")}</span>
                  </button>
                  <button type="button" class="oem-stat" onClick={() => setTab("plugins")}>
                    <span class="oem-stat-value">{plugins().length}</span>
                    <span class="oem-stat-label">{ctx.t("plugins.title")}</span>
                  </button>
                  <button type="button" class="oem-stat" onClick={() => setTab("skills")}>
                    <span class="oem-stat-value">{skills().length}</span>
                    <span class="oem-stat-label">{ctx.t("skills.title")}</span>
                  </button>
                  <button type="button" class="oem-stat" onClick={() => setTab("marketplaces")}>
                    <span class="oem-stat-value">{marketplaces().length}</span>
                    <span class="oem-stat-label">{ctx.t("marketplaces.title")}</span>
                  </button>
                  <button
                    type="button"
                    class={`oem-stat${diagnostics().length > 0 ? " oem-stat-warning" : ""}`}
                    onClick={() => setTab("about")}
                  >
                    <span class="oem-stat-value">{diagnostics().length}</span>
                    <span class="oem-stat-label">{ctx.t("diagnostics.title")}</span>
                  </button>
                </div>

                <Show when={allEmpty()}>
                  <ctx.ui.SettingsSection>
                    <ctx.ui.SettingsRow
                      title={<span class="oem-muted">{ctx.t("common.none")}</span>}
                      description={ctx.t("scope.modeHint")}
                    />
                  </ctx.ui.SettingsSection>
                </Show>

                <ctx.ui.SettingsSection title={ctx.t("scope.title")}>
                  <Show when={info()}>
                    {(scopeInfo) => (
                      <>
                        <ctx.ui.SettingsRow
                          title={
                            <span class="oem-title">
                              <span>{ctx.t("scope.configFile")}</span>
                              <Show when={!scopeInfo().configExists}>
                                <span class="oem-badge">{ctx.t("scope.willCreate")}</span>
                              </Show>
                            </span>
                          }
                          description={
                            <span class="oem-description">
                              <span class="oem-path">{scopeInfo().configPath}</span>
                              <span class="oem-hint">{ctx.t("scope.configFileHint")}</span>
                            </span>
                          }
                          id="oem-scope-config"
                        >
                          <ctx.ui.IconButton
                            icon="folder"
                            size="small"
                            label={ctx.t("common.showInFolder")}
                            onClick={() => reveal(scopeInfo().configPath)}
                          />
                        </ctx.ui.SettingsRow>
                        <ctx.ui.SettingsRow
                          title={ctx.t("scope.skillsDir")}
                          description={
                            <span class="oem-description">
                              <span class="oem-path">{scopeInfo().skillsDir}</span>
                              <span class="oem-hint">{ctx.t("scope.skillsDirHint")}</span>
                            </span>
                          }
                        >
                          <ctx.ui.IconButton
                            icon="folder"
                            size="small"
                            label={ctx.t("common.showInFolder")}
                            onClick={() => reveal(scopeInfo().skillsDir)}
                          />
                        </ctx.ui.SettingsRow>
                      </>
                    )}
                  </Show>
                </ctx.ui.SettingsSection>

                <ctx.ui.SettingsSection>
                  <ctx.ui.SettingsRow title={<span class="oem-hint">{ctx.t("footer.note")}</span>} />
                </ctx.ui.SettingsSection>
              </Match>

              <Match when={tab() === "mcp"}>
                <McpSection
                  ctx={ctx}
                  scope={scope()}
                  project={project()}
                  state={current()}
                  busy={busy()}
                  statuses={statuses()[scope()]}
                  setBusy={setBusy}
                  refreshStatuses={() => void loadStatuses()}
                  saved={saved}
                  failed={failed}
                />
              </Match>

              <Match when={tab() === "plugins"}>
                <PluginsSection
                  ctx={ctx}
                  scope={scope()}
                  project={project()}
                  state={current()}
                  busy={busy()}
                  setBusy={setBusy}
                  saved={saved}
                  failed={failed}
                />
                <ClaudeImportSection
                  ctx={ctx}
                  scope={scope()}
                  project={project()}
                  state={current()}
                  busy={busy()}
                  setBusy={setBusy}
                  saved={saved}
                  failed={failed}
                />
              </Match>

              <Match when={tab() === "skills"}>
                <SkillsSection
                  ctx={ctx}
                  scope={scope()}
                  project={project()}
                  state={current()}
                  busy={busy()}
                  setBusy={setBusy}
                  saved={saved}
                  failed={failed}
                />
              </Match>

              <Match when={tab() === "marketplaces"}>
                <MarketplacesSection
                  ctx={ctx}
                  scope={scope()}
                  project={project()}
                  state={current()}
                  busy={busy()}
                  setBusy={setBusy}
                  saved={saved}
                  failed={failed}
                  focus={catalogFocus()}
                />
              </Match>

              <Match when={tab() === "about"}>
                <AboutSection ctx={ctx} />

                <DoctorSection
                  ctx={ctx}
                  project={project()}
                  state={current()}
                  statuses={statuses()}
                  busy={busy()}
                  loading={loading()}
                  setBusy={setBusy}
                  saved={saved}
                  failed={failed}
                  refresh={refresh}
                  refreshStatuses={loadStatuses}
                />
              </Match>
            </Switch>
          </>
        )}
      </Show>
    </ctx.ui.SettingsLayout>
  )
}

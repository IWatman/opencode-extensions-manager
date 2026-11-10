import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import {
  ManagerRpc,
  type InstalledPlugin,
  type ManagerState,
  type MarketplaceInfo,
  type MarketplacePlugin,
  type PluginInspection,
  type RepositoryInspection,
  type RepositoryProposal,
  type Scope,
} from "../rpc"
import { errorText, isBuiltinMarketplaceUrl, isRecord, type GuiContext } from "./helpers"
import { readSortPreference, sortItems, writeSortPreference, type SortKey } from "./list"
import { SortControl, SkeletonRows } from "./ui"
import type { SearchFocus } from "./search"

const catalogLimit = 80
/** Must match the synthetic marketplace id used by the server for Claude Code imports. */
const CLAUDE_MARKETPLACE_ID = "claude-code"
const AUTO_REFRESH_KEY = "opencode-extensions-manager.marketplaces.auto-refresh"
const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000

function storedAutoRefresh() {
  try {
    return window.localStorage.getItem(AUTO_REFRESH_KEY) === "true"
  } catch {
    return false
  }
}

function storeAutoRefresh(enabled: boolean) {
  try {
    window.localStorage.setItem(AUTO_REFRESH_KEY, String(enabled))
  } catch {
    // Private browsing or a restricted webview can reject storage; the toggle still works for this visit.
  }
}

function revisionLabel(item: InstalledPlugin) {
  return item.previousVersion || (item.previousCommit ? item.previousCommit.slice(0, 8) : "")
}

function repositorySummary(proposal: RepositoryProposal) {
  if (proposal.kind === "plugin") return proposal.package ?? ""
  const config = isRecord(proposal.config) ? proposal.config : undefined
  if (!config) return ""
  if (config.type === "remote" && typeof config.url === "string") return config.url
  if (Array.isArray(config.command)) {
    return config.command.filter((item): item is string => typeof item === "string").join(" ")
  }
  return ""
}

export function MarketplacesSection(props: {
  ctx: GuiContext
  scope: Scope
  project: string | undefined
  state: ManagerState
  busy: string | undefined
  setBusy: (key: string | undefined) => void
  saved: (next: ManagerState, message: string) => void
  failed: (error: unknown) => void
  focus?: SearchFocus
}) {
  const ctx = props.ctx
  const [marketplaces, setMarketplaces] = createSignal<readonly MarketplaceInfo[]>([])
  const [loading, setLoading] = createSignal(false)
  const [addUrl, setAddUrl] = createSignal("")
  const [addRef, setAddRef] = createSignal("")
  const [adding, setAdding] = createSignal(false)
  const [autoRefresh, setAutoRefresh] = createSignal(storedAutoRefresh())
  const [selected, setSelected] = createSignal<string>()
  const [catalog, setCatalog] = createSignal<readonly MarketplacePlugin[]>([])
  const [catalogLoading, setCatalogLoading] = createSignal(false)
  const [catalogError, setCatalogError] = createSignal<string>()
  const [query, setQuery] = createSignal("")
  const storage = (() => {
    try {
      return window.localStorage
    } catch {
      return undefined
    }
  })()
  const [sort, setSort] = createSignal<SortKey>(
    readSortPreference(storage, "oem.sort.installed", ["name", "scope", "status"], "name"),
  )

  const changeSort = (value: SortKey) => {
    setSort(value)
    writeSortPreference(storage, "oem.sort.installed", value)
  }

  const target = () => (props.project?.trim() ? { project: props.project.trim() } : {})
  const installed = () => props.state.installedPlugins
  const sortedInstalled = createMemo(() =>
    sortItems(installed(), sort(), {
      name: (item) => item.displayName ?? item.plugin,
      scope: (item) => item.scope,
      status: (item) => (item.enabled ? 0 : 1),
    }),
  )
  const projectRoot = () => props.state.project?.root ?? props.project?.trim()
  const selectedMarketplace = createMemo(() => marketplaces().find((item) => item.id === selected()))
  /**
   * A catalog row is installed only for the scope currently shown. The same marketplace plugin may
   * be installed globally and in this project at the same time, so matching by name alone is wrong.
   */
  const isInstalled = (plugin: MarketplacePlugin) =>
    installed().some(
      (item) =>
        item.marketplace === plugin.marketplace &&
        item.plugin === plugin.name &&
        item.scope === props.scope &&
        (props.scope === "global" || (item.project !== undefined && item.project === projectRoot())),
    )
  const withSkipped = (message: string, skipped: readonly string[] | undefined) =>
    skipped && skipped.length > 0 ? `${message}. ${skipped.join("; ")}` : message
  let marketplaceGeneration = 0
  let catalogGeneration = 0
  let autoRefreshTimer: number | undefined

  const loadMarketplaces = async (refresh = false) => {
    const current = ++marketplaceGeneration
    setLoading(true)
    try {
      const output = await ctx.client.rpc(ManagerRpc).marketplaces(refresh ? { refresh: true } : {})
      if (current !== marketplaceGeneration) return
      setMarketplaces(output.marketplaces)
    } catch (error) {
      if (current === marketplaceGeneration) props.failed(error)
    } finally {
      if (current === marketplaceGeneration) setLoading(false)
    }
  }

  const openCatalog = async (marketplace: string, refresh = false, resetQuery = true) => {
    const current = ++catalogGeneration
    setSelected(marketplace)
    if (resetQuery) setQuery("")
    setCatalog([])
    setCatalogError(undefined)
    setCatalogLoading(true)
    try {
      const output = await ctx.client.rpc(ManagerRpc).catalog({
        marketplace,
        ...(refresh ? { refresh: true } : {}),
        scope: props.scope,
        ...target(),
      })
      if (current !== catalogGeneration) return
      setCatalog(output.plugins)
    } catch (error) {
      if (current === catalogGeneration) setCatalogError(errorText(error))
    } finally {
      if (current === catalogGeneration) setCatalogLoading(false)
    }
  }

  const add = async () => {
    const url = addUrl().trim()
    if (!url) return
    if (!isBuiltinMarketplaceUrl(url)) {
      const confirmed = await ctx.dialogs.confirm({
        title: ctx.t("marketplaces.trustTitle"),
        description: ctx.t("marketplaces.trustDescription", { url }),
        confirm: ctx.t("marketplaces.trustConfirm"),
      })
      if (!confirmed) return
    }
    const ref = addRef().trim()
    setAdding(true)
    try {
      const result = await ctx.client.rpc(ManagerRpc).addMarketplace({
        url,
        ...(ref ? { ref } : {}),
        ...target(),
      })
      if (result.kind === "repository" && result.repository) {
        const repository = result.repository
        ctx.dialogs.open((dialog) => (
          <RepositoryInstallDialog
            ctx={ctx}
            repository={repository}
            scope={props.scope}
            project={props.project}
            onClose={dialog.close}
            onInstalled={(next, message) => {
              props.saved(next, message)
              dialog.close()
            }}
          />
        ))
        return
      }
      props.saved(
        result.state,
        ctx.t("marketplaces.added", { name: result.marketplace?.name ?? url }),
      )
      setAddUrl("")
      setAddRef("")
      await loadMarketplaces(true)
    } catch (error) {
      props.failed(error)
    } finally {
      setAdding(false)
    }
  }

  const removeMarketplace = async (marketplace: MarketplaceInfo) => {
    if (marketplace.builtin) return
    const confirmed = await ctx.dialogs.confirm({
      title: ctx.t("marketplaces.removeTitle"),
      description: ctx.t("marketplaces.removeDescription", { name: marketplace.name }),
      confirm: ctx.t("common.delete"),
      danger: true,
    })
    if (!confirmed) return
    const key = `marketplace:${marketplace.id}`
    props.setBusy(key)
    try {
      const next = await ctx.client.rpc(ManagerRpc).removeMarketplace({
        marketplace: marketplace.id,
        ...target(),
      })
      props.saved(next, ctx.t("marketplaces.removed", { name: marketplace.name }))
      if (selected() === marketplace.id) setSelected(undefined)
      await loadMarketplaces(true)
    } catch (error) {
      props.failed(error)
    } finally {
      props.setBusy(undefined)
    }
  }

  const toggleInstalled = async (item: InstalledPlugin, enabled: boolean) => {
    const key = `installed:${item.key}`
    props.setBusy(key)
    try {
      const next = await ctx.client.rpc(ManagerRpc).setMarketplacePluginEnabled({
        key: item.key,
        enabled,
        ...target(),
      })
      const message = ctx.t(enabled ? "marketplaces.pluginEnabled" : "marketplaces.pluginDisabled", {
        name: item.displayName ?? item.plugin,
      })
      props.saved(next, withSkipped(message, next.skipped))
    } catch (error) {
      props.failed(error)
    } finally {
      props.setBusy(undefined)
    }
  }

  const updateInstalled = async (item: InstalledPlugin) => {
    const key = `installed:${item.key}`
    props.setBusy(key)
    try {
      const next = await ctx.client.rpc(ManagerRpc).updateMarketplacePlugin({
        key: item.key,
        ...target(),
      })
      props.saved(next, ctx.t("marketplaces.pluginUpdated", { name: item.displayName ?? item.plugin }))
    } catch (error) {
      props.failed(error)
    } finally {
      props.setBusy(undefined)
    }
  }

  const rollbackInstalled = async (item: InstalledPlugin) => {
    const name = item.displayName ?? item.plugin
    const confirmed = await ctx.dialogs.confirm({
      title: ctx.t("marketplaces.rollbackTitle"),
      description: ctx.t("marketplaces.rollbackDescription", {
        name,
        revision: revisionLabel(item),
      }),
      confirm: ctx.t("marketplaces.rollback"),
      danger: true,
    })
    if (!confirmed) return
    const key = `installed:${item.key}`
    props.setBusy(key)
    try {
      const output = await ctx.client.rpc(ManagerRpc).rollbackMarketplacePlugin({
        key: item.key,
        ...target(),
      })
      props.saved(
        output.state,
        withSkipped(ctx.t("marketplaces.rollbackDone", { name }), output.result.skipped),
      )
    } catch (error) {
      props.failed(error)
    } finally {
      props.setBusy(undefined)
    }
  }

  const scopeLabel = (scope: Scope) => ctx.t(scope === "global" ? "scope.global" : "scope.project")

  const removeInstalled = async (item: InstalledPlugin) => {
    const confirmed = await ctx.dialogs.confirm({
      title: ctx.t("marketplaces.deleteTitle"),
      description: ctx.t("marketplaces.deleteDescription", { name: item.displayName ?? item.plugin }),
      confirm: ctx.t("common.delete"),
      danger: true,
    })
    if (!confirmed) return
    const key = `installed:${item.key}`
    props.setBusy(key)
    try {
      const next = await ctx.client.rpc(ManagerRpc).uninstallMarketplacePlugin({
        key: item.key,
        ...target(),
      })
      const message = ctx.t("marketplaces.deleted", { name: item.displayName ?? item.plugin })
      props.saved(next, withSkipped(message, next.skipped))
    } catch (error) {
      props.failed(error)
    } finally {
      props.setBusy(undefined)
    }
  }

  const inspect = async (plugin: MarketplacePlugin) => {
    const key = `inspect:${plugin.marketplace}/${plugin.name}`
    props.setBusy(key)
    try {
      const inspection = await ctx.client.rpc(ManagerRpc).inspectMarketplacePlugin({
        marketplace: plugin.marketplace,
        plugin: plugin.name,
      })
      ctx.dialogs.open((dialog) => (
        <InstallPluginDialog
          ctx={ctx}
          inspection={inspection}
          scope={props.scope}
          project={props.project}
          onClose={dialog.close}
          onInstalled={(next, message) => {
            props.saved(next, message)
            dialog.close()
          }}
        />
      ))
    } catch (error) {
      props.failed(error)
    } finally {
      props.setBusy(undefined)
    }
  }

  const filtered = createMemo(() => {
    const value = query().trim().toLowerCase()
    if (!value) return catalog()
    return catalog().filter((plugin) =>
      [plugin.name, plugin.displayName, plugin.description, plugin.author, plugin.category].some((field) =>
        field?.toLowerCase().includes(value),
      ),
    )
  })
  const visible = createMemo(() => filtered().slice(0, catalogLimit))

  const installedParts = (item: InstalledPlugin) =>
    ctx.t("marketplaces.parts", {
      mcp: item.mcp.length,
      skills: item.skills.length,
      plugins: item.plugins.length,
    })

  const stopAutoRefresh = () => {
    if (autoRefreshTimer !== undefined) window.clearInterval(autoRefreshTimer)
    autoRefreshTimer = undefined
  }

  const refreshCatalog = () => {
    void loadMarketplaces(true)
    const current = selected()
    if (current) void openCatalog(current, true, false)
  }

  const toggleAutoRefresh = (enabled: boolean) => {
    setAutoRefresh(enabled)
    storeAutoRefresh(enabled)
    stopAutoRefresh()
    if (enabled) autoRefreshTimer = window.setInterval(refreshCatalog, AUTO_REFRESH_INTERVAL)
  }

  const revealElement = (id: string, attempt = 0) => {
    window.setTimeout(() => {
      const element = document.getElementById(id)
      if (!element) {
        if (attempt < 6) revealElement(id, attempt + 1)
        return
      }
      element.scrollIntoView({ block: "center", behavior: "smooth" })
      element.classList.add("oem-focus")
      window.setTimeout(() => element.classList.remove("oem-focus"), 1800)
    }, 120)
  }

  createEffect(() => {
    const focus = props.focus
    if (!focus) return
    void openCatalog(focus.marketplace).then(() => revealElement(focus.elementId))
  })

  onMount(() => {
    void loadMarketplaces()
    if (autoRefresh()) autoRefreshTimer = window.setInterval(refreshCatalog, AUTO_REFRESH_INTERVAL)
  })

  onCleanup(stopAutoRefresh)

  return (
    <>
      <ctx.ui.SettingsSection
        title={`${ctx.t("marketplaces.title")} (${marketplaces().length})`}
        footer={
          <div class="oem-footer">
            <span class="oem-hint">{ctx.t("marketplaces.note")}</span>
          </div>
        }
      >
        <div class="oem-marketplace-add" id="oem-marketplace-add">
          <div class="oem-field">
            <span class="oem-field-label">{ctx.t("marketplaces.add")}</span>
            <span class="oem-hint">{ctx.t("marketplaces.addHint")}</span>
            <span class="oem-hint">{ctx.t("marketplaces.refHint")}</span>
          </div>
          <div class="oem-actions oem-actions-wide">
            <ctx.ui.TextInput
              value={addUrl()}
              onInput={setAddUrl}
              onSubmit={() => void add()}
              label={ctx.t("marketplaces.add")}
              placeholder="https://github.com/anthropics/claude-plugins-official"
              class="oem-input"
            />
            <ctx.ui.TextInput
              value={addRef()}
              onInput={setAddRef}
              onSubmit={() => void add()}
              label={ctx.t("marketplaces.ref")}
              placeholder="main / v1.2.0"
              class="oem-input oem-input-ref"
            />
            <ctx.ui.Button icon="plus" size="small" busy={adding()} onClick={() => void add()}>
              {ctx.t("common.add")}
            </ctx.ui.Button>
          </div>
        </div>

        <ctx.ui.SettingsRow
          id="oem-marketplace-auto-refresh"
          title={ctx.t("marketplaces.autoRefresh")}
          description={ctx.t("marketplaces.autoRefreshHint")}
        >
          <ctx.ui.Switch
            checked={autoRefresh()}
            onChange={toggleAutoRefresh}
            label={ctx.t("marketplaces.autoRefresh")}
            hideLabel
          />
        </ctx.ui.SettingsRow>

        <Show when={loading()}>
          <div role="status" aria-label={ctx.t("common.loading")}>
            <SkeletonRows count={3} />
          </div>
        </Show>

        <Show when={!loading() && marketplaces().length === 0}>
          <ctx.ui.SettingsRow title={<span class="oem-muted">{ctx.t("marketplaces.empty")}</span>} />
        </Show>

        <For each={marketplaces()}>
          {(marketplace) => {
            const key = () => `marketplace:${marketplace.id}`
            return (
              <ctx.ui.SettingsRow
                id={`oem-marketplace-${marketplace.id}`}
                title={
                  <span class="oem-title">
                    <span>{marketplace.name}</span>
                    <Show when={marketplace.builtin}>
                      <span class="oem-badge">{ctx.t("marketplaces.builtin")}</span>
                    </Show>
                    <Show when={!marketplace.builtin}>
                      <span class="oem-badge">{ctx.t("marketplaces.thirdParty")}</span>
                    </Show>
                    <Show when={!marketplace.builtin && marketplace.ref}>
                      <span class="oem-badge">{ctx.t("marketplaces.refBadge", { ref: marketplace.ref! })}</span>
                    </Show>
                    <Show when={marketplace.pluginCount !== undefined}>
                      <span class="oem-badge">
                        {ctx.t("marketplaces.count", { count: marketplace.pluginCount ?? 0 })}
                      </span>
                    </Show>
                  </span>
                }
                description={
                  <span class="oem-description">
                    <span class="oem-path">{marketplace.url}</span>
                    <Show when={marketplace.description}>
                      <span class="oem-hint">{marketplace.description}</span>
                    </Show>
                    <Show when={marketplace.error}>
                      <span class="oem-error">{marketplace.error}</span>
                    </Show>
                  </span>
                }
              >
                <div class="oem-actions">
                  <ctx.ui.Button
                    icon="extensions"
                    size="small"
                    onClick={() => void openCatalog(marketplace.id)}
                    disabled={props.busy === key()}
                  >
                    {ctx.t("marketplaces.catalog")}
                  </ctx.ui.Button>
                  <ctx.ui.IconButton
                    icon="refresh"
                    size="small"
                    label={ctx.t("common.refresh")}
                    disabled={props.busy === key()}
                    onClick={() => {
                      void loadMarketplaces(true)
                      if (selected() === marketplace.id) void openCatalog(marketplace.id, true)
                    }}
                  />
                  <Show when={!marketplace.builtin}>
                    <ctx.ui.IconButton
                      icon="trash"
                      size="small"
                      label={ctx.t("common.delete")}
                      disabled={props.busy === key()}
                      onClick={() => void removeMarketplace(marketplace)}
                    />
                  </Show>
                </div>
              </ctx.ui.SettingsRow>
            )
          }}
        </For>
      </ctx.ui.SettingsSection>

      <ctx.ui.SettingsSection title={`${ctx.t("marketplaces.installedTitle")} (${installed().length})`}>
        <Show when={installed().length > 0}>
          <div class="oem-list-header">
            <SortControl
              ctx={ctx}
              value={sort()}
              options={[
                { value: "name", label: ctx.t("sort.name") },
                { value: "scope", label: ctx.t("sort.scope") },
                { value: "status", label: ctx.t("sort.status") },
              ]}
              onChange={changeSort}
            />
          </div>
        </Show>
        <Show
          when={installed().length > 0}
          fallback={
            <ctx.ui.SettingsRow
              id="oem-marketplace-installed-empty"
              title={<span class="oem-muted">{ctx.t("marketplaces.installedEmpty")}</span>}
            />
          }
        >
          <For each={sortedInstalled()}>
            {(item) => {
              const key = () => `installed:${item.key}`
              const scopeLabel = () =>
                item.scope === "global" ? ctx.t("scope.global") : ctx.t("scope.project")
              return (
                <ctx.ui.SettingsRow
                  id={`oem-installed-${item.key}`}
                  title={
                    <span class="oem-title">
                      <span>
                        {item.displayName ?? item.plugin}@{item.marketplaceName}
                      </span>
                      <Show when={item.version}>
                        <span class="oem-badge">{item.version}</span>
                      </Show>
                      <Show when={item.previousVersion || item.previousCommit}>
                        <span class="oem-badge">
                          {ctx.t("marketplaces.previousRevision", { revision: revisionLabel(item) })}
                        </span>
                      </Show>
                      <span class="oem-badge">{scopeLabel()}</span>
                    </span>
                  }
                  description={
                    <span class="oem-description">
                      <span class="oem-hint">{installedParts(item)}</span>
                      <Show when={item.project}>
                        <span class="oem-path">{item.project}</span>
                      </Show>
                      <Show when={item.unsupported.length > 0}>
                        <span class="oem-hint">
                          {ctx.t("marketplaces.unsupportedParts", { parts: item.unsupported.join(", ") })}
                        </span>
                      </Show>
                      <Show when={item.skipped && item.skipped.length > 0}>
                        <span class="oem-error">{item.skipped!.join("; ")}</span>
                      </Show>
                      <Show when={item.error}>
                        <span class="oem-error">{item.error}</span>
                      </Show>
                    </span>
                  }
                >
                  <div class="oem-actions">
                    <ctx.ui.Switch
                      checked={item.enabled}
                      disabled={props.busy === key()}
                      label={ctx.t("marketplaces.enabled")}
                      hideLabel
                      onChange={(enabled) => void toggleInstalled(item, enabled)}
                    />
                    <Show when={item.marketplace !== CLAUDE_MARKETPLACE_ID}>
                      <ctx.ui.IconButton
                        icon="refresh"
                        size="small"
                        label={ctx.t("marketplaces.update")}
                        disabled={props.busy === key()}
                        onClick={() => void updateInstalled(item)}
                      />
                    </Show>
                    <Show when={item.previousCommit || item.previousVersion}>
                      <ctx.ui.IconButton
                        icon="outline-undo"
                        size="small"
                        label={ctx.t("marketplaces.rollback")}
                        disabled={props.busy === key()}
                        onClick={() => void rollbackInstalled(item)}
                      />
                    </Show>
                    <ctx.ui.IconButton
                      icon="trash"
                      size="small"
                      label={ctx.t("common.delete")}
                      disabled={props.busy === key()}
                      onClick={() => void removeInstalled(item)}
                    />
                  </div>
                </ctx.ui.SettingsRow>
              )
            }}
          </For>
        </Show>
      </ctx.ui.SettingsSection>

      <Show when={selected()}>
        <ctx.ui.SettingsSection
          title={ctx.t("marketplaces.catalogTitle", {
            name: selectedMarketplace()?.name ?? selected() ?? "",
          })}
        >
          <ctx.ui.SettingsRow
            title={ctx.t("marketplaces.search")}
            description={ctx.t("marketplaces.searchHint")}
          >
            <div class="oem-actions oem-actions-wide">
              <ctx.ui.TextInput
                value={query()}
                onInput={setQuery}
                label={ctx.t("marketplaces.search")}
                placeholder={ctx.t("marketplaces.searchPlaceholder")}
                class="oem-input"
              />
              <ctx.ui.Button
                icon="arrow-left"
                size="small"
                onClick={() => setSelected(undefined)}
              >
                {ctx.t("marketplaces.back")}
              </ctx.ui.Button>
            </div>
          </ctx.ui.SettingsRow>

          <Show when={catalogLoading()}>
            <div role="status" aria-label={ctx.t("common.loading")}>
              <SkeletonRows count={4} />
            </div>
          </Show>

          <Show when={catalogError()}>
            <ctx.ui.SettingsRow
              title={ctx.t("marketplaces.catalogError")}
              description={<span class="oem-error">{catalogError()}</span>}
            >
              <ctx.ui.Button
                icon="refresh"
                size="small"
                onClick={() => selected() && void openCatalog(selected()!, true)}
              >
                {ctx.t("common.refresh")}
              </ctx.ui.Button>
            </ctx.ui.SettingsRow>
          </Show>

          <Show when={!catalogLoading() && !catalogError() && filtered().length === 0}>
            <ctx.ui.SettingsRow title={<span class="oem-muted">{ctx.t("marketplaces.noResults")}</span>} />
          </Show>

          <For each={visible()}>
            {(plugin) => {
              const key = `${plugin.marketplace}/${plugin.name}`
              const busy = () => props.busy === `inspect:${key}`
              return (
                <ctx.ui.SettingsRow
                  id={`oem-catalog-${key}`}
                  title={
                    <span class="oem-title">
                      <span>{plugin.displayName ?? plugin.name}</span>
                      <Show when={plugin.author}>
                        <span class="oem-badge">{plugin.author}</span>
                      </Show>
                      <Show when={plugin.category}>
                        <span class="oem-badge">{plugin.category}</span>
                      </Show>
                    </span>
                  }
                  description={
                    <span class="oem-description">
                      <Show when={plugin.description}>
                        <span class="oem-hint">{plugin.description}</span>
                      </Show>
                      <Show when={plugin.homepage}>
                        <span class="oem-path">{plugin.homepage}</span>
                      </Show>
                    </span>
                  }
                >
                  <Show
                    when={!isInstalled(plugin)}
                    fallback={
                      <ctx.ui.Button size="small" disabled>
                        {ctx.t("marketplaces.installed")}
                      </ctx.ui.Button>
                    }
                  >
                    <ctx.ui.Button
                      icon="download"
                      size="small"
                      busy={busy()}
                      onClick={() => void inspect(plugin)}
                    >
                      {ctx.t("marketplaces.install")}
                    </ctx.ui.Button>
                  </Show>
                </ctx.ui.SettingsRow>
              )
            }}
          </For>

          <Show when={filtered().length > catalogLimit}>
            <ctx.ui.SettingsRow
              title={
                <span class="oem-muted">
                  {ctx.t("marketplaces.tooMany", { shown: catalogLimit, total: filtered().length })}
                </span>
              }
            />
          </Show>
        </ctx.ui.SettingsSection>
      </Show>
    </>
  )
}

function InstallPluginDialog(props: {
  ctx: GuiContext
  inspection: PluginInspection
  scope: Scope
  project: string | undefined
  onClose: () => void
  onInstalled: (next: ManagerState, message: string) => void
}) {
  const ctx = props.ctx
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [adapt, setAdapt] = createSignal(false)
  const inspection = props.inspection
  const supported = () =>
    inspection.mcp.length + inspection.skills.length + inspection.plugins.length > 0 ||
    (adapt() && inspection.adaptable.length > 0)
  const name = () => inspection.displayName ?? inspection.plugin

  const install = async () => {
    setError(undefined)
    setSaving(true)
    try {
      const next = await ctx.client.rpc(ManagerRpc).installMarketplacePlugin({
        marketplace: inspection.marketplace,
        plugin: inspection.plugin,
        scope: props.scope,
        ...(props.project?.trim() ? { project: props.project.trim() } : {}),
        ...(adapt() ? { adapt: true } : {}),
      })
      props.onInstalled(next, ctx.t("marketplaces.installedToast", { name: name() }))
    } catch (installError) {
      setError(errorText(installError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ctx.ui.Dialog
      title={ctx.t("marketplaces.installTitle", { name: name() })}
      size="large"
      footer={
        <>
          <ctx.ui.Button onClick={props.onClose} disabled={saving()}>
            {ctx.t("common.cancel")}
          </ctx.ui.Button>
          <ctx.ui.Button
            variant="contrast"
            busy={saving()}
            disabled={!supported()}
            onClick={() => void install()}
          >
            {ctx.t("marketplaces.install")}
          </ctx.ui.Button>
        </>
      }
    >
      <div class="oem-form">
        <Show when={inspection.description}>
          <span class="oem-hint">{inspection.description}</span>
        </Show>
        <span class="oem-path">{inspection.source}</span>

        <Show when={inspection.mcp.length > 0}>
          <div class="oem-field">
            <span class="oem-field-label">{ctx.t("marketplaces.installMcp")}</span>
            <For each={inspection.mcp}>
              {(server) => (
                <span class="oem-hint">
                  <code class="oem-id">{server.name}</code> — {server.summary}
                </span>
              )}
            </For>
          </div>
        </Show>

        <Show when={inspection.skills.length > 0}>
          <div class="oem-field">
            <span class="oem-field-label">{ctx.t("marketplaces.installSkills")}</span>
            <For each={inspection.skills}>
              {(skill) => (
                <span class="oem-hint">
                  <code class="oem-id">{skill.id}</code>
                  {skill.description ? ` — ${skill.description}` : ""}
                </span>
              )}
            </For>
          </div>
        </Show>

        <Show when={inspection.plugins.length > 0}>
          <div class="oem-field">
            <span class="oem-field-label">{ctx.t("marketplaces.installPlugins")}</span>
            <For each={inspection.plugins}>{(plugin) => <code class="oem-id">{plugin}</code>}</For>
          </div>
        </Show>

        <Show when={inspection.adaptable.length > 0}>
          <div class="oem-field">
            <span class="oem-field-label">{ctx.t("marketplaces.adaptable")}</span>
            <For each={inspection.adaptable}>
              {(skill) => (
                <span class="oem-hint">
                  <code class="oem-id">{skill.id}</code>
                  {skill.description ? ` — ${skill.description}` : ""}
                </span>
              )}
            </For>
            <ctx.ui.Switch
              checked={adapt()}
              onChange={setAdapt}
              label={ctx.t("marketplaces.adapt")}
              description={ctx.t("marketplaces.adaptHint")}
            />
          </div>
        </Show>

        <Show when={!supported()}>
          <div class="oem-error">
            {inspection.mcp.length + inspection.skills.length + inspection.plugins.length === 0 &&
            inspection.adaptable.length > 0
              ? ctx.t("marketplaces.adaptRequired")
              : ctx.t("marketplaces.installNone")}
          </div>
        </Show>

        <Show when={inspection.unsupported.length > 0}>
          <div class="oem-field">
            <span class="oem-field-label">{ctx.t("marketplaces.unsupported")}</span>
            <span class="oem-hint">{inspection.unsupported.join(", ")}</span>
          </div>
        </Show>

        <Show when={inspection.warnings.length > 0}>
          <div class="oem-field">
            <span class="oem-field-label">{ctx.t("marketplaces.warnings")}</span>
            <For each={inspection.warnings}>
              {(warning) => <span class="oem-hint">{warning}</span>}
            </For>
          </div>
        </Show>

        <Show when={error()}>
          <div class="oem-error">{error()}</div>
        </Show>
      </div>
    </ctx.ui.Dialog>
  )
}

function RepositoryInstallDialog(props: {
  ctx: GuiContext
  repository: RepositoryInspection
  scope: Scope
  project: string | undefined
  onClose: () => void
  onInstalled: (next: ManagerState, message: string) => void
}) {
  const ctx = props.ctx
  const [saving, setSaving] = createSignal<string>()
  const [error, setError] = createSignal<string>()

  const install = async (proposal: RepositoryProposal) => {
    const key = `${proposal.kind}:${proposal.name ?? proposal.package ?? ""}`
    setSaving(key)
    setError(undefined)
    try {
      const next = await ctx.client.rpc(ManagerRpc).installRepository({
        proposal,
        scope: props.scope,
        ...(props.project?.trim() ? { project: props.project.trim() } : {}),
      })
      const name = proposal.kind === "mcp" ? proposal.name ?? "" : proposal.package ?? ""
      props.onInstalled(next, ctx.t("marketplaces.repositoryInstalled", { name }))
    } catch (installError) {
      setError(errorText(installError))
    } finally {
      setSaving(undefined)
    }
  }

  return (
    <ctx.ui.Dialog
      title={ctx.t("marketplaces.repositoryTitle", { name: props.repository.name })}
      size="large"
      footer={
        <ctx.ui.Button onClick={props.onClose} disabled={saving() !== undefined}>
          {ctx.t("common.cancel")}
        </ctx.ui.Button>
      }
    >
      <div class="oem-form">
        <span class="oem-path">{props.repository.url}</span>
        <Show when={props.repository.description}>
          <span class="oem-hint">{props.repository.description}</span>
        </Show>
        <Show when={props.repository.proposals.some((proposal) => proposal.kind === "mcp")}>
          <span class="oem-hint">{ctx.t("marketplaces.repositoryDownload")}</span>
        </Show>

        <Show when={props.repository.proposals.length > 0}>
          <div class="oem-field">
            <span class="oem-field-label">{ctx.t("marketplaces.repositoryOptions")}</span>
            <For each={props.repository.proposals}>
              {(proposal) => {
                const key = `${proposal.kind}:${proposal.name ?? proposal.package ?? ""}`
                return (
                  <div class="oem-field">
                    <span class="oem-field-label">
                      {proposal.kind === "mcp"
                        ? ctx.t("marketplaces.installAsMcp", { name: proposal.name ?? "" })
                        : ctx.t("marketplaces.installAsPlugin", { name: proposal.package ?? "" })}
                    </span>
                    <Show when={proposal.reason}>
                      <span class="oem-hint">{proposal.reason}</span>
                    </Show>
                    <Show when={repositorySummary(proposal)}>
                      <code class="oem-command">{repositorySummary(proposal)}</code>
                    </Show>
                    <div class="oem-actions">
                      <ctx.ui.Button
                        icon="download"
                        size="small"
                        busy={saving() === key}
                        disabled={saving() !== undefined && saving() !== key}
                        onClick={() => void install(proposal)}
                      >
                        {ctx.t("marketplaces.install")}
                      </ctx.ui.Button>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>

        <Show when={props.repository.proposals.length === 0}>
          <div class="oem-hint">{ctx.t("marketplaces.repositoryNone")}</div>
        </Show>

        <For each={props.repository.notes}>
          {(note) => <span class="oem-hint">{note}</span>}
        </For>

        <Show when={error()}>
          <div class="oem-error">{error()}</div>
        </Show>
      </div>
    </ctx.ui.Dialog>
  )
}

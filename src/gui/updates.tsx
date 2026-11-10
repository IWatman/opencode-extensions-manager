import { createSignal, For, Show } from "solid-js"
import {
  ManagerRpc,
  type ManagerState,
  type MarketplaceUpdate,
  type Scope,
} from "../rpc"
import { errorText, type GuiContext } from "./helpers"
import {
  claudeUpdates,
  packageUpdates,
  type ClaudeUpdate,
  type PackageUpdate,
} from "./update-helpers"

interface UpdateResult {
  readonly key: string
  readonly name: string
  readonly ok: boolean
  readonly skipped?: readonly string[]
  readonly error?: string
}

export function UpdatesSection(props: {
  ctx: GuiContext
  project: string | undefined
  state: ManagerState
  saved: (next: ManagerState, message: string) => void
  failed: (error: unknown) => void
  refresh: () => Promise<void>
}) {
  const ctx = props.ctx
  const [checking, setChecking] = createSignal(false)
  const [checkError, setCheckError] = createSignal<string>()
  const [checkedAt, setCheckedAt] = createSignal<string>()
  const [marketplace, setMarketplace] = createSignal<readonly MarketplaceUpdate[]>([])
  const [packages, setPackages] = createSignal<readonly PackageUpdate[]>([])
  const [claude, setClaude] = createSignal<readonly ClaudeUpdate[]>([])
  const [updating, setUpdating] = createSignal(false)
  const [results, setResults] = createSignal<readonly UpdateResult[]>([])

  const target = () => (props.project?.trim() ? { project: props.project.trim() } : {})
  const pluginLocation = () =>
    props.project?.trim() ? { location: { directory: props.project.trim() } } : {}
  const total = () => marketplace().length + packages().length + claude().length
  const scopeLabel = (scope: Scope) => ctx.t(scope === "global" ? "scope.global" : "scope.project")
  const shortCommit = (value: string) => (value.length > 10 ? value.slice(0, 7) : value)

  const versionLine = (item: MarketplaceUpdate) => {
    if (!item.currentVersion && !item.latestVersion) return undefined
    return ctx.t("updates.versionChange", {
      current: item.currentVersion ?? ctx.t("updates.unknown"),
      latest: item.latestVersion ?? ctx.t("updates.unknown"),
    })
  }

  const commitLine = (item: MarketplaceUpdate) => {
    if (!item.currentCommit && !item.latestCommit) return undefined
    if (item.currentCommit && item.latestCommit && item.currentCommit === item.latestCommit) return undefined
    return ctx.t("updates.commitChange", {
      current: item.currentCommit ? shortCommit(item.currentCommit) : ctx.t("updates.unknown"),
      latest: item.latestCommit ? shortCommit(item.latestCommit) : ctx.t("updates.unknown"),
    })
  }

  const check = async () => {
    setChecking(true)
    setCheckError(undefined)
    setCheckedAt(undefined)
    setMarketplace([])
    setPackages([])
    setClaude([])
    setResults([])
    const errors: string[] = []
    try {
      const projectPath = props.project?.trim()
      const [marketResult, packageResult, globalClaude, projectClaude] = await Promise.allSettled([
        ctx.client.rpc(ManagerRpc).checkMarketplaceUpdates({}),
        ctx.client.plugin.check(pluginLocation()),
        ctx.client.rpc(ManagerRpc).previewClaudePlugins({ scope: "global" }),
        projectPath
          ? ctx.client.rpc(ManagerRpc).previewClaudePlugins({ scope: "project", project: projectPath })
          : Promise.resolve(undefined),
      ])

      if (marketResult.status === "fulfilled") {
        setMarketplace(marketResult.value.plugins.filter((item) => item.updateAvailable))
      } else {
        errors.push(`Marketplaces: ${errorText(marketResult.reason)}`)
      }

      if (packageResult.status === "fulfilled") {
        setPackages(packageUpdates(packageResult.value.data))
      } else {
        errors.push(`npm/GitHub: ${errorText(packageResult.reason)}`)
      }

      const installed = props.state.installedPlugins
      const nextClaude: ClaudeUpdate[] = []
      if (globalClaude.status === "fulfilled") {
        nextClaude.push(
          ...claudeUpdates(globalClaude.value.candidates, installed, {
            scope: "global",
          }),
        )
      } else {
        errors.push(`Claude Code: ${errorText(globalClaude.reason)}`)
      }
      if (projectClaude.status === "fulfilled" && projectClaude.value && projectPath) {
        nextClaude.push(
          ...claudeUpdates(projectClaude.value.candidates, installed, {
            scope: "project",
            project: projectPath,
          }),
        )
      } else if (projectClaude.status === "rejected") {
        errors.push(`Claude Code (project): ${errorText(projectClaude.reason)}`)
      }
      setClaude(nextClaude)
      const anySourceChecked =
        marketResult.status === "fulfilled" ||
        packageResult.status === "fulfilled" ||
        globalClaude.status === "fulfilled" ||
        (projectClaude.status === "fulfilled" && projectClaude.value !== undefined)
      if (anySourceChecked) {
        setCheckedAt(
          marketResult.status === "fulfilled" ? marketResult.value.checkedAt : new Date().toISOString(),
        )
      }
      setCheckError(errors.length > 0 ? errors.join("; ") : undefined)
    } finally {
      setChecking(false)
    }
  }

  const updateAll = async () => {
    if (total() === 0) return
    setUpdating(true)
    setResults([])
    try {
      await applyUpdates()
    } catch (error) {
      props.failed(error)
    } finally {
      setUpdating(false)
    }
  }

  const applyUpdates = async () => {
    const collected: UpdateResult[] = []
    let lastState: ManagerState | undefined
    let updated = 0
    let failed = 0

    const marketKeys = marketplace().map((item) => item.key)
    if (marketKeys.length > 0) {
      try {
        const output = await ctx.client.rpc(ManagerRpc).updateAllMarketplacePlugins({
          keys: marketKeys,
          ...target(),
        })
        lastState = output.state
        for (const result of output.results) {
          collected.push({
            key: result.key,
            name: result.displayName ?? result.plugin,
            ok: result.ok,
            ...(result.skipped ? { skipped: result.skipped } : {}),
            ...(result.error ? { error: result.error } : {}),
          })
          if (result.ok) updated++
          else failed++
        }
      } catch (error) {
        for (const item of marketplace()) {
          collected.push({
            key: item.key,
            name: item.displayName ?? item.plugin,
            ok: false,
            error: errorText(error),
          })
          failed++
        }
      }
    }

    const packageTargets = packages().map((item) => item.target)
    if (packageTargets.length > 0) {
      try {
        await ctx.client.plugin.update({ targets: packageTargets, ...pluginLocation() })
        for (const item of packages()) {
          collected.push({ key: `package:${item.target}`, name: item.target, ok: true })
          updated++
        }
      } catch (error) {
        for (const item of packages()) {
          collected.push({
            key: `package:${item.target}`,
            name: item.target,
            ok: false,
            error: errorText(error),
          })
          failed++
        }
      }
    }

    const groups = new Map<string, { scope: Scope; project?: string; items: ClaudeUpdate[] }>()
    const successClaudeKeys = new Set<string>()
    for (const item of claude()) {
      const key = `${item.scope}\n${item.project ?? ""}`
      const group = groups.get(key) ?? {
        scope: item.scope,
        ...(item.project ? { project: item.project } : {}),
        items: [],
      }
      group.items.push(item)
      groups.set(key, group)
    }
    for (const group of groups.values()) {
      try {
        const output = await ctx.client.rpc(ManagerRpc).installClaudePlugins({
          scope: group.scope,
          ...(group.project ? { project: group.project } : {}),
          plugins: group.items.map((item) => ({
            id: item.id,
            ...(item.adapt ? { adapt: true } : {}),
          })),
        })
        lastState = output.state
        const byID = new Map(group.items.map((item) => [item.id, item]))
        for (const result of output.results) {
          const item = byID.get(result.id)
          const key = item?.key ?? `claude:${result.id}`
          if (result.ok) successClaudeKeys.add(key)
          collected.push({
            key,
            name: result.name,
            ok: result.ok,
            ...(result.skipped ? { skipped: result.skipped } : {}),
            ...(result.error ? { error: result.error } : {}),
          })
          if (result.ok) updated++
          else failed++
        }
      } catch (error) {
        for (const item of group.items) {
          collected.push({
            key: item.key,
            name: item.name,
            ok: false,
            error: errorText(error),
          })
          failed++
        }
      }
    }

    setResults(collected)
    const skipped = collected.filter((item) => item.ok && item.skipped && item.skipped.length > 0).length
    const summary = ctx.t("updates.summary", { updated, failed, skipped })
    if (updated > 0 && lastState) {
      props.saved(lastState, summary)
    } else if (updated > 0) {
      ctx.toast.show({
        title: ctx.t("saved.title"),
        description: summary,
        variant: "success",
        icon: "circle-check",
      })
    } else {
      props.failed(new Error(summary))
    }

    const successMarketplace = new Set(
      collected
        .filter((item) => item.ok && !item.key.startsWith("package:") && !item.key.startsWith("claude:"))
        .map((item) => item.key),
    )
    const packagesSucceeded = packageTargets.length > 0 && collected.some((item) => item.ok && item.key.startsWith("package:"))
    setMarketplace((previous) => previous.filter((item) => !successMarketplace.has(item.key)))
    setClaude((previous) =>
      previous.filter((item) => !successClaudeKeys.has(item.key) && !successClaudeKeys.has(`claude:${item.id}`)),
    )
    if (packagesSucceeded) setPackages([])

    await props.refresh()
  }

  const resultLine = (result: UpdateResult) => {
    if (!result.ok) return ctx.t("updates.resultFailed", { name: result.name })
    if (result.skipped && result.skipped.length > 0) {
      return ctx.t("updates.resultSkipped", { name: result.name, items: result.skipped.join("; ") })
    }
    return ctx.t("updates.resultOk", { name: result.name })
  }

  return (
    <ctx.ui.SettingsSection
      title={
        checkedAt()
          ? `${ctx.t("updates.title")} (${ctx.t("updates.outdatedCount", { count: total() })})`
          : ctx.t("updates.title")
      }
      footer={<span class="oem-hint">{ctx.t("updates.description")}</span>}
    >
      <ctx.ui.SettingsRow
        id="oem-updates-check"
        title={ctx.t("updates.check")}
        description={
          <span class="oem-description">
            <Show when={checkedAt()}>
              <span class="oem-hint">
                {ctx.t("updates.checkedAt", {
                  time: new Date(checkedAt()!).toLocaleString(ctx.locale.locale()),
                })}
              </span>
            </Show>
            <Show when={checkError()}>
              <span class="oem-error">
                {ctx.t("updates.checkFailed")}: {checkError()}
              </span>
            </Show>
          </span>
        }
      >
        <div class="oem-actions">
          <ctx.ui.Button
            icon="refresh"
            size="small"
            busy={checking()}
            disabled={updating()}
            onClick={() => void check()}
          >
            {checking() ? ctx.t("updates.checking") : ctx.t("updates.check")}
          </ctx.ui.Button>
          <ctx.ui.Button
            variant="contrast"
            icon="download"
            size="small"
            busy={updating()}
            disabled={total() === 0 || checking()}
            onClick={() => void updateAll()}
          >
            {updating() ? ctx.t("updates.updating") : ctx.t("updates.updateAll")}
          </ctx.ui.Button>
        </div>
      </ctx.ui.SettingsRow>

      <Show when={!checkedAt() && !checking()}>
        <ctx.ui.SettingsRow title={<span class="oem-muted">{ctx.t("updates.notChecked")}</span>} />
      </Show>

      <Show when={checkedAt() && total() === 0 && !checkError()}>
        <ctx.ui.SettingsRow title={<span class="oem-hint">{ctx.t("updates.none")}</span>} />
      </Show>

      <Show when={marketplace().length > 0}>
        <ctx.ui.SettingsRow title={<span class="oem-field-label">{ctx.t("marketplaces.installedTitle")}</span>} />
        <For each={marketplace()}>
          {(item) => (
            <ctx.ui.SettingsRow
              id={`oem-update-${item.key}`}
              title={
                <span class="oem-title">
                  <span>{item.displayName ?? item.plugin}</span>
                  <span class="oem-badge">{item.marketplaceName}</span>
                  <span class="oem-badge">{ctx.t("updates.outdated")}</span>
                  <span class="oem-badge">{scopeLabel(item.scope)}</span>
                </span>
              }
              description={
                <span class="oem-description">
                  <Show when={versionLine(item)}>
                    <span class="oem-hint">{versionLine(item)}</span>
                  </Show>
                  <Show when={commitLine(item)}>
                    <span class="oem-hint">{commitLine(item)}</span>
                  </Show>
                  <Show when={item.source}>
                    <span class="oem-path">{item.source}</span>
                  </Show>
                </span>
              }
            />
          )}
        </For>
      </Show>

      <Show when={packages().length > 0}>
        <ctx.ui.SettingsRow title={<span class="oem-field-label">{ctx.t("plugins.title")}</span>} />
        <For each={packages()}>
          {(item) => (
            <ctx.ui.SettingsRow
              id={`oem-update-package-${item.target}`}
              title={
                <span class="oem-title">
                  <code>{item.target}</code>
                  <span class="oem-badge">{ctx.t("updates.outdated")}</span>
                </span>
              }
              description={
                <Show when={item.version}>
                  <span class="oem-hint">v{item.version}</span>
                </Show>
              }
            />
          )}
        </For>
      </Show>

      <Show when={claude().length > 0}>
        <ctx.ui.SettingsRow title={<span class="oem-field-label">{ctx.t("claude.title")}</span>} />
        <For each={claude()}>
          {(item) => (
            <ctx.ui.SettingsRow
              id={`oem-update-${item.key}`}
              title={
                <span class="oem-title">
                  <span>{item.name}</span>
                  <span class="oem-badge">{ctx.t("updates.outdated")}</span>
                  <span class="oem-badge">{scopeLabel(item.scope)}</span>
                </span>
              }
              description={
                <span class="oem-hint">
                  {ctx.t("updates.versionChange", {
                    current: item.currentVersion,
                    latest: item.latestVersion,
                  })}
                </span>
              }
            />
          )}
        </For>
      </Show>

      <Show when={results().length > 0}>
        <ctx.ui.SettingsRow
          title={ctx.t("updates.results")}
          description={
            <span class="oem-description">
              <For each={results()}>
                {(result) => (
                  <span class={result.ok ? "oem-hint" : "oem-error"}>
                    {resultLine(result)}
                    <Show when={result.error}> — {result.error}</Show>
                  </span>
                )}
              </For>
            </span>
          }
        />
      </Show>
    </ctx.ui.SettingsSection>
  )
}

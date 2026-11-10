import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import {
  ManagerRpc,
  type ConfigBackup,
  type ManagerState,
  type McpEntry,
  type PluginEntry,
  type Scope,
  type ScopeInfo,
} from "../rpc"
import { DiffView } from "./diff-view"
import {
  errorText,
  formatJson,
  isRecord,
  mcpSummary,
  quoteArgument,
  revealPath,
  type GuiContext,
} from "./helpers"
import type { McpStatusMap } from "./mcp"

type Severity = "error" | "warning" | "info"

function backupDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function backupSize(size: number) {
  if (size < 1024) return `${size} B`
  const units = ["KB", "MB", "GB"]
  let value = size / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}

interface FolderIssue {
  readonly scope: Scope
  readonly path: string
  readonly kind: "missing" | "unreadable"
  readonly message: string
}

function folderErrorKind(error: unknown): FolderIssue["kind"] | undefined {
  const message = errorText(error)
  if (/\bENOENT\b|no such (file|directory)|not found|does not exist/i.test(message)) return "missing"
  if (/\bEACCES\b|\bEPERM\b|permission denied|access denied|not readable|not a directory/i.test(message)) {
    return "unreadable"
  }
  return undefined
}

/** Why an MCP entry cannot start, using the same shape rules the editor enforces. */
function mcpConfigProblem(config: unknown): "unknown" | "command" | "url" | undefined {
  if (!isRecord(config)) return "unknown"
  if (config.type === "local") {
    return Array.isArray(config.command) && config.command.length > 0 ? undefined : "command"
  }
  if (config.type === "remote") {
    return typeof config.url === "string" && config.url.trim() ? undefined : "url"
  }
  return "unknown"
}

export function DoctorSection(props: {
  ctx: GuiContext
  project: string | undefined
  state: ManagerState
  statuses: Record<Scope, McpStatusMap>
  busy: string | undefined
  loading: boolean
  setBusy: (key: string | undefined) => void
  saved: (next: ManagerState, message: string) => void
  failed: (error: unknown) => void
  refresh: () => Promise<void>
  refreshStatuses: () => Promise<void>
}) {
  const ctx = props.ctx
  const [folderIssues, setFolderIssues] = createSignal<FolderIssue[]>([])
  const [backups, setBackups] = createSignal<ConfigBackup[]>([])
  const [backupsLoading, setBackupsLoading] = createSignal(false)
  const [backupError, setBackupError] = createSignal<string>()
  const [backupBusy, setBackupBusy] = createSignal<string>()
  const [fixing, setFixing] = createSignal<string>()
  const [reporting, setReporting] = createSignal(false)
  let folderGeneration = 0
  let backupGeneration = 0

  const scopeInfo = (scope: Scope): ScopeInfo | undefined =>
    scope === "global" ? props.state.global : props.state.project

  const scopeLabel = (scope: Scope) => ctx.t(scope === "global" ? "scope.global" : "scope.project")
  const activeProject = () => props.project?.trim() || props.state.project?.root
  const target = () => {
    const project = activeProject()
    return project ? { project } : {}
  }

  const severityBadge = (severity: Severity) => (
    <span class={`oem-badge oem-doctor-${severity}`}>{ctx.t(`doctor.severity.${severity}`)}</span>
  )

  const scopeBadge = (scope: Scope) => <span class="oem-badge">{scopeLabel(scope)}</span>

  const details = (severity: Severity, message?: string, path?: string, hint?: string) => (
    <span class="oem-description">
      <Show when={message}>
        <span class={severity === "error" ? "oem-error" : "oem-hint"}>{message}</span>
      </Show>
      <Show when={path}>
        <span class="oem-path">{path}</span>
      </Show>
      <Show when={hint}>
        <span class="oem-hint">{hint}</span>
      </Show>
    </span>
  )

  const reveal = (path: string | undefined) => {
    if (!path) return
    revealPath(ctx, path)
  }

  const projectProblem = createMemo(() => {
    const message = props.state.projectError
    return message ? { message, path: props.project?.trim() } : undefined
  })

  const diagnostics = createMemo(() =>
    props.state.diagnostics.map((diagnostic) => {
      const info = diagnostic.scope === "global" ? props.state.global : props.state.project
      const isSkills = Boolean(info && diagnostic.message.startsWith(`${info.skillsDir}:`))
      const isConfig = Boolean(info && diagnostic.message.startsWith(`${info.configPath}:`))
      const severity: Severity = isConfig ? "error" : "warning"
      return {
        scope: diagnostic.scope,
        severity,
        title: isSkills
          ? ctx.t("doctor.skillsProblem")
          : isConfig
            ? ctx.t("doctor.configProblem")
            : ctx.t("doctor.warning"),
        message: diagnostic.message,
        path: isSkills
          ? info?.skillsDir
          : isConfig
            ? info?.configPath
            : info?.configDir ?? props.state.global.configDir,
        reveal: (isSkills ? "skills" : "config") as "skills" | "config",
      }
    }),
  )

  const duplicateMcps = createMemo(() => {
    if (!props.state.project) return []
    const globalNames = new Set<string>()
    for (const entry of props.state.mcp) {
      if (entry.scope === "global") globalNames.add(entry.name)
    }
    return props.state.mcp.flatMap((entry) =>
      entry.scope === "project" && globalNames.has(entry.name) ? [{ name: entry.name }] : [],
    )
  })

  const invalidMcp = createMemo(() =>
    props.state.mcp.flatMap((entry) => {
      const problem = mcpConfigProblem(entry.config)
      return problem ? [{ entry, problem }] : []
    }),
  )

  const mcpIssues = createMemo(() => {
    const issues: { entry: McpEntry; runtime: McpStatusMap[string] }[] = []
    for (const entry of props.state.mcp) {
      const runtime = props.statuses[entry.scope][entry.name]
      if (!runtime) continue
      if (runtime.status !== "failed" && runtime.status !== "needs_auth") continue
      issues.push({ entry, runtime })
    }
    return issues
  })

  const duplicatePlugins = createMemo(() => {
    const groups = new Map<string, PluginEntry[]>()
    for (const entry of props.state.plugins) {
      if (!entry.package) continue
      const key = `${entry.scope}\u0000${entry.removal ? "remove" : "add"}\u0000${entry.package}`
      const group = groups.get(key)
      if (group) group.push(entry)
      else groups.set(key, [entry])
    }
    return [...groups.values()]
      .filter((entries) => entries.length > 1)
      .map((entries) => ({
        entries,
        scope: entries[0].scope,
        packageName: entries[0].package,
      }))
  })

  const invalidPlugins = createMemo(() => props.state.plugins.filter((entry) => !entry.package))

  const missingConfigs = createMemo(() => {
    const result: { scope: Scope; info: ScopeInfo }[] = []
    if (!props.state.global.configExists) result.push({ scope: "global", info: props.state.global })
    const project = props.state.project
    if (project && !project.configExists) result.push({ scope: "project", info: project })
    return result
  })

  const findingsCount = createMemo(
    () =>
      (projectProblem() ? 1 : 0) +
      diagnostics().length +
      duplicateMcps().length +
      invalidMcp().length +
      mcpIssues().length +
      duplicatePlugins().length +
      invalidPlugins().length +
      missingConfigs().length +
      folderIssues().length,
  )

  const checkFolders = async (state: ManagerState) => {
    const generation = ++folderGeneration
    const scopes: { scope: Scope; info: ScopeInfo }[] = [{ scope: "global", info: state.global }]
    if (state.project) scopes.push({ scope: "project", info: state.project })

    const found: FolderIssue[] = []
    await Promise.all(
      scopes.map(async ({ scope, info }) => {
        try {
          // A read-only probe: a missing folder is a finding, a host that refuses the call is not.
          await ctx.client.file.list({ location: { directory: info.root }, path: info.skillsDir })
        } catch (error) {
          const kind = folderErrorKind(error)
          if (kind) found.push({ scope, path: info.skillsDir, kind, message: errorText(error) })
        }
      }),
    )

    if (generation !== folderGeneration) return
    found.sort((left, right) => (left.scope === right.scope ? 0 : left.scope === "global" ? -1 : 1))
    setFolderIssues(found)
  }

  const loadBackups = async () => {
    const generation = ++backupGeneration
    setBackupsLoading(true)
    setBackupError(undefined)
    try {
      const project = props.state.project ? activeProject() : undefined
      const [globalResult, projectResult] = await Promise.all([
        ctx.client.rpc(ManagerRpc).configBackups({ scope: "global" }),
        project
          ? ctx.client.rpc(ManagerRpc).configBackups({ scope: "project", project })
          : Promise.resolve({ backups: [] as ConfigBackup[] }),
      ])
      if (generation !== backupGeneration) return
      const unique = new Map<string, ConfigBackup>()
      for (const backup of [...globalResult.backups, ...projectResult.backups]) unique.set(backup.path, backup)
      setBackups(
        [...unique.values()].sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt)),
      )
    } catch (error) {
      if (generation === backupGeneration) setBackupError(errorText(error))
    } finally {
      if (generation === backupGeneration) setBackupsLoading(false)
    }
  }

  createEffect(() => {
    const state = props.state
    void checkFolders(state)
  })

  createEffect(() => {
    props.state
    props.project
    void loadBackups()
  })

  onCleanup(() => {
    folderGeneration++
    backupGeneration++
  })

  const backupTarget = (backup: ConfigBackup) => {
    const project = backup.scope === "project" ? activeProject() : undefined
    return project ? { project } : {}
  }

  const showBackupDiff = async (backup: ConfigBackup) => {
    const key = `doctor:diff:${backup.path}`
    setBackupBusy(key)
    setBackupError(undefined)
    try {
      const diff = await ctx.client.rpc(ManagerRpc).configBackupDiff({
        scope: backup.scope,
        ...backupTarget(backup),
        path: backup.path,
      })
      ctx.dialogs.open((dialog) => (
        <ctx.ui.Dialog
          title={ctx.t("doctor.backupDiffTitle")}
          description={ctx.t("doctor.backupDiffHint", { date: backupDate(backup.modifiedAt) })}
          size="x-large"
          footer={
            <ctx.ui.Button onClick={dialog.close}>{ctx.t("common.close")}</ctx.ui.Button>
          }
        >
          <div class="oem-diff-block">
            <span class="oem-path">{diff.path}</span>
            <span class="oem-hint">{backup.path}</span>
            <DiffView ctx={ctx} before={diff.before} after={diff.after} />
          </div>
        </ctx.ui.Dialog>
      ))
    } catch (error) {
      setBackupError(errorText(error))
      props.failed(error)
    } finally {
      setBackupBusy(undefined)
    }
  }

  const restoreBackup = async (backup: ConfigBackup) => {
    const confirmed = await ctx.dialogs.confirm({
      title: ctx.t("doctor.backupRestoreTitle"),
      description: ctx.t("doctor.backupRestoreDescription", {
        path: backup.target,
        date: backupDate(backup.modifiedAt),
      }),
      confirm: ctx.t("doctor.backupRestore"),
      danger: true,
    })
    if (!confirmed) return

    const key = `doctor:restore:${backup.path}`
    setBackupBusy(key)
    setBackupError(undefined)
    try {
      const next = await ctx.client.rpc(ManagerRpc).restoreConfigBackup({
        scope: backup.scope,
        ...backupTarget(backup),
        path: backup.path,
      })
      props.saved(next, ctx.t("doctor.backupRestored", { path: backup.target }))
      await loadBackups()
    } catch (error) {
      setBackupError(errorText(error))
      props.failed(error)
    } finally {
      setBackupBusy(undefined)
    }
  }

  const ensureFolders = async (scope: Scope) => {
    const key = `doctor:ensure:${scope}`
    setFixing(key)
    try {
      const next = await ctx.client.rpc(ManagerRpc).ensureScope({ scope, ...target() })
      props.saved(next, ctx.t("doctor.ensured", { scope: scopeLabel(scope) }))
      await loadBackups()
    } catch (error) {
      props.failed(error)
    } finally {
      setFixing(undefined)
    }
  }

  const exportReport = async () => {
    setReporting(true)
    try {
      const result = await ctx.client.rpc(ManagerRpc).exportDoctorReport({
        scope: "global",
        ...target(),
        state: props.state,
      })
      reveal(result.path)
      ctx.toast.show({
        title: ctx.t("doctor.reportExported"),
        description: result.path,
        variant: "success",
        icon: "circle-check",
      })
    } catch (error) {
      props.failed(error)
    } finally {
      setReporting(false)
    }
  }

  const removeDuplicate = async (entry: PluginEntry) => {
    const confirmed = await ctx.dialogs.confirm({
      title: ctx.t("doctor.removeTitle"),
      description: ctx.t("doctor.removeDescription", {
        index: entry.index,
        name: entry.package || ctx.t("common.unknown"),
        scope: scopeLabel(entry.scope),
      }),
      confirm: ctx.t("common.delete"),
      danger: true,
    })
    if (!confirmed) return

    const key = `doctor:plugin:${entry.scope}:${entry.index}`
    props.setBusy(key)
    try {
      const next = await ctx.client.rpc(ManagerRpc).removePlugin({
        scope: entry.scope,
        ...target(),
        index: entry.index,
      })
      props.saved(next, ctx.t("doctor.removed", { name: entry.package }))
    } catch (error) {
      props.failed(error)
    } finally {
      props.setBusy(undefined)
    }
  }

  const retryMcp = async (entry: McpEntry) => {
    const key = `doctor:mcp:${entry.scope}:${entry.name}`
    props.setBusy(key)
    try {
      await ctx.client.mcp.connect({
        server: entry.name,
        ...(entry.scope === "project" && props.project?.trim()
          ? { location: { directory: props.project.trim() } }
          : {}),
      })
      ctx.toast.show({
        title: ctx.t("doctor.retryRequested", { name: entry.name }),
        variant: "default",
      })
      window.setTimeout(() => void props.refreshStatuses(), 800)
    } catch (error) {
      props.failed(error)
    } finally {
      props.setBusy(undefined)
    }
  }

  const copyLogin = async (entry: McpEntry) => {
    const command = `opencode mcp auth ${quoteArgument(entry.name)}`
    try {
      await ctx.system.copy(command)
      ctx.toast.show({
        title: ctx.t("mcp.login"),
        description: ctx.t("mcp.loginCopied", { command }),
        variant: "default",
      })
    } catch (error) {
      props.failed(error)
    }
  }

  return (
    <>
    <ctx.ui.SettingsSection
      title={ctx.t("doctor.title")}
      footer={
        <div class="oem-footer">
          <ctx.ui.Button icon="refresh" size="small" busy={props.loading} onClick={() => void props.refresh()}>
            {ctx.t("doctor.refresh")}
          </ctx.ui.Button>
          <ctx.ui.Button
            icon="download"
            size="small"
            busy={reporting()}
            onClick={() => void exportReport()}
          >
            {ctx.t("doctor.exportReport")}
          </ctx.ui.Button>
          <span class="oem-hint">{ctx.t("doctor.footer")}</span>
        </div>
      }
    >
      <ctx.ui.SettingsRow
        id="oem-doctor"
        title={findingsCount() === 0 ? ctx.t("doctor.empty") : ctx.t("doctor.summary", { count: findingsCount() })}
        description={
          <span class="oem-hint">
            {findingsCount() === 0 ? ctx.t("doctor.emptyHint") : ctx.t("doctor.description")}
          </span>
        }
      />

      <Show when={projectProblem()}>
        {(problem) => (
          <ctx.ui.SettingsRow
            title={
              <span class="oem-title">
                {severityBadge("error")}
                <span>{ctx.t("doctor.projectProblem")}</span>
              </span>
            }
            description={details("error", problem().message, problem().path, undefined)}
          >
            <Show when={problem().path}>
              <ctx.ui.IconButton
                icon="folder"
                size="small"
                label={ctx.t("doctor.revealProject")}
                onClick={() => reveal(problem().path)}
              />
            </Show>
          </ctx.ui.SettingsRow>
        )}
      </Show>

      <For each={diagnostics()}>
        {(item) => (
          <ctx.ui.SettingsRow
            title={
              <span class="oem-title">
                {severityBadge(item.severity)}
                <span>{item.title}</span>
                {scopeBadge(item.scope)}
              </span>
            }
            description={details(item.severity, item.message, item.path, undefined)}
          >
            <ctx.ui.IconButton
              icon="folder"
              size="small"
              label={item.reveal === "skills" ? ctx.t("doctor.revealSkills") : ctx.t("doctor.revealConfig")}
              onClick={() => reveal(item.path)}
            />
          </ctx.ui.SettingsRow>
        )}
      </For>

      <For each={mcpIssues()}>
        {(item) => {
          const needsAuth = item.runtime.status === "needs_auth"
          const severity: Severity = needsAuth ? "warning" : "error"
          const info = () => scopeInfo(item.entry.scope)
          const key = () => `doctor:mcp:${item.entry.scope}:${item.entry.name}`
          return (
            <ctx.ui.SettingsRow
              title={
                <span class="oem-title">
                  {severityBadge(severity)}
                  <code>{item.entry.name}</code>
                  <span>{needsAuth ? ctx.t("doctor.mcpNeedsAuth") : ctx.t("doctor.mcpFailed")}</span>
                  {scopeBadge(item.entry.scope)}
                </span>
              }
              description={details(
                severity,
                item.runtime.error ?? mcpSummary(item.entry.config),
                info()?.configPath,
                needsAuth ? ctx.t("doctor.mcpNeedsAuthHint") : ctx.t("doctor.mcpFailedHint"),
              )}
            >
              <div class="oem-actions">
                <Show when={needsAuth}>
                  <ctx.ui.Button icon="lock" size="small" onClick={() => void copyLogin(item.entry)}>
                    {ctx.t("mcp.login")}
                  </ctx.ui.Button>
                </Show>
                <ctx.ui.Button
                  icon="refresh"
                  size="small"
                  busy={props.busy === key()}
                  onClick={() => void retryMcp(item.entry)}
                >
                  {ctx.t("doctor.retry")}
                </ctx.ui.Button>
                <ctx.ui.IconButton
                  icon="folder"
                  size="small"
                  label={ctx.t("doctor.revealConfig")}
                  onClick={() => reveal(info()?.configPath)}
                />
              </div>
            </ctx.ui.SettingsRow>
          )
        }}
      </For>

      <For each={invalidMcp()}>
        {(item) => {
          const info = () => scopeInfo(item.entry.scope)
          const hint = () =>
            item.problem === "command"
              ? ctx.t("doctor.invalidMcpCommand")
              : item.problem === "url"
                ? ctx.t("doctor.invalidMcpUrl")
                : ctx.t("doctor.invalidMcpUnknown")
          return (
            <ctx.ui.SettingsRow
              title={
                <span class="oem-title">
                  {severityBadge("warning")}
                  <code>{item.entry.name}</code>
                  <span>{ctx.t("doctor.invalidMcp")}</span>
                  {scopeBadge(item.entry.scope)}
                </span>
              }
              description={details("warning", mcpSummary(item.entry.config), info()?.configPath, hint())}
            >
              <ctx.ui.IconButton
                icon="folder"
                size="small"
                label={ctx.t("doctor.revealConfig")}
                onClick={() => reveal(info()?.configPath)}
              />
            </ctx.ui.SettingsRow>
          )
        }}
      </For>

      <For each={duplicateMcps()}>
        {(item) => (
          <ctx.ui.SettingsRow
            title={
              <span class="oem-title">
                {severityBadge("warning")}
                <code>{item.name}</code>
                <span>{ctx.t("doctor.duplicateMcp")}</span>
              </span>
            }
            description={
              <span class="oem-description">
                <span class="oem-hint">{ctx.t("doctor.duplicateMcpHint", { name: item.name })}</span>
                <span class="oem-path">
                  {ctx.t("scope.global")}: {props.state.global.configPath}
                </span>
                <Show when={props.state.project}>
                  {(project) => (
                    <span class="oem-path">
                      {ctx.t("scope.project")}: {project().configPath}
                    </span>
                  )}
                </Show>
              </span>
            }
          >
            <div class="oem-actions">
              <ctx.ui.IconButton
                icon="folder"
                size="small"
                label={ctx.t("doctor.revealConfigScope", { scope: ctx.t("scope.global") })}
                onClick={() => reveal(props.state.global.configPath)}
              />
              <Show when={props.state.project}>
                {(project) => (
                  <ctx.ui.IconButton
                    icon="folder"
                    size="small"
                    label={ctx.t("doctor.revealConfigScope", { scope: ctx.t("scope.project") })}
                    onClick={() => reveal(project().configPath)}
                  />
                )}
              </Show>
            </div>
          </ctx.ui.SettingsRow>
        )}
      </For>

      <For each={duplicatePlugins()}>
        {(item) => {
          const info = () => scopeInfo(item.scope)
          return (
            <ctx.ui.SettingsRow
              title={
                <span class="oem-title">
                  {severityBadge("warning")}
                  <code>{item.packageName}</code>
                  <span>{ctx.t("doctor.duplicatePlugin")}</span>
                  {scopeBadge(item.scope)}
                </span>
              }
              description={
                <span class="oem-description">
                  <span class="oem-hint">
                    {ctx.t("doctor.duplicatePluginHint", {
                      name: item.packageName,
                      scope: scopeLabel(item.scope),
                    })}
                  </span>
                  <span class="oem-path">{info()?.configPath}</span>
                  <span class="oem-hint">
                    {ctx.t("doctor.entries", { indices: item.entries.map((entry) => `#${entry.index}`).join(", ") })}
                  </span>
                </span>
              }
            >
              <div class="oem-actions">
                <For each={item.entries.slice(1)}>
                  {(entry) => {
                    const key = () => `doctor:plugin:${entry.scope}:${entry.index}`
                    return (
                      <ctx.ui.Button
                        icon="trash"
                        size="small"
                        variant="danger"
                        busy={props.busy === key()}
                        onClick={() => void removeDuplicate(entry)}
                      >
                        {ctx.t("doctor.removeEntry", { index: entry.index })}
                      </ctx.ui.Button>
                    )
                  }}
                </For>
                <ctx.ui.IconButton
                  icon="folder"
                  size="small"
                  label={ctx.t("doctor.revealConfig")}
                  onClick={() => reveal(info()?.configPath)}
                />
              </div>
            </ctx.ui.SettingsRow>
          )
        }}
      </For>

      <For each={invalidPlugins()}>
        {(entry) => {
          const info = () => scopeInfo(entry.scope)
          return (
            <ctx.ui.SettingsRow
              title={
                <span class="oem-title">
                  {severityBadge("warning")}
                  <span>{ctx.t("doctor.invalidPlugin")}</span>
                  {scopeBadge(entry.scope)}
                </span>
              }
              description={
                <span class="oem-description">
                  <span class="oem-command">{formatJson(entry.raw)}</span>
                  <span class="oem-path">{info()?.configPath}</span>
                  <span class="oem-hint">{ctx.t("doctor.invalidPluginHint")}</span>
                </span>
              }
            >
              <ctx.ui.IconButton
                icon="folder"
                size="small"
                label={ctx.t("doctor.revealConfig")}
                onClick={() => reveal(info()?.configPath)}
              />
            </ctx.ui.SettingsRow>
          )
        }}
      </For>

      <For each={folderIssues()}>
        {(item) => {
          const missing = item.kind === "missing"
          const severity: Severity = missing ? "info" : "warning"
          return (
            <ctx.ui.SettingsRow
              title={
                <span class="oem-title">
                  {severityBadge(severity)}
                  <span>{missing ? ctx.t("doctor.missingSkills") : ctx.t("doctor.unreadableSkills")}</span>
                  {scopeBadge(item.scope)}
                </span>
              }
              description={details(
                severity,
                missing ? undefined : item.message,
                item.path,
                missing ? ctx.t("doctor.missingSkillsHint") : ctx.t("doctor.unreadableSkillsHint"),
              )}
            >
              <div class="oem-actions">
                <Show when={missing}>
                  <ctx.ui.Button
                    icon="folder-add-left"
                    size="small"
                    busy={fixing() === `doctor:ensure:${item.scope}`}
                    onClick={() => void ensureFolders(item.scope)}
                  >
                    {ctx.t("doctor.ensureScope")}
                  </ctx.ui.Button>
                </Show>
                <ctx.ui.IconButton
                  icon="folder"
                  size="small"
                  label={ctx.t("doctor.revealSkills")}
                  onClick={() => reveal(item.path)}
                />
              </div>
            </ctx.ui.SettingsRow>
          )
        }}
      </For>

      <For each={missingConfigs()}>
        {(item) => (
          <ctx.ui.SettingsRow
            title={
              <span class="oem-title">
                {severityBadge("info")}
                <span>{ctx.t("doctor.missingConfig")}</span>
                {scopeBadge(item.scope)}
              </span>
            }
            description={details("info", undefined, item.info.configPath, ctx.t("doctor.missingConfigHint"))}
          >
            <div class="oem-actions">
              <ctx.ui.Button
                icon="folder-add-left"
                size="small"
                busy={fixing() === `doctor:ensure:${item.scope}`}
                onClick={() => void ensureFolders(item.scope)}
              >
                {ctx.t("doctor.ensureScope")}
              </ctx.ui.Button>
              <ctx.ui.IconButton
                icon="folder"
                size="small"
                label={ctx.t("doctor.revealConfigFolder")}
                onClick={() => reveal(item.info.configDir)}
              />
            </div>
          </ctx.ui.SettingsRow>
        )}
      </For>
    </ctx.ui.SettingsSection>

      <ctx.ui.SettingsSection
        title={ctx.t("doctor.backups")}
        footer={
          <div class="oem-footer">
            <ctx.ui.Button
              icon="refresh"
              size="small"
              busy={backupsLoading()}
              onClick={() => void loadBackups()}
            >
              {ctx.t("doctor.refreshBackups")}
            </ctx.ui.Button>
            <span class="oem-hint">{ctx.t("doctor.backupsHint")}</span>
          </div>
        }
      >
        <ctx.ui.SettingsRow
          id="oem-doctor-backups"
          title={ctx.t("doctor.backups")}
          description={<span class="oem-hint">{ctx.t("doctor.backupSafetyHint")}</span>}
        />

        <Show when={backupError()}>
          <ctx.ui.SettingsRow
            title={
              <span class="oem-title">
                {severityBadge("error")}
                <span>{ctx.t("doctor.backupError")}</span>
              </span>
            }
            description={<span class="oem-error">{backupError()}</span>}
          />
        </Show>

        <Show
          when={backups().length > 0}
          fallback={
            <ctx.ui.SettingsRow
              title={
                <span class="oem-muted">
                  {backupsLoading() ? ctx.t("doctor.backupsLoading") : ctx.t("doctor.backupsEmpty")}
                </span>
              }
              description={<span class="oem-hint">{ctx.t("doctor.backupsEmptyHint")}</span>}
            />
          }
        >
          <For each={backups()}>
            {(backup) => {
              const diffKey = () => `doctor:diff:${backup.path}`
              const restoreKey = () => `doctor:restore:${backup.path}`
              return (
                <ctx.ui.SettingsRow
                  title={
                    <span class="oem-title">
                      <span class="oem-badge">
                        {backup.kind === "registry"
                          ? ctx.t("doctor.backupRegistry")
                          : ctx.t("doctor.backupConfig")}
                      </span>
                      <span>{backupDate(backup.modifiedAt)}</span>
                      {scopeBadge(backup.scope)}
                    </span>
                  }
                  description={
                    <span class="oem-description">
                      <span class="oem-path">{backup.path}</span>
                      <span class="oem-hint">
                        {ctx.t("doctor.backupMeta", {
                          size: backupSize(backup.size),
                          path: backup.target,
                        })}
                      </span>
                    </span>
                  }
                >
                  <div class="oem-actions">
                    <ctx.ui.Button
                      icon="eye"
                      size="small"
                      busy={backupBusy() === diffKey()}
                      onClick={() => void showBackupDiff(backup)}
                    >
                      {ctx.t("doctor.backupDiff")}
                    </ctx.ui.Button>
                    <ctx.ui.Button
                      icon="arrow-undo-down"
                      size="small"
                      variant="danger"
                      busy={backupBusy() === restoreKey()}
                      onClick={() => void restoreBackup(backup)}
                    >
                      {ctx.t("doctor.backupRestore")}
                    </ctx.ui.Button>
                    <ctx.ui.IconButton
                      icon="folder"
                      size="small"
                      label={ctx.t("common.showInFolder")}
                      onClick={() => reveal(backup.path)}
                    />
                  </div>
                </ctx.ui.SettingsRow>
              )
            }}
          </For>
        </Show>
      </ctx.ui.SettingsSection>
    </>
  )
}

import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { ManagerRpc, type ConfigPreview, type ManagerState, type McpEntry, type Scope } from "../rpc"
import { DiffView } from "./diff-view"
import {
  errorText,
  formatCommand,
  formatJson,
  formatPairs,
  hasSecretHeaders,
  isRecord,
  maskedMcpPairs,
  mcpDisabled,
  mcpHasPairs,
  mcpSummary,
  mcpType,
  parsePairs,
  quoteArgument,
  runtimeStatus,
  sanitizeMcpConfig,
  type GuiContext,
  type RuntimeStatus,
  splitCommand,
  statusClass,
  statusKey,
} from "./helpers"
import {
  allSelected,
  pruneSelected,
  readSortPreference,
  selectAllSelected,
  sortItems,
  toggleSelected,
  writeSortPreference,
  type SortKey,
} from "./list"
import { BulkBar, SelectionBox, SortControl, type BulkProgress, type BulkResult } from "./ui"

export interface McpStatusMap {
  readonly [name: string]: { status: RuntimeStatus; error?: string }
}

const runtimeRank: Record<RuntimeStatus, number> = {
  connected: 0,
  pending: 1,
  needs_auth: 2,
  failed: 3,
  disabled: 4,
  unknown: 5,
}

function mcpKey(entry: McpEntry) {
  return `${entry.scope}:${entry.name}`
}

export function McpSection(props: {
  ctx: GuiContext
  scope: Scope
  project: string | undefined
  state: ManagerState
  busy: string | undefined
  statuses: McpStatusMap
  setBusy: (key: string | undefined) => void
  refreshStatuses: () => void
  saved: (next: ManagerState, message: string) => void
  failed: (error: unknown) => void
}) {
  const ctx = props.ctx
  const entries = () => props.state.mcp.filter((entry) => entry.scope === props.scope)
  const target = () => (props.project?.trim() ? { project: props.project.trim() } : {})
  const scopeLabel = () => (props.scope === "global" ? ctx.t("scope.global") : ctx.t("scope.project"))
  const storage = (() => {
    try {
      return window.localStorage
    } catch {
      return undefined
    }
  })()
  const [sort, setSort] = createSignal<SortKey>(
    readSortPreference(storage, "oem.sort.mcp", ["name", "status"], "name"),
  )
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set())
  const [bulkBusy, setBulkBusy] = createSignal(false)
  const [bulkProgress, setBulkProgress] = createSignal<BulkProgress>()
  const [bulkResult, setBulkResult] = createSignal<BulkResult>()
  const sortedEntries = createMemo(() =>
    sortItems(entries(), sort(), {
      name: (entry) => entry.name,
      status: (entry) => runtimeRank[props.statuses[entry.name]?.status ?? "unknown"],
    }),
  )
  const selectionKeys = () => sortedEntries().map(mcpKey)

  const changeSort = (value: SortKey) => {
    setSort(value)
    writeSortPreference(storage, "oem.sort.mcp", value)
  }

  createEffect(() => {
    const available = new Set(entries().map(mcpKey))
    setSelected((current) => pruneSelected(current, available))
  })

  const edit = (entry?: McpEntry) => {
    ctx.dialogs.open((dialog) => (
      <McpDialog
        ctx={ctx}
        scope={props.scope}
        project={props.project}
        {...(entry ? { entry } : {})}
        names={entries().map((item) => item.name)}
        onClose={dialog.close}
        onSaved={(next, name) => {
          props.saved(next, ctx.t("mcp.saved", { name }))
          dialog.close()
        }}
      />
    ))
  }

  const toggle = async (entry: McpEntry, enabled: boolean) => {
    const key = `mcp:${entry.scope}:${entry.name}`
    props.setBusy(key)
    try {
      const next = await ctx.client.rpc(ManagerRpc).setMcpEnabled({
        scope: entry.scope,
        ...target(),
        name: entry.name,
        enabled,
      })
      props.saved(next, ctx.t("mcp.saved", { name: entry.name }))
    } catch (error) {
      props.failed(error)
    } finally {
      props.setBusy(undefined)
    }
  }

  const reconnect = async (entry: McpEntry) => {
    const key = `mcp:${entry.scope}:${entry.name}`
    props.setBusy(key)
    try {
      await ctx.client.mcp.connect({
        server: entry.name,
        ...(entry.scope === "project" && props.project?.trim()
          ? { location: { directory: props.project.trim() } }
          : {}),
      })
      ctx.toast.show({
        title: ctx.t("mcp.reconnectRequested", { name: entry.name }),
        variant: "default",
        duration: 4000,
      })
      window.setTimeout(() => props.refreshStatuses(), 800)
    } catch (error) {
      props.failed(error)
    } finally {
      props.setBusy(undefined)
    }
  }

  const remove = async (entry: McpEntry) => {
    const confirmed = await ctx.dialogs.confirm({
      title: ctx.t("mcp.deleteTitle"),
      description: ctx.t("mcp.deleteDescription", { name: entry.name, scope: scopeLabel() }),
      confirm: ctx.t("common.delete"),
      danger: true,
    })
    if (!confirmed) return
    const key = `mcp:${entry.scope}:${entry.name}`
    props.setBusy(key)
    try {
      const next = await ctx.client.rpc(ManagerRpc).removeMcp({
        scope: entry.scope,
        ...target(),
        name: entry.name,
      })
      props.saved(next, ctx.t("mcp.deleted", { name: entry.name }))
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

  const copySanitized = async (entry: McpEntry) => {
    try {
      await ctx.system.copy(formatJson(sanitizeMcpConfig(entry.config)))
      ctx.toast.show({
        title: ctx.t("mcp.copySanitized"),
        description: ctx.t("mcp.copySanitizedDone"),
        variant: "default",
      })
    } catch (error) {
      props.failed(error)
    }
  }

  const runBulk = async (mode: "enable" | "disable" | "delete") => {
    const targets = sortedEntries().filter((entry) => selected().has(mcpKey(entry)))
    if (targets.length === 0) return
    if (mode === "delete") {
      const confirmed = await ctx.dialogs.confirm({
        title: ctx.t("bulk.deleteTitle"),
        description: ctx.t("bulk.deleteDescription", {
          count: targets.length,
          scope: scopeLabel(),
        }),
        confirm: ctx.t("common.delete"),
        danger: true,
      })
      if (!confirmed) return
    }

    setBulkBusy(true)
    setBulkResult(undefined)
    props.setBusy("mcp:bulk")
    let lastState: ManagerState | undefined
    let ok = 0
    const failures: string[] = []
    const succeeded: string[] = []

    try {
      for (let index = 0; index < targets.length; index++) {
        const entry = targets[index]!
        setBulkProgress({
          current: index + 1,
          total: targets.length,
          name: entry.name,
          mode: mode === "delete" ? "delete" : "toggle",
        })
        try {
          const next =
            mode === "delete"
              ? await ctx.client.rpc(ManagerRpc).removeMcp({
                  scope: entry.scope,
                  ...target(),
                  name: entry.name,
                })
              : await ctx.client.rpc(ManagerRpc).setMcpEnabled({
                  scope: entry.scope,
                  ...target(),
                  name: entry.name,
                  enabled: mode === "enable",
                })
          lastState = next
          ok++
          succeeded.push(mcpKey(entry))
        } catch (error) {
          failures.push(`${entry.name}: ${errorText(error)}`)
        }
      }

      setBulkResult({ ok, failed: failures.length, failures })
      const summary = ctx.t("bulk.summary", { ok, failed: failures.length })
      if (lastState) props.saved(lastState, summary)
      else if (failures.length > 0) props.failed(new Error(`${summary}. ${failures.join("; ")}`))
      if (succeeded.length > 0) {
        setSelected((current) => {
          const next = new Set(current)
          for (const key of succeeded) next.delete(key)
          return next
        })
      }
    } finally {
      setBulkBusy(false)
      setBulkProgress(undefined)
      props.setBusy(undefined)
    }
  }

  return (
    <ctx.ui.SettingsSection
      title={ctx.t("mcp.title")}
      footer={
        <div class="oem-footer">
          <ctx.ui.Button icon="plus" size="small" onClick={() => edit()}>
            {ctx.t("mcp.add")}
          </ctx.ui.Button>
          <span class="oem-hint">{ctx.t("mcp.authHint")}</span>
          <Show when={bulkResult() && selected().size === 0}>
            <span class={bulkResult()!.failed > 0 ? "oem-error" : "oem-hint"}>
              {ctx.t("bulk.summary", {
                ok: bulkResult()!.ok,
                failed: bulkResult()!.failed,
              })}
            </span>
          </Show>
        </div>
      }
    >
      <Show when={entries().length > 0}>
        <div class="oem-list-header">
          <label class="oem-check-label">
            <SelectionBox
              checked={allSelected(selected(), selectionKeys())}
              label={ctx.t("bulk.selectAll")}
              disabled={bulkBusy()}
              onChange={(checked) =>
                setSelected((current) => selectAllSelected(current, selectionKeys(), checked))
              }
            />
            <span>{ctx.t("bulk.selectAll")}</span>
          </label>
          <span class="oem-hint">{ctx.t("bulk.selected", { count: selected().size })}</span>
          <SortControl
            ctx={ctx}
            value={sort()}
            options={[
              { value: "name", label: ctx.t("sort.name") },
              { value: "status", label: ctx.t("sort.status") },
            ]}
            onChange={changeSort}
          />
        </div>
        <Show when={selected().size > 0}>
          <BulkBar
            ctx={ctx}
            count={selected().size}
            progress={bulkProgress()}
            result={bulkResult()}
            busy={bulkBusy()}
          >
            <ctx.ui.Button
              size="small"
              disabled={bulkBusy()}
              onClick={() => void runBulk("enable")}
            >
              {ctx.t("bulk.enable")}
            </ctx.ui.Button>
            <ctx.ui.Button
              size="small"
              disabled={bulkBusy()}
              onClick={() => void runBulk("disable")}
            >
              {ctx.t("bulk.disable")}
            </ctx.ui.Button>
            <ctx.ui.Button
              variant="danger"
              icon="trash"
              size="small"
              disabled={bulkBusy()}
              onClick={() => void runBulk("delete")}
            >
              {ctx.t("bulk.delete")}
            </ctx.ui.Button>
          </BulkBar>
        </Show>
      </Show>
      <Show
        when={entries().length > 0}
        fallback={
          <ctx.ui.SettingsRow
            id="oem-mcp-empty"
            title={<span class="oem-muted">{ctx.t("mcp.empty")}</span>}
          />
        }
      >
        <For each={sortedEntries()}>
          {(entry) => {
            const runtime = () => props.statuses[entry.name] ?? { status: "unknown" as RuntimeStatus }
            const disabled = () => mcpDisabled(entry.config)
            const key = () => `mcp:${entry.scope}:${entry.name}`
            const [revealSecrets, setRevealSecrets] = createSignal(false)
            return (
              <ctx.ui.SettingsRow
                id={`oem-mcp-${entry.scope}-${entry.name}`}
                title={
                  <span class="oem-title">
                    <SelectionBox
                      checked={selected().has(mcpKey(entry))}
                      label={entry.name}
                      disabled={bulkBusy()}
                      onChange={(checked) =>
                        setSelected((current) => toggleSelected(current, mcpKey(entry), checked))
                      }
                    />
                    <span>{entry.name}</span>
                    <span class={`oem-badge oem-badge-${mcpType(entry.config)}`}>
                      {ctx.t(`mcp.type.${mcpType(entry.config)}`)}
                    </span>
                    <span class={`oem-status ${statusClass(runtime().status)}`}>
                      <span class="oem-dot" />
                      {ctx.t(statusKey(runtime().status))}
                    </span>
                  </span>
                }
                description={
                  <span class="oem-description">
                    <Show when={mcpSummary(entry.config)}>
                      <code class="oem-command">{mcpSummary(entry.config)}</code>
                    </Show>
                    <Show when={mcpHasPairs(entry.config)}>
                      <code class="oem-command">{maskedMcpPairs(entry.config, revealSecrets())}</code>
                    </Show>
                    <Show when={entry.scope === "project" && hasSecretHeaders(entry.config)}>
                      <span class="oem-warning">{ctx.t("mcp.projectSecretWarning")}</span>
                    </Show>
                    <Show when={runtime().error}>
                      <span class="oem-error">{runtime().error}</span>
                    </Show>
                  </span>
                }
              >
                <div class="oem-actions">
                  <Show when={runtime().status === "failed"}>
                    <ctx.ui.Button
                      icon="refresh"
                      size="small"
                      disabled={props.busy === key() || bulkBusy()}
                      onClick={() => void reconnect(entry)}
                    >
                      {ctx.t("mcp.reconnect")}
                    </ctx.ui.Button>
                  </Show>
                  <Show when={runtime().status === "needs_auth"}>
                    <ctx.ui.Button
                      icon="lock"
                      size="small"
                      disabled={props.busy === key() || bulkBusy()}
                      onClick={() => void copyLogin(entry)}
                    >
                      {ctx.t("mcp.login")}
                    </ctx.ui.Button>
                  </Show>
                  <Show when={mcpHasPairs(entry.config)}>
                    <ctx.ui.IconButton
                      icon={revealSecrets() ? "outline-eye-slash" : "eye"}
                      size="small"
                      label={ctx.t(revealSecrets() ? "mcp.hideSecrets" : "mcp.showSecrets")}
                      pressed={revealSecrets()}
                      disabled={props.busy === key()}
                      onClick={() => setRevealSecrets(!revealSecrets())}
                    />
                  </Show>
                  <ctx.ui.IconButton
                    icon="copy"
                    size="small"
                    label={ctx.t("mcp.copySanitized")}
                    disabled={props.busy === key()}
                    onClick={() => void copySanitized(entry)}
                  />
                  <ctx.ui.Switch
                    checked={!disabled()}
                    disabled={props.busy === key() || bulkBusy()}
                    label={ctx.t("mcp.disabled")}
                    hideLabel
                    onChange={(enabled) => void toggle(entry, enabled)}
                  />
                  <ctx.ui.IconButton
                    icon="edit"
                    size="small"
                    label={ctx.t("common.edit")}
                    disabled={props.busy === key() || bulkBusy()}
                    onClick={() => edit(entry)}
                  />
                  <ctx.ui.IconButton
                    icon="trash"
                    size="small"
                    label={ctx.t("common.delete")}
                    disabled={props.busy === key() || bulkBusy()}
                    onClick={() => void remove(entry)}
                  />
                </div>
              </ctx.ui.SettingsRow>
            )
          }}
        </For>
      </Show>
    </ctx.ui.SettingsSection>
  )
}

function McpDialog(props: {
  ctx: GuiContext
  scope: Scope
  project: string | undefined
  entry?: McpEntry
  names: readonly string[]
  onClose: () => void
  onSaved: (next: ManagerState, name: string) => void
}) {
  const ctx = props.ctx
  const config = props.entry?.config
  const initialType = mcpType(config) === "remote" ? "remote" : "local"
  const record = isRecord(config) ? config : undefined

  const [name, setName] = createSignal(props.entry?.name ?? "")
  const [type, setType] = createSignal<"local" | "remote">(initialType)
  const [command, setCommand] = createSignal(
    initialType === "local" && Array.isArray(record?.command)
      ? formatCommand(record.command.filter((item): item is string => typeof item === "string"))
      : "",
  )
  const [cwd, setCwd] = createSignal(typeof record?.cwd === "string" ? record.cwd : "")
  const [environment, setEnvironment] = createSignal(formatPairs(record?.environment))
  const [url, setUrl] = createSignal(typeof record?.url === "string" ? record.url : "")
  const [headers, setHeaders] = createSignal(formatPairs(record?.headers))
  const oauthRecord = isRecord(record?.oauth) ? record.oauth : undefined
  const [oauthMode, setOauthMode] = createSignal<"auto" | "enabled" | "disabled">(
    record?.oauth === false ? "disabled" : oauthRecord ? "enabled" : "auto",
  )
  const [oauthClientId, setOauthClientId] = createSignal(
    typeof oauthRecord?.client_id === "string" ? oauthRecord.client_id : "",
  )
  const [oauthClientSecret, setOauthClientSecret] = createSignal(
    typeof oauthRecord?.client_secret === "string" ? oauthRecord.client_secret : "",
  )
  const [oauthScope, setOauthScope] = createSignal(
    typeof oauthRecord?.scope === "string" ? oauthRecord.scope : "",
  )
  const [oauthCallbackPort, setOauthCallbackPort] = createSignal(
    typeof oauthRecord?.callback_port === "number" ? String(oauthRecord.callback_port) : "",
  )
  const [oauthRedirectUri, setOauthRedirectUri] = createSignal(
    typeof oauthRecord?.redirect_uri === "string" ? oauthRecord.redirect_uri : "",
  )
  const [oauthMetadataUrl, setOauthMetadataUrl] = createSignal(
    typeof oauthRecord?.auth_server_metadata_url === "string" ? oauthRecord.auth_server_metadata_url : "",
  )
  const [disabled, setDisabled] = createSignal(mcpDisabled(config))
  const [saving, setSaving] = createSignal(false)
  const [previewing, setPreviewing] = createSignal(false)
  const [preview, setPreview] = createSignal<ConfigPreview>()
  const [error, setError] = createSignal<string>()

  const target = () => (props.project?.trim() ? { project: props.project.trim() } : {})

  // A preview describes the values at the moment it was requested; hide it as soon as any field
  // changes, so an old diff can never look like the current form.
  createEffect(() => {
    name()
    type()
    command()
    cwd()
    environment()
    url()
    headers()
    oauthMode()
    oauthClientId()
    oauthClientSecret()
    oauthScope()
    oauthCallbackPort()
    oauthRedirectUri()
    oauthMetadataUrl()
    disabled()
    setPreview(undefined)
  })

  const copyLogin = async () => {
    const server = name().trim()
    if (!server) return
    const command = `opencode mcp auth ${quoteArgument(server)}`
    try {
      await ctx.system.copy(command)
      ctx.toast.show({
        title: ctx.t("mcp.login"),
        description: ctx.t("mcp.loginCopied", { command }),
        variant: "default",
      })
    } catch (copyError) {
      setError(errorText(copyError))
    }
  }

  const buildConfig = (): Record<string, unknown> => {
    const next: Record<string, unknown> = { type: type() }
    // `null` tells the server to delete an optional field that the user cleared.
    next.disabled = disabled() ? true : null
    if (type() === "local") {
      const parts = splitCommand(command())
      if (parts.length === 0) throw new Error(ctx.t("mcp.commandRequired"))
      const pairs = parsePairs(environment())
      if (pairs.invalid.length > 0) {
        throw new Error(ctx.t("common.invalidLines", { lines: pairs.invalid.join(", ") }))
      }
      next.command = parts
      next.environment = Object.keys(pairs.values).length > 0 ? pairs.values : null
      next.cwd = cwd().trim() || null
    } else {
      if (!url().trim()) throw new Error(ctx.t("mcp.urlRequired"))
      const pairs = parsePairs(headers())
      if (pairs.invalid.length > 0) {
        throw new Error(ctx.t("common.invalidLines", { lines: pairs.invalid.join(", ") }))
      }
      next.url = url().trim()
      next.headers = Object.keys(pairs.values).length > 0 ? pairs.values : null
      if (oauthMode() === "auto") {
        // `null` removes the field, leaving OpenCode's automatic OAuth detection in charge.
        next.oauth = null
      } else if (oauthMode() === "disabled") {
        next.oauth = false
      } else {
        const oauth: Record<string, unknown> = isRecord(record?.oauth) ? { ...record.oauth } : {}
        const put = (key: string, value: string) => {
          if (value.trim()) oauth[key] = value.trim()
          else delete oauth[key]
        }
        put("client_id", oauthClientId())
        put("client_secret", oauthClientSecret())
        put("scope", oauthScope())
        put("redirect_uri", oauthRedirectUri())
        put("auth_server_metadata_url", oauthMetadataUrl())
        const port = oauthCallbackPort().trim()
        if (port) {
          const parsed = Number(port)
          if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535)
            throw new Error(ctx.t("mcp.oauthPortInvalid"))
          oauth.callback_port = parsed
        } else {
          delete oauth.callback_port
        }
        next.oauth = oauth
      }
    }
    return next
  }

  const showPreview = async () => {
    setError(undefined)
    try {
      const next = buildConfig()
      setPreviewing(true)
      const result = await ctx.client.rpc(ManagerRpc).previewMcp({
        scope: props.scope,
        ...target(),
        name: name().trim(),
        ...(props.entry ? { originalName: props.entry.name } : {}),
        config: next,
      })
      setPreview(result)
    } catch (previewError) {
      setPreview(undefined)
      setError(errorText(previewError))
    } finally {
      setPreviewing(false)
    }
  }

  const save = async () => {
    setError(undefined)
    try {
      const trimmed = name().trim()
      if (
        trimmed &&
        props.names.some((existing) => existing !== props.entry?.name && existing === trimmed)
      ) {
        setError(ctx.t("common.alreadyExists", { name: trimmed }))
        return
      }
      const next = buildConfig()

      setSaving(true)
      const state = await ctx.client.rpc(ManagerRpc).saveMcp({
        scope: props.scope,
        ...target(),
        name: trimmed,
        ...(props.entry ? { originalName: props.entry.name } : {}),
        config: next,
      })
      props.onSaved(state, trimmed)
    } catch (saveError) {
      setError(errorText(saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ctx.ui.Dialog
      title={props.entry ? ctx.t("mcp.dialog.edit") : ctx.t("mcp.dialog.new")}
      size="large"
      footer={
        <>
          <ctx.ui.Button onClick={props.onClose} disabled={saving()}>
            {ctx.t("common.cancel")}
          </ctx.ui.Button>
          <ctx.ui.Button
            icon="eye"
            busy={previewing()}
            disabled={saving()}
            onClick={() => void showPreview()}
          >
            {ctx.t("mcp.preview")}
          </ctx.ui.Button>
          <ctx.ui.Button variant="contrast" busy={saving()} onClick={() => void save()}>
            {ctx.t("common.save")}
          </ctx.ui.Button>
        </>
      }
    >
      <div class="oem-form">
        <div class="oem-form-row">
          <div class="oem-field oem-grow">
            <span class="oem-field-label">{ctx.t("mcp.name")}</span>
            <ctx.ui.TextInput
              value={name()}
              onInput={setName}
              label={ctx.t("mcp.name")}
              placeholder="my-server"
              autofocus={!props.entry}
            />
            <span class="oem-hint">{ctx.t("mcp.nameHint")}</span>
          </div>
          <div class="oem-field">
            <span class="oem-field-label">{ctx.t("mcp.type")}</span>
            <ctx.ui.Select
              label={ctx.t("mcp.type")}
              value={type()}
              options={[
                { value: "local", label: ctx.t("mcp.type.local") },
                { value: "remote", label: ctx.t("mcp.type.remote") },
              ]}
              onChange={(value) => setType(value as "local" | "remote")}
            />
          </div>
        </div>

        <Show when={type() === "local"}>
          <div class="oem-field">
            <span class="oem-field-label">{ctx.t("mcp.command")}</span>
            <ctx.ui.TextInput
              value={command()}
              onInput={setCommand}
              label={ctx.t("mcp.command")}
              placeholder="npx -y @modelcontextprotocol/server-filesystem C:\work"
            />
            <span class="oem-hint">{ctx.t("mcp.commandHint")}</span>
          </div>
          <div class="oem-field">
            <span class="oem-field-label">
              {ctx.t("mcp.cwd")} <span class="oem-hint">({ctx.t("common.optional")})</span>
            </span>
            <ctx.ui.TextInput value={cwd()} onInput={setCwd} label={ctx.t("mcp.cwd")} />
          </div>
          <div class="oem-field">
            <span class="oem-field-label">
              {ctx.t("mcp.env")} <span class="oem-hint">({ctx.t("common.optional")})</span>
            </span>
            <textarea
              class="oem-textarea oem-textarea-small"
              value={environment()}
              onInput={(event) => setEnvironment(event.currentTarget.value)}
              placeholder="API_KEY=…"
            />
            <span class="oem-hint">{ctx.t("mcp.envHint")}</span>
          </div>
        </Show>

        <Show when={type() === "remote"}>
          <div class="oem-field">
            <span class="oem-field-label">{ctx.t("mcp.url")}</span>
            <ctx.ui.TextInput
              value={url()}
              onInput={setUrl}
              label={ctx.t("mcp.url")}
              type="url"
              placeholder="https://example.com/mcp"
            />
            <span class="oem-hint">{ctx.t("mcp.urlHint")}</span>
          </div>
          <div class="oem-field">
            <span class="oem-field-label">
              {ctx.t("mcp.headers")} <span class="oem-hint">({ctx.t("common.optional")})</span>
            </span>
            <textarea
              class="oem-textarea oem-textarea-small"
              value={headers()}
              onInput={(event) => setHeaders(event.currentTarget.value)}
              placeholder="Authorization=Bearer …"
            />
            <span class="oem-hint">{ctx.t("mcp.headersHint")}</span>
          </div>
          <div class="oem-field">
            <span class="oem-field-label">{ctx.t("mcp.oauthMode")}</span>
            <ctx.ui.Select
              label={ctx.t("mcp.oauthMode")}
              value={oauthMode()}
              options={[
                { value: "auto", label: ctx.t("mcp.oauth.auto") },
                { value: "enabled", label: ctx.t("mcp.oauth.enabled") },
                { value: "disabled", label: ctx.t("mcp.oauth.disabled") },
              ]}
              onChange={(value) => setOauthMode(value as "auto" | "enabled" | "disabled")}
            />
            <span class="oem-hint">{ctx.t("mcp.oauthModeHint")}</span>
          </div>

          <Show when={oauthMode() === "enabled"}>
            <div class="oem-form-row">
              <div class="oem-field oem-grow">
                <span class="oem-field-label">
                  {ctx.t("mcp.oauthClientId")} <span class="oem-hint">({ctx.t("common.optional")})</span>
                </span>
                <ctx.ui.TextInput
                  value={oauthClientId()}
                  onInput={setOauthClientId}
                  label={ctx.t("mcp.oauthClientId")}
                />
              </div>
              <div class="oem-field oem-grow">
                <span class="oem-field-label">
                  {ctx.t("mcp.oauthClientSecret")} <span class="oem-hint">({ctx.t("common.optional")})</span>
                </span>
                <ctx.ui.TextInput
                  value={oauthClientSecret()}
                  onInput={setOauthClientSecret}
                  label={ctx.t("mcp.oauthClientSecret")}
                  type="password"
                />
              </div>
            </div>
            <div class="oem-form-row">
              <div class="oem-field oem-grow">
                <span class="oem-field-label">
                  {ctx.t("mcp.oauthScope")} <span class="oem-hint">({ctx.t("common.optional")})</span>
                </span>
                <ctx.ui.TextInput value={oauthScope()} onInput={setOauthScope} label={ctx.t("mcp.oauthScope")} />
              </div>
              <div class="oem-field">
                <span class="oem-field-label">
                  {ctx.t("mcp.oauthCallbackPort")} <span class="oem-hint">({ctx.t("common.optional")})</span>
                </span>
                <ctx.ui.TextInput
                  value={oauthCallbackPort()}
                  onInput={setOauthCallbackPort}
                  label={ctx.t("mcp.oauthCallbackPort")}
                  placeholder="1455"
                />
              </div>
            </div>
            <div class="oem-form-row">
              <div class="oem-field oem-grow">
                <span class="oem-field-label">
                  {ctx.t("mcp.oauthRedirectUri")} <span class="oem-hint">({ctx.t("common.optional")})</span>
                </span>
                <ctx.ui.TextInput
                  value={oauthRedirectUri()}
                  onInput={setOauthRedirectUri}
                  label={ctx.t("mcp.oauthRedirectUri")}
                  placeholder="http://127.0.0.1:1455/callback"
                />
              </div>
              <div class="oem-field oem-grow">
                <span class="oem-field-label">
                  {ctx.t("mcp.oauthMetadataUrl")} <span class="oem-hint">({ctx.t("common.optional")})</span>
                </span>
                <ctx.ui.TextInput
                  value={oauthMetadataUrl()}
                  onInput={setOauthMetadataUrl}
                  label={ctx.t("mcp.oauthMetadataUrl")}
                  type="url"
                />
              </div>
            </div>
            <span class="oem-hint">{ctx.t("mcp.oauthClientHint")}</span>
          </Show>

          <div class="oem-actions">
            <ctx.ui.Button icon="lock" size="small" onClick={() => void copyLogin()}>
              {ctx.t("mcp.copyLogin")}
            </ctx.ui.Button>
            <span class="oem-hint">{ctx.t("mcp.authHint")}</span>
          </div>
        </Show>

        <ctx.ui.Switch
          checked={!disabled()}
          onChange={(enabled) => setDisabled(!enabled)}
          label={ctx.t("mcp.disabled")}
          description={ctx.t("mcp.disabledHint")}
        />

        <Show when={preview()}>
          {(data) => (
            <div class="oem-preview">
              <div class="oem-preview-head">
                <span class="oem-field-label">{ctx.t("mcp.previewTitle")}</span>
                <span class="oem-hint">{ctx.t("mcp.previewHint")}</span>
              </div>
              <span class="oem-path">{data().path}</span>
              <DiffView ctx={ctx} before={data().before} after={data().after} />
            </div>
          )}
        </Show>

        <Show when={error()}>
          <div class="oem-error">{error()}</div>
        </Show>
      </div>
    </ctx.ui.Dialog>
  )
}

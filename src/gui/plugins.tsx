import { createSignal, For, Show } from "solid-js"
import { ManagerRpc, type ManagerState, type PluginEntry, type Scope } from "../rpc"
import { errorText, formatJson, isRecord, type GuiContext } from "./helpers"

function isLocalTarget(target: string) {
  return (
    target.startsWith("/") ||
    target.startsWith("./") ||
    target.startsWith("../") ||
    /^[A-Za-z]:[\\/]/.test(target) ||
    target.startsWith("file://")
  )
}

export function PluginsSection(props: {
  ctx: GuiContext
  scope: Scope
  project: string | undefined
  state: ManagerState
  busy: string | undefined
  setBusy: (key: string | undefined) => void
  saved: (next: ManagerState, message: string) => void
  failed: (error: unknown) => void
}) {
  const ctx = props.ctx
  const entries = () => props.state.plugins.filter((entry) => entry.scope === props.scope)
  const target = () => (props.project?.trim() ? { project: props.project.trim() } : {})
  const scopeLabel = () => (props.scope === "global" ? ctx.t("scope.global") : ctx.t("scope.project"))

  const edit = (entry?: PluginEntry) => {
    ctx.dialogs.open((dialog) => (
      <PluginDialog
        ctx={ctx}
        scope={props.scope}
        project={props.project}
        {...(entry ? { entry } : {})}
        onClose={dialog.close}
        onSaved={(next, name) => {
          props.saved(next, ctx.t("plugins.saved", { name }))
          dialog.close()
        }}
      />
    ))
  }

  const remove = async (entry: PluginEntry) => {
    const confirmed = await ctx.dialogs.confirm({
      title: ctx.t("plugins.deleteTitle"),
      description: ctx.t("plugins.deleteDescription", { name: entry.package || "—", scope: scopeLabel() }),
      confirm: ctx.t("common.delete"),
      danger: true,
    })
    if (!confirmed) return
    const key = `plugin:${entry.scope}:${entry.index}`
    props.setBusy(key)
    try {
      const next = await ctx.client.rpc(ManagerRpc).removePlugin({
        scope: entry.scope,
        ...target(),
        index: entry.index,
      })
      props.saved(next, ctx.t("plugins.deleted"))
    } catch (error) {
      props.failed(error)
    } finally {
      props.setBusy(undefined)
    }
  }

  return (
    <ctx.ui.SettingsSection
      title={ctx.t("plugins.title")}
      footer={
        <div class="oem-footer">
          <ctx.ui.Button icon="plus" size="small" onClick={() => edit()}>
            {ctx.t("plugins.add")}
          </ctx.ui.Button>
        </div>
      }
    >
      <Show
        when={entries().length > 0}
        fallback={
          <ctx.ui.SettingsRow
            id="oem-plugins-empty"
            title={<span class="oem-muted">{ctx.t("plugins.empty")}</span>}
          />
        }
      >
        <For each={entries()}>
          {(entry) => {
            const key = () => `plugin:${entry.scope}:${entry.index}`
            return (
              <ctx.ui.SettingsRow
                id={`oem-plugin-${entry.scope}-${entry.index}`}
                title={
                  <span class="oem-title">
                    <code>{entry.removal ? `-${entry.package}` : entry.package || ctx.t("common.unknown")}</code>
                    <Show when={entry.removal}>
                      <span class="oem-badge">{ctx.t("plugins.removal")}</span>
                    </Show>
                    <Show when={!entry.removal}>
                      <span class="oem-badge">
                        {isLocalTarget(entry.package) ? ctx.t("plugins.localBadge") : ctx.t("plugins.npmBadge")}
                      </span>
                    </Show>
                  </span>
                }
                description={
                  <span class="oem-description">
                    <Show when={entry.removal}>
                      <span class="oem-hint">{ctx.t("plugins.removalHint")}</span>
                    </Show>
                    <Show when={!entry.removal && entry.options !== undefined}>
                      <code class="oem-command">{formatJson(entry.options)}</code>
                    </Show>
                  </span>
                }
              >
                <div class="oem-actions">
                  <Show when={!entry.removal}>
                    <ctx.ui.IconButton
                      icon="edit"
                      size="small"
                      label={ctx.t("common.edit")}
                      disabled={props.busy === key()}
                      onClick={() => edit(entry)}
                    />
                  </Show>
                  <ctx.ui.IconButton
                    icon="trash"
                    size="small"
                    label={ctx.t("common.delete")}
                    disabled={props.busy === key()}
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

function PluginDialog(props: {
  ctx: GuiContext
  scope: Scope
  project: string | undefined
  entry?: PluginEntry
  onClose: () => void
  onSaved: (next: ManagerState, name: string) => void
}) {
  const ctx = props.ctx
  const [name, setName] = createSignal(props.entry?.package ?? "")
  const [options, setOptions] = createSignal(
    props.entry?.options === undefined ? "" : formatJson(props.entry.options),
  )
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string>()

  const target = () => (props.project?.trim() ? { project: props.project.trim() } : {})

  const save = async () => {
    setError(undefined)
    try {
      const packageName = name().trim()
      if (!packageName) throw new Error(ctx.t("plugins.packageHint"))
      let parsed: unknown
      if (options().trim()) {
        try {
          parsed = JSON.parse(options())
        } catch {
          throw new Error(ctx.t("plugins.optionsInvalid"))
        }
        if (!isRecord(parsed)) throw new Error(ctx.t("plugins.optionsInvalid"))
      }

      setSaving(true)
      const state = await ctx.client.rpc(ManagerRpc).savePlugin({
        scope: props.scope,
        ...target(),
        ...(props.entry ? { index: props.entry.index } : {}),
        package: packageName,
        ...(parsed === undefined ? {} : { options: parsed }),
      })
      props.onSaved(state, packageName)
    } catch (saveError) {
      setError(errorText(saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ctx.ui.Dialog
      title={props.entry ? ctx.t("plugins.dialog.edit") : ctx.t("plugins.dialog.new")}
      size="large"
      footer={
        <>
          <ctx.ui.Button onClick={props.onClose} disabled={saving()}>
            {ctx.t("common.cancel")}
          </ctx.ui.Button>
          <ctx.ui.Button variant="contrast" busy={saving()} onClick={() => void save()}>
            {ctx.t("common.save")}
          </ctx.ui.Button>
        </>
      }
    >
      <div class="oem-form">
        <div class="oem-field">
          <span class="oem-field-label">{ctx.t("plugins.package")}</span>
          <ctx.ui.TextInput
            value={name()}
            onInput={setName}
            label={ctx.t("plugins.package")}
            placeholder="opencode-foo или C:\path\to\plugin"
            autofocus={!props.entry}
          />
          <span class="oem-hint">{ctx.t("plugins.packageHint")}</span>
        </div>
        <div class="oem-field">
          <span class="oem-field-label">
            {ctx.t("plugins.options")} <span class="oem-hint">({ctx.t("common.optional")})</span>
          </span>
          <textarea
            class="oem-textarea oem-textarea-small"
            value={options()}
            onInput={(event) => setOptions(event.currentTarget.value)}
            placeholder={'{\n  "key": "value"\n}'}
          />
          <span class="oem-hint">{ctx.t("plugins.optionsHint")}</span>
        </div>
        <Show when={error()}>
          <div class="oem-error">{error()}</div>
        </Show>
      </div>
    </ctx.ui.Dialog>
  )
}

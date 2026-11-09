import { createSignal, For, Show } from "solid-js"
import { ManagerRpc, type ManagerState, type Scope, type SkillEntry } from "../rpc"
import { errorText, type GuiContext } from "./helpers"

function hasFrontmatter(content: string) {
  const lines = content.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n").split("\n")
  let index = 0
  while (index < lines.length && lines[index].trim() === "") index++
  if (lines[index]?.trim() !== "---") return false
  for (index++; index < lines.length; index++) {
    const line = lines[index].trim()
    if (line === "---" || line === "...") return true
  }
  return false
}

function template(ctx: GuiContext, id: string) {
  return [
    "---",
    `name: ${id || "my-skill"}`,
    `description: ${ctx.t("skills.templateDescription")}`,
    "---",
    "",
    ctx.t("skills.templateBody"),
    "",
  ].join("\n")
}

export function SkillsSection(props: {
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
  const entries = () => props.state.skills.filter((entry) => entry.scope === props.scope)
  const target = () => (props.project?.trim() ? { project: props.project.trim() } : {})

  const edit = (entry?: SkillEntry) => {
    ctx.dialogs.open((dialog) => (
      <SkillDialog
        ctx={ctx}
        scope={props.scope}
        project={props.project}
        {...(entry ? { entry } : {})}
        onClose={dialog.close}
        onSaved={(next, name) => {
          props.saved(next, ctx.t("skills.saved", { name }))
          dialog.close()
        }}
      />
    ))
  }

  const toggle = async (entry: SkillEntry, enabled: boolean) => {
    const key = `skill:${entry.scope}:${entry.id}`
    props.setBusy(key)
    try {
      const next = await ctx.client.rpc(ManagerRpc).setSkillEnabled({
        scope: entry.scope,
        ...target(),
        id: entry.id,
        enabled,
      })
      props.saved(next, ctx.t("skills.saved", { name: entry.name }))
    } catch (error) {
      props.failed(error)
    } finally {
      props.setBusy(undefined)
    }
  }

  const remove = async (entry: SkillEntry) => {
    const confirmed = await ctx.dialogs.confirm({
      title: ctx.t("skills.deleteTitle"),
      description: ctx.t("skills.deleteDescription", { name: entry.name }),
      confirm: ctx.t("common.delete"),
      danger: true,
    })
    if (!confirmed) return
    const key = `skill:${entry.scope}:${entry.id}`
    props.setBusy(key)
    try {
      const next = await ctx.client.rpc(ManagerRpc).removeSkill({
        scope: entry.scope,
        ...target(),
        id: entry.id,
      })
      props.saved(next, ctx.t("skills.deleted", { name: entry.name }))
    } catch (error) {
      props.failed(error)
    } finally {
      props.setBusy(undefined)
    }
  }

  return (
    <ctx.ui.SettingsSection
      title={ctx.t("skills.title")}
      footer={
        <div class="oem-footer">
          <ctx.ui.Button icon="plus" size="small" onClick={() => edit()}>
            {ctx.t("skills.add")}
          </ctx.ui.Button>
        </div>
      }
    >
      <Show
        when={entries().length > 0}
        fallback={
          <ctx.ui.SettingsRow
            id="oem-skills-empty"
            title={<span class="oem-muted">{ctx.t("skills.empty")}</span>}
          />
        }
      >
        <For each={entries()}>
          {(entry) => {
            const key = () => `skill:${entry.scope}:${entry.id}`
            return (
              <ctx.ui.SettingsRow
                id={`oem-skill-${entry.scope}-${entry.id}`}
                title={
                  <span class="oem-title">
                    <span>{entry.name || entry.id}</span>
                    <code class="oem-id">{entry.id}</code>
                    <Show when={entry.disabled}>
                      <span class="oem-badge">{ctx.t("skills.disabledBadge")}</span>
                    </Show>
                  </span>
                }
                description={
                  <span class="oem-description">
                    <Show when={entry.description}>
                      <span>{entry.description}</span>
                    </Show>
                    <span class="oem-path">{entry.path}</span>
                  </span>
                }
              >
                <div class="oem-actions">
                  <ctx.ui.Switch
                    checked={!entry.disabled}
                    disabled={props.busy === key()}
                    label={ctx.t("common.enabled")}
                    hideLabel
                    onChange={(enabled) => void toggle(entry, enabled)}
                  />
                  <ctx.ui.IconButton
                    icon="edit"
                    size="small"
                    label={ctx.t("common.edit")}
                    disabled={props.busy === key()}
                    onClick={() => edit(entry)}
                  />
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

function SkillDialog(props: {
  ctx: GuiContext
  scope: Scope
  project: string | undefined
  entry?: SkillEntry
  onClose: () => void
  onSaved: (next: ManagerState, name: string) => void
}) {
  const ctx = props.ctx
  const [id, setId] = createSignal(props.entry?.id ?? "")
  const [content, setContent] = createSignal(props.entry?.content ?? template(ctx, ""))
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string>()

  const target = () => (props.project?.trim() ? { project: props.project.trim() } : {})

  const save = async () => {
    setError(undefined)
    try {
      if (!hasFrontmatter(content())) throw new Error(ctx.t("skills.frontmatter"))
      setSaving(true)
      const state = await ctx.client.rpc(ManagerRpc).saveSkill({
        scope: props.scope,
        ...target(),
        id: id().trim(),
        ...(props.entry ? { originalId: props.entry.id } : {}),
        content: content(),
      })
      props.onSaved(state, id().trim())
    } catch (saveError) {
      setError(errorText(saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ctx.ui.Dialog
      title={props.entry ? ctx.t("skills.dialog.edit") : ctx.t("skills.dialog.new")}
      size="x-large"
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
          <span class="oem-field-label">{ctx.t("skills.id")}</span>
          <ctx.ui.TextInput
            value={id()}
            onInput={setId}
            label={ctx.t("skills.id")}
            placeholder="my-skill"
            autofocus={!props.entry}
          />
          <span class="oem-hint">{ctx.t("skills.idHint")}</span>
        </div>
        <div class="oem-field">
          <span class="oem-field-label">{ctx.t("skills.content")}</span>
          <textarea
            class="oem-textarea oem-textarea-tall"
            value={content()}
            onInput={(event) => setContent(event.currentTarget.value)}
            spellcheck={false}
          />
          <span class="oem-hint">{ctx.t("skills.contentHint")}</span>
        </div>
        <Show when={error()}>
          <div class="oem-error">{error()}</div>
        </Show>
      </div>
    </ctx.ui.Dialog>
  )
}

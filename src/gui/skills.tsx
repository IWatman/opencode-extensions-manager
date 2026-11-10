import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { ManagerRpc, type ManagerState, type Scope, type SkillEntry } from "../rpc"
import { errorText, type GuiContext } from "./helpers"
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

function skillKey(entry: SkillEntry) {
  return `${entry.scope}:${entry.id}`
}

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
  const scopeLabel = () => (props.scope === "global" ? ctx.t("scope.global") : ctx.t("scope.project"))
  const storage = (() => {
    try {
      return window.localStorage
    } catch {
      return undefined
    }
  })()
  const [sort, setSort] = createSignal<SortKey>(
    readSortPreference(storage, "oem.sort.skills", ["name", "status"], "name"),
  )
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set())
  const [bulkBusy, setBulkBusy] = createSignal(false)
  const [bulkProgress, setBulkProgress] = createSignal<BulkProgress>()
  const [bulkResult, setBulkResult] = createSignal<BulkResult>()
  const sortedEntries = createMemo(() =>
    sortItems(entries(), sort(), {
      name: (entry) => entry.name || entry.id,
      status: (entry) => (entry.disabled ? 1 : 0),
    }),
  )
  const selectionKeys = () => sortedEntries().map(skillKey)

  const changeSort = (value: SortKey) => {
    setSort(value)
    writeSortPreference(storage, "oem.sort.skills", value)
  }

  createEffect(() => {
    const available = new Set(entries().map(skillKey))
    setSelected((current) => pruneSelected(current, available))
  })

  const edit = (entry?: SkillEntry) => {
    ctx.dialogs.open((dialog) => (
      <SkillDialog
        ctx={ctx}
        scope={props.scope}
        project={props.project}
        {...(entry ? { entry } : {})}
        ids={entries().map((item) => item.id)}
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

  const bulk = async (mode: "enable" | "disable" | "delete") => {
    const targets = sortedEntries().filter((entry) => selected().has(skillKey(entry)))
    if (targets.length === 0) return
    if (mode === "delete") {
      const confirmed = await ctx.dialogs.confirm({
        title: ctx.t("bulk.deleteTitle"),
        description: ctx.t("bulk.deleteDescription", { count: targets.length, scope: scopeLabel() }),
        confirm: ctx.t("common.delete"),
        danger: true,
      })
      if (!confirmed) return
    }

    setBulkBusy(true)
    setBulkResult(undefined)
    props.setBusy("skill:bulk")
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
          name: entry.name || entry.id,
          mode: mode === "delete" ? "delete" : "toggle",
        })
        try {
          const next =
            mode === "delete"
              ? await ctx.client.rpc(ManagerRpc).removeSkill({
                  scope: entry.scope,
                  ...target(),
                  id: entry.id,
                })
              : await ctx.client.rpc(ManagerRpc).setSkillEnabled({
                  scope: entry.scope,
                  ...target(),
                  id: entry.id,
                  enabled: mode === "enable",
                })
          lastState = next
          ok++
          succeeded.push(skillKey(entry))
        } catch (error) {
          failures.push(`${entry.name || entry.id}: ${errorText(error)}`)
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
      title={ctx.t("skills.title")}
      footer={
        <div class="oem-footer">
          <ctx.ui.Button icon="plus" size="small" onClick={() => edit()}>
            {ctx.t("skills.add")}
          </ctx.ui.Button>
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
            <ctx.ui.Button size="small" disabled={bulkBusy()} onClick={() => void bulk("enable")}>
              {ctx.t("bulk.enable")}
            </ctx.ui.Button>
            <ctx.ui.Button size="small" disabled={bulkBusy()} onClick={() => void bulk("disable")}>
              {ctx.t("bulk.disable")}
            </ctx.ui.Button>
            <ctx.ui.Button
              variant="danger"
              icon="trash"
              size="small"
              disabled={bulkBusy()}
              onClick={() => void bulk("delete")}
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
            id="oem-skills-empty"
            title={<span class="oem-muted">{ctx.t("skills.empty")}</span>}
          />
        }
      >
        <For each={sortedEntries()}>
          {(entry) => {
            const key = () => `skill:${entry.scope}:${entry.id}`
            return (
              <ctx.ui.SettingsRow
                id={`oem-skill-${entry.scope}-${entry.id}`}
                title={
                  <span class="oem-title">
                    <SelectionBox
                      checked={selected().has(skillKey(entry))}
                      label={entry.name || entry.id}
                      disabled={bulkBusy()}
                      onChange={(checked) =>
                        setSelected((current) => toggleSelected(current, skillKey(entry), checked))
                      }
                    />
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
                    disabled={props.busy === key() || bulkBusy()}
                    label={ctx.t("common.enabled")}
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

function SkillDialog(props: {
  ctx: GuiContext
  scope: Scope
  project: string | undefined
  entry?: SkillEntry
  ids: readonly string[]
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
      const nextId = id().trim()
      if (nextId && props.ids.some((existing) => existing !== props.entry?.id && existing === nextId)) {
        setError(ctx.t("common.alreadyExists", { name: nextId }))
        return
      }
      setSaving(true)
      const state = await ctx.client.rpc(ManagerRpc).saveSkill({
        scope: props.scope,
        ...target(),
        id: nextId,
        ...(props.entry ? { originalId: props.entry.id } : {}),
        content: content(),
      })
      props.onSaved(state, nextId)
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

import { createEffect, createMemo, createSignal, For, on, onMount, Show } from "solid-js"
import { ManagerRpc, type ClaudePluginCandidate, type ClaudePreview, type ManagerState, type Scope } from "../rpc"
import { errorText, revealPath, type GuiContext } from "./helpers"

export function ClaudeImportSection(props: {
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
  const [preview, setPreview] = createSignal<ClaudePreview>()
  const [loading, setLoading] = createSignal(false)
  const [scanError, setScanError] = createSignal<string>()
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set())
  const [adapt, setAdapt] = createSignal(false)
  const [installing, setInstalling] = createSignal(false)
  const [results, setResults] = createSignal<readonly { id: string; name: string; ok: boolean; skipped?: readonly string[]; error?: string }[]>([])
  let generation = 0

  const target = () => (props.project?.trim() ? { project: props.project.trim() } : {})

  const scan = async () => {
    const current = ++generation
    setLoading(true)
    setScanError(undefined)
    try {
      const output = await ctx.client.rpc(ManagerRpc).previewClaudePlugins({
        scope: props.scope,
        ...target(),
      })
      if (current !== generation) return
      setPreview(output)
      // Keep only ids that still exist in the refreshed preview.
      const available = new Set(output.candidates.map((candidate) => candidate.id))
      setSelected(new Set([...selected()].filter((id) => available.has(id))))
    } catch (error) {
      if (current === generation) setScanError(errorText(error))
    } finally {
      if (current === generation) setLoading(false)
    }
  }

  const canInstall = (candidate: ClaudePluginCandidate) =>
    !candidate.error &&
    (candidate.mcp.length > 0 ||
      candidate.skills.length > 0 ||
      candidate.plugins.length > 0 ||
      (adapt() && candidate.adaptable.length > 0))

  const installableSelected = createMemo(
    () => (preview()?.candidates ?? []).filter((candidate) => selected().has(candidate.id) && canInstall(candidate)).length,
  )

  const toggle = (candidate: ClaudePluginCandidate, value: boolean) => {
    const next = new Set(selected())
    if (value) next.add(candidate.id)
    else next.delete(candidate.id)
    setSelected(next)
  }

  const install = async () => {
    const candidates = (preview()?.candidates ?? []).filter(
      (candidate) => selected().has(candidate.id) && canInstall(candidate),
    )
    if (candidates.length === 0) return
    const scopeLabel = ctx.t(props.scope === "global" ? "scope.global" : "scope.project")
    const confirmed = await ctx.dialogs.confirm({
      title: ctx.t("claude.installTitle"),
      description: ctx.t("claude.installDescription", {
        count: candidates.length,
        scope: scopeLabel,
      }),
      confirm: ctx.t("claude.confirm"),
    })
    if (!confirmed) return

    setInstalling(true)
    setResults([])
    props.setBusy("claude:install")
    try {
      const output = await ctx.client.rpc(ManagerRpc).installClaudePlugins({
        scope: props.scope,
        ...target(),
        plugins: candidates.map((candidate) => ({
          id: candidate.id,
          adapt: adapt(),
        })),
      })
      setResults(output.results)
      const installed = output.results.filter((result) => result.ok).length
      if (installed > 0) {
        props.saved(output.state, ctx.t("claude.imported", { count: installed }))
        setSelected(new Set<string>())
        await scan()
      } else {
        const failure = output.results.find((result) => !result.ok)
        if (failure?.error) props.failed(new Error(failure.error))
      }
    } catch (error) {
      props.failed(error)
    } finally {
      setInstalling(false)
      props.setBusy(undefined)
    }
  }

  const reveal = (path: string | undefined) => {
    if (!path) return
    revealPath(ctx, path)
  }

  const partCount = (candidate: ClaudePluginCandidate) =>
    ctx.t("claude.parts", {
      mcp: candidate.mcp.length,
      skills: candidate.skills.length,
      plugins: candidate.plugins.length,
    })

  createEffect(
    on(
      () => [props.scope, props.project],
      () => void scan(),
      { defer: true },
    ),
  )
  onMount(() => {
    void scan()
  })

  return (
    <ctx.ui.SettingsSection
      title={ctx.t("claude.title")}
      footer={
        <div class="oem-footer">
          <span class="oem-hint">{ctx.t("claude.description")}</span>
        </div>
      }
    >
      <ctx.ui.SettingsRow
        title={ctx.t("claude.cacheDir")}
        description={
          <span class="oem-description">
            <span class="oem-path">{preview()?.cacheDir ?? "~/.claude/plugins/cache"}</span>
            <Show when={preview()?.error}>
              <span class="oem-error">{preview()!.error}</span>
            </Show>
            <Show when={scanError()}>
              <span class="oem-error">{scanError()}</span>
            </Show>
          </span>
        }
        id="oem-claude-cache"
      >
        <div class="oem-actions">
          <ctx.ui.Button icon="refresh" size="small" busy={loading()} onClick={() => void scan()}>
            {preview() ? ctx.t("claude.rescan") : ctx.t("claude.scan")}
          </ctx.ui.Button>
          <ctx.ui.IconButton
            icon="folder"
            size="small"
            label={ctx.t("claude.showCache")}
            disabled={!preview()?.exists}
            onClick={() => reveal(preview()?.cacheDir)}
          />
        </div>
      </ctx.ui.SettingsRow>

      <Show when={preview()?.exists && preview()!.warnings.length > 0}>
        <ctx.ui.SettingsRow
          title={ctx.t("claude.warnings")}
          description={
            <span class="oem-description">
              <For each={preview()!.warnings}>{(warning) => <span class="oem-hint">{warning}</span>}</For>
            </span>
          }
        />
      </Show>

      <Show when={preview()?.exists && preview()!.candidates.length > 0}>
        <ctx.ui.SettingsRow
          title={ctx.t("claude.count", { count: preview()!.candidates.length })}
          description={ctx.t("claude.selected", { count: selected().size })}
        >
          <div class="oem-actions">
            <ctx.ui.Switch
              checked={adapt()}
              onChange={setAdapt}
              label={ctx.t("claude.adapt")}
              description={ctx.t("claude.adaptHint")}
            />
            <ctx.ui.Button
              variant="contrast"
              icon="download"
              size="small"
              busy={installing()}
              disabled={installableSelected() === 0}
              onClick={() => void install()}
            >
              {ctx.t("claude.installSelected")}
            </ctx.ui.Button>
          </div>
        </ctx.ui.SettingsRow>
      </Show>

      <Show when={preview()?.exists && preview()!.candidates.length === 0 && !loading()}>
        <ctx.ui.SettingsRow title={<span class="oem-muted">{ctx.t("claude.empty")}</span>} />
      </Show>

      <Show when={preview() && !preview()!.exists && preview()!.error}>
        <ctx.ui.SettingsRow
          title={<span class="oem-muted">{ctx.t("claude.notFound", { path: preview()!.cacheDir })}</span>}
        />
      </Show>

      <For each={preview()?.candidates ?? []}>
        {(candidate) => {
          const installable = () => canInstall(candidate)
          const checked = () => selected().has(candidate.id)
          return (
            <ctx.ui.SettingsRow
              id={`oem-claude-${candidate.id}`}
              title={
                <span class="oem-title">
                  <span>{candidate.displayName ?? candidate.name}</span>
                  <Show when={candidate.version}>
                    <span class="oem-badge">{candidate.version}</span>
                  </Show>
                  <Show when={candidate.marketplace}>
                    <span class="oem-badge">{candidate.marketplace}</span>
                  </Show>
                  <Show when={candidate.installedKey}>
                    <span class="oem-badge">{ctx.t("claude.importedBadge")}</span>
                  </Show>
                </span>
              }
              description={
                <span class="oem-description">
                  <Show when={candidate.description}>
                    <span class="oem-hint">{candidate.description}</span>
                  </Show>
                  <span class="oem-hint">{partCount(candidate)}</span>
                  <span class="oem-path">{candidate.source}</span>
                  <Show when={candidate.unsupported.length > 0}>
                    <span class="oem-hint">
                      {ctx.t("claude.unsupported", { parts: candidate.unsupported.join(", ") })}
                    </span>
                  </Show>
                  <Show when={candidate.error}>
                    <span class="oem-error">{candidate.error}</span>
                  </Show>
                  <Show when={candidate.warnings.length > 0}>
                    <For each={candidate.warnings}>{(warning) => <span class="oem-hint">{warning}</span>}</For>
                  </Show>
                  <Show when={!installable()}>
                    <span class="oem-hint">{ctx.t("claude.installNone")}</span>
                  </Show>
                </span>
              }
            >
              <div class="oem-actions">
                <ctx.ui.IconButton
                  icon="folder"
                  size="small"
                  label={ctx.t("claude.revealSource")}
                  onClick={() => reveal(candidate.source)}
                />
                <ctx.ui.Switch
                  checked={checked()}
                  disabled={!installable() || installing()}
                  label={`${ctx.t("claude.select")}: ${candidate.displayName ?? candidate.name}`}
                  hideLabel
                  onChange={(value) => toggle(candidate, value)}
                />
              </div>
            </ctx.ui.SettingsRow>
          )
        }}
      </For>

      <Show when={results().length > 0}>
        <ctx.ui.SettingsRow
          title={ctx.t("claude.results")}
          description={
            <span class="oem-description">
              <For each={results()}>
                {(result) => (
                  <>
                    <span class={result.ok ? "oem-hint" : "oem-error"}>
                      {result.ok
                        ? ctx.t("claude.resultOk", { name: result.name })
                        : ctx.t("claude.resultFailed", { name: result.name })}
                    </span>
                    <Show when={result.error}>
                      <span class="oem-error">{result.error}</span>
                    </Show>
                    <Show when={result.skipped && result.skipped.length > 0}>
                      <span class="oem-hint">{result.skipped!.join("; ")}</span>
                    </Show>
                  </>
                )}
              </For>
            </span>
          }
        />
      </Show>
    </ctx.ui.SettingsSection>
  )
}

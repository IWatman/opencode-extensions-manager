import { createSignal, For, onMount, Show } from "solid-js"
import { ManagerRpc, type ManagerState, type Scope } from "../rpc"
import { errorText, revealPath, runtimeStatus, type GuiContext } from "./helpers"
import { McpSection, type McpStatusMap } from "./mcp"
import { MarketplacesSection } from "./marketplaces"
import { PluginsSection } from "./plugins"
import { SkillsSection } from "./skills"

export function ExtensionsPage(props: { ctx: GuiContext }) {
  const ctx = props.ctx
  const [state, setState] = createSignal<ManagerState>()
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [scope, setScope] = createSignal<Scope>("global")
  const [project, setProject] = createSignal<string | undefined>(ctx.sessions.current()?.location?.directory)
  const [busy, setBusy] = createSignal<string>()
  const [statuses, setStatuses] = createSignal<McpStatusMap>({})

  let generation = 0

  const loadStatuses = async () => {
    try {
      const path = project()?.trim()
      const output = await ctx.client.mcp.list(path ? { location: { directory: path } } : {})
      const next: Record<string, { status: ReturnType<typeof runtimeStatus>["status"]; error?: string }> = {}
      for (const server of output.data ?? []) {
        next[server.name] = runtimeStatus(server.status)
      }
      setStatuses(next)
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

  const diagnostics = () => {
    const current = state()
    if (!current) return []
    const list = [...current.diagnostics]
    if (current.projectError) list.unshift({ scope: "project" as const, message: current.projectError })
    return list
  }

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

  onMount(() => {
    void refresh()
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
            <ctx.ui.SettingsRow title={ctx.t("common.loading")}>
              <ctx.ui.Loader size="small" />
            </ctx.ui.SettingsRow>
          </ctx.ui.SettingsSection>
        }
      >
        {(current) => (
          <>
            <ctx.ui.SettingsSection title={ctx.t("scope.title")}>
              <ctx.ui.SettingsRow
                title={ctx.t("scope.mode")}
                description={ctx.t("scope.modeHint")}
                id="oem-scope-mode"
              >
                <ctx.ui.Select
                  label={ctx.t("scope.mode")}
                  value={scope()}
                  options={[
                    { value: "global", label: ctx.t("scope.global") },
                    { value: "project", label: ctx.t("scope.project") },
                  ]}
                  onChange={(value) => setScope(value as Scope)}
                />
              </ctx.ui.SettingsRow>

              <Show when={scope() === "project"}>
                <ctx.ui.SettingsRow
                  title={ctx.t("scope.projectDir")}
                  description={ctx.t("scope.projectDirHint")}
                  id="oem-scope-project"
                >
                  <div class="oem-actions oem-actions-wide">
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
                </ctx.ui.SettingsRow>
              </Show>

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

            <McpSection
              ctx={ctx}
              scope={scope()}
              project={project()}
              state={current()}
              busy={busy()}
              statuses={statuses()}
              setBusy={setBusy}
              saved={saved}
              failed={failed}
            />

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

            <MarketplacesSection
              ctx={ctx}
              scope={scope()}
              project={project()}
              state={current()}
              busy={busy()}
              setBusy={setBusy}
              saved={saved}
              failed={failed}
            />

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

            <Show when={diagnostics().length > 0}>
              <ctx.ui.SettingsSection title={ctx.t("diagnostics.title")}>
                <For each={diagnostics()}>
                  {(diagnostic) => (
                    <ctx.ui.SettingsRow
                      title={`${diagnostic.scope === "global" ? ctx.t("scope.global") : ctx.t("scope.project")} — ${ctx.t("diagnostics.warning")}`}
                      description={<span class="oem-error">{diagnostic.message}</span>}
                    />
                  )}
                </For>
              </ctx.ui.SettingsSection>
            </Show>

            <ctx.ui.SettingsSection>
              <ctx.ui.SettingsRow title={<span class="oem-hint">{ctx.t("footer.note")}</span>} />
            </ctx.ui.SettingsSection>
          </>
        )}
      </Show>
    </ctx.ui.SettingsLayout>
  )
}

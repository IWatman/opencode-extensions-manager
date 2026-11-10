import { createSignal, For, onMount, Show } from "solid-js"
import {
  ManagerRpc,
  type SelfUpdateCommit,
  type SelfUpdateHistoryEntry,
  type SelfUpdateInfo,
  type SelfUpdateResult,
} from "../rpc"
import { errorText, revealPath, type GuiContext } from "./helpers"
import {
  autoCheckSelfUpdate,
  runSelfUpdateCheck,
  selfUpdateAvailable,
  selfUpdateChannel,
  selfUpdateCheck,
  selfUpdateCheckError,
  selfUpdateCheckedAt,
  selfUpdateChecking,
  selfUpdateFrequency,
  setSelfUpdateChannel,
  setSelfUpdateFrequency,
} from "./self-update-state"
import type { SelfUpdateChannel, SelfUpdateFrequency } from "./self-update-settings"

interface PackageUpdate {
  readonly target: string
  readonly version?: string
}

const pluginID = "opencode-extensions-manager"

function shortCommit(value: string | undefined) {
  if (!value) return undefined
  return value.length > 10 ? value.slice(0, 7) : value
}

export function AboutSection(props: { ctx: GuiContext }) {
  const ctx = props.ctx
  const [info, setInfo] = createSignal<SelfUpdateInfo>()
  const [loading, setLoading] = createSignal(true)
  const [loadError, setLoadError] = createSignal<string>()
  const [packageUpdate, setPackageUpdate] = createSignal<PackageUpdate>()
  const [pluginKind, setPluginKind] = createSignal<"package" | "local" | "other">("other")
  const [localCheckError, setLocalCheckError] = createSignal<string>()
  const [updating, setUpdating] = createSignal(false)
  const [rollingBack, setRollingBack] = createSignal<string>()
  const [result, setResult] = createSignal<SelfUpdateResult>()
  const [resultKind, setResultKind] = createSignal<"update" | "rollback">("update")
  const [appliedCommits, setAppliedCommits] = createSignal<readonly SelfUpdateCommit[]>([])
  const [suppressChangelog, setSuppressChangelog] = createSignal(false)
  const [history, setHistory] = createSignal<readonly SelfUpdateHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = createSignal(true)
  const [historyError, setHistoryError] = createSignal<string>()

  const checking = selfUpdateChecking
  const checkedAt = selfUpdateCheckedAt
  const check = selfUpdateCheck
  const checkErrorText = () => {
    const values = [selfUpdateCheckError(), localCheckError()].filter(
      (value): value is string => Boolean(value),
    )
    return values.length > 0 ? values.join("; ") : undefined
  }

  const load = async () => {
    setLoading(true)
    setLoadError(undefined)
    try {
      setInfo(await ctx.client.rpc(ManagerRpc).selfUpdateInfo({}))
    } catch (error) {
      setLoadError(errorText(error))
    } finally {
      setLoading(false)
    }
  }

  const loadHistory = async () => {
    setHistoryLoading(true)
    setHistoryError(undefined)
    try {
      const output = await ctx.client.rpc(ManagerRpc).selfUpdateHistory({})
      setHistory(output.entries)
    } catch (error) {
      setHistoryError(errorText(error))
    } finally {
      setHistoryLoading(false)
    }
  }

  const packageTarget = () => packageUpdate()?.target

  const findPackageUpdate = async (): Promise<PackageUpdate | undefined> => {
    const output = await ctx.client.plugin.check({})
    const found = output.data.find(
      (item) =>
        item.id === pluginID ||
        (item.source.type === "package" && item.source.target?.toLowerCase().includes(pluginID)),
    )
    if (found?.source.type !== "package" || !found.source.target) {
      setPluginKind(found?.source.type === "local" ? "local" : "other")
      return undefined
    }
    setPluginKind("package")
    if (found.source.outdated !== true) return undefined
    return {
      target: found.source.target,
      ...(found.source.version ? { version: found.source.version } : {}),
    }
  }

  const runCheck = async (clearChangelog = true) => {
    setLocalCheckError(undefined)
    setPackageUpdate(undefined)
    setPluginKind("other")
    if (clearChangelog) {
      setAppliedCommits([])
      setSuppressChangelog(false)
    }
    if (!info()) await load()
    const current = info()
    const errors: string[] = []
    const [, packageCheck] = await Promise.allSettled([
      runSelfUpdateCheck(ctx, { force: true }),
      current?.install.kind !== "git" ? findPackageUpdate() : Promise.resolve(undefined),
    ])
    if (packageCheck.status === "fulfilled" && packageCheck.value) {
      setPackageUpdate(packageCheck.value)
    } else if (packageCheck.status === "rejected") {
      errors.push(`${ctx.t("about.checkFailed")}: ${errorText(packageCheck.reason)}`)
    }
    setLocalCheckError(errors.length > 0 ? errors.join("; ") : undefined)
  }

  const updateState = () => {
    const current = info()
    if (!current) return "unknown" as const
    if (localCheckError()) return "blocked" as const
    if (packageUpdate()) return "available" as const
    if (pluginKind() === "package") return checkedAt() ? ("current" as const) : ("unknown" as const)
    if (current.install.kind === "directory") return "blocked" as const
    if (current.install.kind === "git" && !current.install.canUpdate) return "blocked" as const
    const server = check()
    if (server?.updateAvailable) return server.canUpdate ? ("available" as const) : ("blocked" as const)
    if (!server && selfUpdateAvailable()) return "available" as const
    if (checkedAt()) return "current" as const
    return "unknown" as const
  }

  const canUpdate = () => Boolean(packageTarget()) || Boolean(check()?.canUpdate)

  const statusDetail = () => {
    const current = info()
    if (!current) return undefined
    if (pluginKind() === "package" || current.install.kind === "package") return ctx.t("about.packageHint")
    if (current.install.kind === "directory") return ctx.t("about.directoryHint")
    if (current.install.branch && current.install.branch !== "main") {
      return ctx.t("about.branchHint", { branch: current.install.branch })
    }
    if (current.install.dirty) return ctx.t("about.localChanges")
    if (check()?.ahead && selfUpdateChannel() === "main") return ctx.t("about.aheadHint")
    const reason = check()?.reason
    if (reason && reason !== "Already up to date.") return reason
    return undefined
  }

  const versionLine = () => {
    if (!check()?.updateAvailable) return undefined
    const current = check()?.currentVersion ?? info()?.version
    const latest = check()?.latestVersion
    if (!current || !latest || latest === current) return undefined
    return ctx.t("updates.versionChange", { current, latest })
  }

  const commitLine = () => {
    if (!check()?.updateAvailable) return undefined
    const current = shortCommit(check()?.currentCommit ?? info()?.install.commit)
    const latest = shortCommit(check()?.latestCommit)
    if (!current || !latest || current === latest) return undefined
    return ctx.t("updates.commitChange", { current, latest })
  }

  const whatsNew = () => {
    if (suppressChangelog()) return []
    if (appliedCommits().length > 0) return appliedCommits()
    return check()?.updateAvailable ? (check()?.commits ?? []) : []
  }

  const formatDate = (value: string | undefined, mode: "date" | "dateTime" = "dateTime") => {
    if (!value) return undefined
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return mode === "date" ? date.toLocaleDateString(ctx.locale.locale()) : date.toLocaleString(ctx.locale.locale())
  }

  const kindLabel = (kind: SelfUpdateInfo["install"]["kind"]) => {
    switch (kind) {
      case "git":
        return ctx.t("about.installKind.git")
      case "package":
        return ctx.t("about.installKind.package")
      case "directory":
        return ctx.t("about.installKind.directory")
      default:
        return ctx.t("about.installKind.unknown")
    }
  }

  const copyPath = async () => {
    const path = info()?.install.path
    if (!path) return
    try {
      await ctx.system.copy(path)
      ctx.toast.show({ title: ctx.t("common.copyPath"), description: path, variant: "success" })
    } catch (error) {
      ctx.toast.show({ title: ctx.t("error.title"), description: errorText(error), variant: "error" })
    }
  }

  const openRepository = () => {
    const repository = info()?.repository
    if (repository) ctx.system.openExternal(repository)
  }

  const changeChannel = (value: string) => {
    const next: SelfUpdateChannel = value === "stable" ? "stable" : "main"
    if (next === selfUpdateChannel()) return
    setSelfUpdateChannel(next)
    setAppliedCommits([])
    setSuppressChangelog(false)
    setResult(undefined)
    void runCheck(true)
  }

  const changeFrequency = (value: string) => {
    const next: SelfUpdateFrequency = value === "daily" || value === "manual" ? value : "startup"
    setSelfUpdateFrequency(next)
  }

  const applyUpdate = async () => {
    if (!canUpdate() || updating() || rollingBack()) return
    const target = packageTarget()
    const value = info()
    const current = shortCommit(check()?.currentCommit ?? value?.install.commit) ?? value?.version ?? "?"
    const latest = shortCommit(check()?.latestCommit) ?? check()?.latestVersion ?? "?"
    const confirmed = await ctx.dialogs.confirm({
      title: ctx.t("about.updateConfirmTitle"),
      description: target
        ? ctx.t("about.updateConfirmPackage")
        : ctx.t("about.updateConfirmDescription", { current, latest }),
      confirm: ctx.t("about.update"),
    })
    if (!confirmed) return
    setUpdating(true)
    setLocalCheckError(undefined)
    setResult(undefined)
    setResultKind("update")
    const pendingCommits = check()?.commits ?? []
    try {
      if (target) {
        await ctx.client.plugin.update({ targets: [target] })
        setPackageUpdate(undefined)
        setResult({
          ok: true,
          previousCommit: "",
          commit: "",
          version: value?.version ?? "0.0.0",
          restartRequired: true,
        })
        ctx.toast.show({ title: ctx.t("about.updateDone"), variant: "success", icon: "circle-check" })
      } else {
        const output = await ctx.client.rpc(ManagerRpc).applySelfUpdate({
          channel: selfUpdateChannel(),
        })
        setResult(output)
        if (output.ok) {
          if (output.restartRequired) {
            setAppliedCommits(pendingCommits)
            setSuppressChangelog(false)
          }
          ctx.toast.show({
            title: output.restartRequired ? ctx.t("about.updateDone") : ctx.t("about.noUpdate"),
            variant: "success",
            icon: "circle-check",
          })
        } else {
          ctx.toast.show({
            title: ctx.t("about.updateFailed"),
            description: output.error,
            variant: "error",
          })
        }
        await load()
        await loadHistory()
        await runCheck(false)
      }
      if (target) await load()
    } catch (error) {
      const text = errorText(error)
      setLocalCheckError(text)
      ctx.toast.show({ title: ctx.t("about.updateFailed"), description: text, variant: "error" })
    } finally {
      setUpdating(false)
    }
  }

  const rollbackBlockedReason = () => {
    const current = info()
    if (!current) return undefined
    if (current.install.kind !== "git") return ctx.t("about.history.reason.git")
    if (!current.install.canUpdate) {
      return current.install.reason ?? ctx.t("about.history.reason.checkout")
    }
    return undefined
  }

  const entryNote = (entry: SelfUpdateHistoryEntry) => {
    if (rollbackBlockedReason()) return undefined
    if (entry.commit === info()?.install.commit) return ctx.t("about.history.reason.current")
    return undefined
  }

  const canRollback = (entry: SelfUpdateHistoryEntry) =>
    entry.action === "update" &&
    Boolean(info()) &&
    !rollbackBlockedReason() &&
    !entryNote(entry) &&
    !updating() &&
    !rollingBack()

  const rollback = async (entry: SelfUpdateHistoryEntry) => {
    if (!canRollback(entry)) return
    const confirmed = await ctx.dialogs.confirm({
      title: ctx.t("about.history.rollbackConfirmTitle"),
      description: ctx.t("about.history.rollbackConfirmDescription", {
        current: info()?.version ?? "?",
        target: `${entry.version} (${shortCommit(entry.commit) ?? entry.commit})`,
      }),
      confirm: ctx.t("about.history.rollback"),
    })
    if (!confirmed) return
    setRollingBack(entry.commit)
    setLocalCheckError(undefined)
    setResult(undefined)
    setResultKind("rollback")
    try {
      const output = await ctx.client.rpc(ManagerRpc).rollbackSelfUpdate({ commit: entry.commit })
      setResult(output)
      setSuppressChangelog(true)
      setAppliedCommits([])
      if (output.ok) {
        ctx.toast.show({
          title: ctx.t("about.history.rollbackDone"),
          variant: "success",
          icon: "circle-check",
        })
      } else {
        ctx.toast.show({
          title: ctx.t("about.history.rollbackFailed"),
          description: output.error,
          variant: "error",
        })
      }
      await load()
      await loadHistory()
      await runCheck(false)
    } catch (error) {
      const text = errorText(error)
      setLocalCheckError(text)
      ctx.toast.show({
        title: ctx.t("about.history.rollbackFailed"),
        description: text,
        variant: "error",
      })
    } finally {
      setRollingBack(undefined)
    }
  }

  const resultTitle = () =>
    resultKind() === "rollback" ? ctx.t("about.history.result") : ctx.t("about.result")

  const resultText = () => {
    const value = result()
    if (!value) return undefined
    if (resultKind() === "rollback") {
      return value.ok ? ctx.t("about.history.rollbackDone") : ctx.t("about.history.rollbackFailed")
    }
    if (!value.ok) return ctx.t("about.updateFailed")
    return value.restartRequired ? ctx.t("about.updateDone") : ctx.t("about.noUpdate")
  }

  onMount(() => {
    void (async () => {
      await Promise.all([load(), loadHistory()])
      await autoCheckSelfUpdate(ctx)
    })()
  })

  return (
    <>
      <ctx.ui.SettingsSection
        title={ctx.t("about.title")}
        footer={<span class="oem-hint">{ctx.t("about.description")}</span>}
      >
        <Show when={loading()}>
          <ctx.ui.SettingsRow
            title={ctx.t("common.loading")}
            children={<ctx.ui.Loader size="small" />}
          />
        </Show>

        <Show when={loadError()}>
          <ctx.ui.SettingsRow
            title={ctx.t("error.title")}
            description={<span class="oem-error">{loadError()}</span>}
          >
            <ctx.ui.Button icon="refresh" size="small" onClick={() => void load()}>
              {ctx.t("common.refresh")}
            </ctx.ui.Button>
          </ctx.ui.SettingsRow>
        </Show>

        <Show when={info()}>
          {(value) => (
            <>
              <ctx.ui.SettingsRow
                id="oem-about-info"
                title={
                  <span class="oem-title">
                    <span>{value().name}</span>
                    <span class="oem-badge">{value().version}</span>
                    <span class="oem-badge">{ctx.t("about.experimental")}</span>
                  </span>
                }
                description={
                  <span class="oem-description">
                    <Show when={value().description}>
                      <span>{value().description}</span>
                    </Show>
                    <span class="oem-hint">
                      {ctx.t("about.appVersion", { version: value().app.version })} · {value().app.channel}
                    </span>
                    <span class="oem-hint">
                      {ctx.t("about.license")}: {value().license ?? ctx.t("updates.unknown")} ·{" "}
                      {ctx.t("about.author")}: {value().author ?? ctx.t("updates.unknown")}
                    </span>
                    <Show when={value().repository}>
                      <span class="oem-path">{value().repository}</span>
                    </Show>
                  </span>
                }
              >
                <div class="oem-actions">
                  <Show when={value().repository}>
                    <ctx.ui.Button icon="github" size="small" onClick={openRepository}>
                      {ctx.t("about.openRepo")}
                    </ctx.ui.Button>
                  </Show>
                </div>
              </ctx.ui.SettingsRow>

              <ctx.ui.SettingsRow
                id="oem-about-install"
                title={ctx.t("about.install")}
                description={
                  <span class="oem-description">
                    <span class="oem-title">
                      <span class="oem-badge">{kindLabel(value().install.kind)}</span>
                      <Show when={value().install.branch}>
                        <span class="oem-hint">
                          {ctx.t("about.branch")}: {value().install.branch}
                        </span>
                      </Show>
                      <Show when={value().install.commit}>
                        <span class="oem-hint">
                          {ctx.t("about.commit")}: {shortCommit(value().install.commit)}
                        </span>
                      </Show>
                    </span>
                    <Show when={value().install.reason}>
                      <span class="oem-hint">{value().install.reason}</span>
                    </Show>
                    <span class="oem-path">{value().install.path}</span>
                  </span>
                }
              >
                <div class="oem-actions">
                  <ctx.ui.IconButton
                    icon="copy"
                    size="small"
                    label={ctx.t("common.copyPath")}
                    onClick={() => void copyPath()}
                  />
                  <ctx.ui.IconButton
                    icon="folder"
                    size="small"
                    label={ctx.t("common.showInFolder")}
                    onClick={() => revealPath(ctx, value().install.path)}
                  />
                </div>
              </ctx.ui.SettingsRow>

              <ctx.ui.SettingsRow
                id="oem-about-channel"
                title={ctx.t("about.channel")}
                description={<span class="oem-hint">{ctx.t("about.channelHint")}</span>}
              >
                <ctx.ui.Select
                  label={ctx.t("about.channel")}
                  value={selfUpdateChannel()}
                  options={[
                    { value: "main", label: ctx.t("about.channel.main") },
                    { value: "stable", label: ctx.t("about.channel.stable") },
                  ]}
                  onChange={changeChannel}
                />
              </ctx.ui.SettingsRow>

              <ctx.ui.SettingsRow
                id="oem-about-frequency"
                title={ctx.t("about.frequency")}
                description={<span class="oem-hint">{ctx.t("about.frequencyHint")}</span>}
              >
                <ctx.ui.Select
                  label={ctx.t("about.frequency")}
                  value={selfUpdateFrequency()}
                  options={[
                    { value: "startup", label: ctx.t("about.frequency.startup") },
                    { value: "daily", label: ctx.t("about.frequency.daily") },
                    { value: "manual", label: ctx.t("about.frequency.manual") },
                  ]}
                  onChange={changeFrequency}
                />
              </ctx.ui.SettingsRow>

              <ctx.ui.SettingsRow
                id="oem-about-check"
                title={
                  <span class="oem-title">
                    <span>{ctx.t("about.check")}</span>
                    <Show when={updateState() === "available"}>
                      <span class="oem-badge">{ctx.t("about.updateAvailable")}</span>
                    </Show>
                    <Show when={updateState() === "current"}>
                      <span class="oem-badge">{ctx.t("about.upToDate")}</span>
                    </Show>
                  </span>
                }
                description={
                  <span class="oem-description">
                    <Show when={checkErrorText()}>
                      <span class="oem-error">{checkErrorText()}</span>
                    </Show>
                    <Show when={checkedAt()}>
                      <span class="oem-hint">
                        {ctx.t("updates.checkedAt", {
                          time: formatDate(checkedAt()) ?? checkedAt() ?? "",
                        })}
                      </span>
                    </Show>
                    <Show when={versionLine()}>
                      <span class="oem-hint">{versionLine()}</span>
                    </Show>
                    <Show when={commitLine()}>
                      <span class="oem-hint">{commitLine()}</span>
                    </Show>
                    <Show when={check()?.latestMessage}>
                      <span class="oem-hint">
                        {check()!.latestMessage}
                        <Show when={check()?.latestDate}> · {check()!.latestDate}</Show>
                      </span>
                    </Show>
                    <Show when={statusDetail()}>
                      <span class={updateState() === "blocked" ? "oem-error" : "oem-hint"}>{statusDetail()}</span>
                    </Show>
                    <Show when={!checkedAt() && !checking() && !checkErrorText()}>
                      <span class="oem-muted">{ctx.t("updates.notChecked")}</span>
                    </Show>
                  </span>
                }
              >
                <div class="oem-actions">
                  <ctx.ui.Button
                    icon="refresh"
                    size="small"
                    busy={checking()}
                    disabled={updating() || Boolean(rollingBack())}
                    onClick={() => void runCheck()}
                  >
                    {checking() ? ctx.t("updates.checking") : ctx.t("about.check")}
                  </ctx.ui.Button>
                  <ctx.ui.Button
                    variant="contrast"
                    icon="download"
                    size="small"
                    busy={updating()}
                    disabled={!canUpdate() || checking() || Boolean(rollingBack())}
                    onClick={() => void applyUpdate()}
                  >
                    {updating() ? ctx.t("updates.updating") : ctx.t("about.update")}
                  </ctx.ui.Button>
                </div>
              </ctx.ui.SettingsRow>

              <Show when={whatsNew().length > 0}>
                <ctx.ui.SettingsRow
                  id="oem-about-whats-new"
                  title={
                    <span class="oem-title">
                      <span>{ctx.t("about.whatsNew")}</span>
                      <span class="oem-badge">
                        {ctx.t("about.whatsNewCount", { count: whatsNew().length })}
                      </span>
                    </span>
                  }
                  description={
                    <span class="oem-description">
                      <For each={whatsNew()}>
                        {(commit) => (
                          <span class="oem-hint">
                            {commit.message} · {shortCommit(commit.sha)} · {formatDate(commit.date, "date")}
                          </span>
                        )}
                      </For>
                    </span>
                  }
                />
              </Show>

              <Show when={result()}>
                {(value) => (
                  <ctx.ui.SettingsRow
                    title={resultTitle()}
                    description={
                      <span class="oem-description">
                        <span class={value().ok ? "oem-hint" : "oem-error"}>
                          {resultText()}
                          <Show when={value().error}>: {value().error}</Show>
                        </span>
                        <Show when={value().restartRequired}>
                          <span class="oem-hint">{ctx.t("about.restartHint")}</span>
                        </Show>
                        <Show when={value().log}>
                          <span class="oem-command">{value().log}</span>
                        </Show>
                      </span>
                    }
                  />
                )}
              </Show>
            </>
          )}
        </Show>
      </ctx.ui.SettingsSection>

      <ctx.ui.SettingsSection
        title={ctx.t("about.history")}
        footer={<span class="oem-hint">{ctx.t("about.historyHint")}</span>}
      >
        <Show when={historyLoading()}>
          <ctx.ui.SettingsRow
            title={ctx.t("common.loading")}
            children={<ctx.ui.Loader size="small" />}
          />
        </Show>

        <Show when={historyError()}>
          <ctx.ui.SettingsRow
            title={ctx.t("error.title")}
            description={<span class="oem-error">{historyError()}</span>}
          >
            <ctx.ui.Button icon="refresh" size="small" onClick={() => void loadHistory()}>
              {ctx.t("common.refresh")}
            </ctx.ui.Button>
          </ctx.ui.SettingsRow>
        </Show>

        <Show when={!historyLoading() && !historyError() && history().length === 0}>
          <ctx.ui.SettingsRow title={<span class="oem-muted">{ctx.t("about.historyEmpty")}</span>} />
        </Show>

        <Show when={rollbackBlockedReason()}>
          {(reason) => (
            <ctx.ui.SettingsRow
              title={ctx.t("about.history.rollback")}
              description={
                <span class="oem-error">
                  {ctx.t("about.history.rollbackUnavailable", { reason: reason() })}
                </span>
              }
            />
          )}
        </Show>

        <For each={history()}>
          {(entry) => (
            <ctx.ui.SettingsRow
              id={`oem-about-history-${entry.action}-${entry.commit}`}
              title={
                <span class="oem-title">
                  <span class="oem-badge">
                    {entry.action === "update"
                      ? ctx.t("about.history.action.update")
                      : ctx.t("about.history.action.rollback")}
                  </span>
                  <span>{entry.version}</span>
                  <span class="oem-badge">{shortCommit(entry.commit)}</span>
                </span>
              }
              description={
                <span class="oem-description">
                  <span class="oem-hint">{formatDate(entry.at)}</span>
                  <Show when={entry.note}>
                    <span class="oem-hint">{entry.note}</span>
                  </Show>
                  <Show when={entryNote(entry)}>
                    <span class="oem-muted">{entryNote(entry)}</span>
                  </Show>
                </span>
              }
            >
              <Show when={entry.action === "update"}>
                <ctx.ui.Button
                  icon="arrow-left"
                  size="small"
                  busy={rollingBack() === entry.commit}
                  disabled={!canRollback(entry)}
                  onClick={() => void rollback(entry)}
                >
                  {rollingBack() === entry.commit
                    ? ctx.t("about.history.rollingBack")
                    : ctx.t("about.history.rollback")}
                </ctx.ui.Button>
              </Show>
            </ctx.ui.SettingsRow>
          )}
        </For>
      </ctx.ui.SettingsSection>
    </>
  )
}

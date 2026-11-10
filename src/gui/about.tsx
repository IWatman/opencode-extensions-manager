import { createSignal, onMount, Show } from "solid-js"
import {
  ManagerRpc,
  type SelfUpdateCheck,
  type SelfUpdateInfo,
  type SelfUpdateResult,
} from "../rpc"
import { errorText, revealPath, type GuiContext } from "./helpers"

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
  const [checking, setChecking] = createSignal(false)
  const [checkedAt, setCheckedAt] = createSignal<string>()
  const [check, setCheck] = createSignal<SelfUpdateCheck>()
  const [packageUpdate, setPackageUpdate] = createSignal<PackageUpdate>()
  const [pluginKind, setPluginKind] = createSignal<"package" | "local" | "other">("other")
  const [checkError, setCheckError] = createSignal<string>()
  const [updating, setUpdating] = createSignal(false)
  const [result, setResult] = createSignal<SelfUpdateResult>()

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

  const runCheck = async () => {
    setChecking(true)
    setCheckError(undefined)
    setPackageUpdate(undefined)
    setPluginKind("other")
    try {
      if (!info()) await load()
      const current = info()
      const errors: string[] = []
      const [serverCheck, packageCheck] = await Promise.allSettled([
        ctx.client.rpc(ManagerRpc).checkSelfUpdate({}),
        current?.install.kind !== "git" ? findPackageUpdate() : Promise.resolve(undefined),
      ])
      if (serverCheck.status === "fulfilled") {
        setCheck(serverCheck.value)
        setCheckedAt(serverCheck.value.checkedAt)
      } else {
        errors.push(`${ctx.t("about.checkFailed")}: ${errorText(serverCheck.reason)}`)
      }
      if (packageCheck.status === "fulfilled" && packageCheck.value) {
        setPackageUpdate(packageCheck.value)
      } else if (packageCheck.status === "rejected") {
        errors.push(`${ctx.t("about.checkFailed")}: ${errorText(packageCheck.reason)}`)
      }
      setCheckError(errors.length > 0 ? errors.join("; ") : undefined)
    } finally {
      setChecking(false)
    }
  }

  const updateState = () => {
    const current = info()
    if (!current) return "unknown" as const
    if (checkError()) return "blocked" as const
    if (packageUpdate()) return "available" as const
    if (pluginKind() === "package") return checkedAt() ? ("current" as const) : ("unknown" as const)
    if (current.install.kind === "directory") return "blocked" as const
    if (current.install.kind === "git" && !current.install.canUpdate) return "blocked" as const
    if (check()?.updateAvailable) return check()!.canUpdate ? ("available" as const) : ("blocked" as const)
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
    if (check()?.ahead) return ctx.t("about.aheadHint")
    if (check()?.reason && updateState() === "blocked") return check()!.reason
    return undefined
  }

  const versionLine = () => {
    const current = check()?.currentVersion ?? info()?.version
    const latest = check()?.latestVersion
    if (!current || !latest || latest === current) return undefined
    return ctx.t("updates.versionChange", { current, latest })
  }

  const commitLine = () => {
    const current = shortCommit(check()?.currentCommit ?? info()?.install.commit)
    const latest = shortCommit(check()?.latestCommit)
    if (!current || !latest || current === latest) return undefined
    return ctx.t("updates.commitChange", { current, latest })
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

  const applyUpdate = async () => {
    if (!canUpdate() || updating()) return
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
    setCheckError(undefined)
    setResult(undefined)
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
        const output = await ctx.client.rpc(ManagerRpc).applySelfUpdate({})
        setResult(output)
        if (output.ok) {
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
        await runCheck()
      }
      if (target) await load()
    } catch (error) {
      const text = errorText(error)
      setCheckError(text)
      ctx.toast.show({ title: ctx.t("about.updateFailed"), description: text, variant: "error" })
    } finally {
      setUpdating(false)
    }
  }

  onMount(() => {
    void (async () => {
      await load()
      await runCheck()
    })()
  })

  return (
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
                  <Show when={checkError()}>
                    <span class="oem-error">{checkError()}</span>
                  </Show>
                  <Show when={checkedAt()}>
                    <span class="oem-hint">
                      {ctx.t("updates.checkedAt", {
                        time: new Date(checkedAt()!).toLocaleString(ctx.locale.locale()),
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
                  <Show when={!checkedAt() && !checking() && !checkError()}>
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
                  disabled={updating()}
                  onClick={() => void runCheck()}
                >
                  {checking() ? ctx.t("updates.checking") : ctx.t("about.check")}
                </ctx.ui.Button>
                <ctx.ui.Button
                  variant="contrast"
                  icon="download"
                  size="small"
                  busy={updating()}
                  disabled={!canUpdate() || checking()}
                  onClick={() => void applyUpdate()}
                >
                  {updating() ? ctx.t("updates.updating") : ctx.t("about.update")}
                </ctx.ui.Button>
              </div>
            </ctx.ui.SettingsRow>

            <Show when={result()}>
              {(value) => (
                <ctx.ui.SettingsRow
                  title={ctx.t("about.result")}
                  description={
                    <span class="oem-description">
                      <span class={value().ok ? "oem-hint" : "oem-error"}>
                        {value().ok
                          ? value().restartRequired
                            ? ctx.t("about.updateDone")
                            : ctx.t("about.noUpdate")
                          : ctx.t("about.updateFailed")}
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
  )
}

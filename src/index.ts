import { Plugin } from "@opencode/plugin"
import {
  ensureScope as ensureScopeFolders,
  listMcp,
  listPlugins,
  listSkills,
  previewMcp as previewMcpChange,
  readScope,
  removeMcp,
  removePlugin,
  removeSkill,
  resolveScope,
  saveMcp,
  savePlugin,
  saveSkill,
  setMcpEnabled,
  setSkillEnabled,
  withWriteLock,
  type ScopePaths,
} from "./config"
import {
  ManagerRpc,
  type ClaudeInstallResult,
  type Diagnostic,
  type InstalledPlugin,
  type ManagerState,
  type MarketplaceInfo,
  type McpEntry,
  type PluginEntry,
  type Scope,
  type ScopeInfo,
  type SkillEntry,
} from "./rpc"
import {
  addMarketplace,
  checkMarketplaceUpdates,
  getCatalog,
  inspectMarketplacePlugin,
  inspectRepository,
  installMarketplacePlugin,
  installRepository,
  installedRecords,
  listMarketplaces,
  marketplaceInfo,
  marketplaceRecords,
  normalizeInstalledMcpUrls,
  normalizeMcpUrls,
  readRegistry,
  removeMarketplace,
  setMarketplacePluginEnabled,
  uninstallMarketplacePlugin,
  updateMarketplacePlugin,
  updateMarketplacePlugins,
} from "./marketplaces"
import {
  installClaudeCandidate,
  previewClaudePlugins,
  scanClaudePlugins,
} from "./claude"
import {
  applySelfUpdate,
  checkSelfUpdate,
  selfUpdateInfo,
} from "./self-update"

/* Config safety additions, kept separate from the marketplace and self-update imports. */
import { configBackupDiff, listConfigBackups, restoreConfigBackup as restoreBackup } from "./backups"
import { writeDoctorReport } from "./doctor-report"

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

interface StateBuilder {
  global: ScopeInfo
  project?: ScopeInfo
  projectError?: string
  mcp: McpEntry[]
  plugins: PluginEntry[]
  skills: SkillEntry[]
  diagnostics: Diagnostic[]
  marketplaces: MarketplaceInfo[]
  installedPlugins: InstalledPlugin[]
  marketplaceError?: string
}

export default Plugin.define({
  id: "opencode-extensions-manager",
  async setup(ctx) {
    const defaultProject = () => ctx.location.directory

    const scopePaths = (scope: Scope, project?: string) =>
      resolveScope(scope, project?.trim() || defaultProject())

    const collect = async (
      paths: ScopePaths,
      document: Awaited<ReturnType<typeof readScope>>,
      scope: Scope,
      result: StateBuilder,
    ) => {
      for (const error of document.errors) {
        result.diagnostics.push({ scope, message: `${paths.configPath}: ${error}` })
      }
      for (const server of listMcp(document.data)) {
        result.mcp.push({ scope, name: server.name, config: server.config })
      }
      for (const plugin of listPlugins(document.data)) {
        result.plugins.push({ scope, ...plugin })
      }
      try {
        for (const skill of await listSkills(paths.skillsDir)) {
          result.skills.push({ scope, ...skill })
        }
      } catch (error) {
        result.diagnostics.push({ scope, message: `${paths.skillsDir}: ${message(error)}` })
      }
    }

    const buildState = async (project?: string): Promise<ManagerState> => {
      const globalPaths = await resolveScope("global")
      const globalDocument = await readScope(globalPaths)
      const registryResult = await readRegistry()
      const result: StateBuilder = {
        global: {
          root: globalPaths.root,
          configDir: globalPaths.configDir,
          configPath: globalPaths.configPath,
          configExists: globalPaths.configExists,
          skillsDir: globalPaths.skillsDir,
        },
        mcp: [],
        plugins: [],
        skills: [],
        diagnostics: [],
        marketplaces: marketplaceRecords(registryResult.registry).map((record) => marketplaceInfo(record)),
        installedPlugins: installedRecords(registryResult.registry),
      }

      if (registryResult.error) {
        result.marketplaceError = registryResult.error
        result.diagnostics.push({ scope: "global", message: `Marketplace registry: ${registryResult.error}` })
      }

      await collect(globalPaths, globalDocument, "global", result)

      try {
        const projectPaths = await scopePaths("project", project)
        const projectDocument = await readScope(projectPaths)
        result.project = {
          root: projectPaths.root,
          configDir: projectPaths.configDir,
          configPath: projectPaths.configPath,
          configExists: projectPaths.configExists,
          skillsDir: projectPaths.skillsDir,
        }
        await collect(projectPaths, projectDocument, "project", result)
      } catch (error) {
        result.projectError = message(error)
      }

      return result
    }

    await ctx.rpc.register(ManagerRpc, {
      state: (input) => buildState(input.project),

      saveMcp: (input) =>
        withWriteLock(async () => {
          const paths = await scopePaths(input.scope, input.project)
          await saveMcp(paths, {
            name: input.name,
            ...(input.originalName === undefined ? {} : { originalName: input.originalName }),
            config: input.config,
          })
          return buildState(input.project)
        }),

      removeMcp: (input) =>
        withWriteLock(async () => {
          const paths = await scopePaths(input.scope, input.project)
          await removeMcp(paths, input.name)
          return buildState(input.project)
        }),

      setMcpEnabled: (input) =>
        withWriteLock(async () => {
          const paths = await scopePaths(input.scope, input.project)
          await setMcpEnabled(paths, input.name, input.enabled)
          return buildState(input.project)
        }),

      savePlugin: (input) =>
        withWriteLock(async () => {
          const paths = await scopePaths(input.scope, input.project)
          await savePlugin(paths, {
            ...(input.index === undefined ? {} : { index: input.index }),
            package: input.package,
            ...(input.options === undefined ? {} : { options: input.options }),
          })
          return buildState(input.project)
        }),

      removePlugin: (input) =>
        withWriteLock(async () => {
          const paths = await scopePaths(input.scope, input.project)
          await removePlugin(paths, input.index)
          return buildState(input.project)
        }),

      saveSkill: (input) =>
        withWriteLock(async () => {
          const paths = await scopePaths(input.scope, input.project)
          await saveSkill(paths, {
            id: input.id,
            ...(input.originalId === undefined ? {} : { originalId: input.originalId }),
            content: input.content,
          })
          return buildState(input.project)
        }),

      removeSkill: (input) =>
        withWriteLock(async () => {
          const paths = await scopePaths(input.scope, input.project)
          await removeSkill(paths, input.id)
          return buildState(input.project)
        }),

      setSkillEnabled: (input) =>
        withWriteLock(async () => {
          const paths = await scopePaths(input.scope, input.project)
          await setSkillEnabled(paths, input.id, input.enabled)
          return buildState(input.project)
        }),

      marketplaces: async (input) => ({ marketplaces: await listMarketplaces(input.refresh === true) }),

      catalog: async (input) => ({
        plugins: await getCatalog(
          input.marketplace,
          input.refresh === true,
          input.scope ? { scope: input.scope, ...(input.project ? { project: input.project } : {}) } : undefined,
        ),
      }),

      addMarketplace: (input) =>
        withWriteLock(async () => {
          const added = await addMarketplace(input.url)
          const state = await buildState(input.project)
          if (added.repository) {
            return { kind: "repository" as const, repository: added.repository, state }
          }
          return {
            kind: "marketplace" as const,
            ...(added.record ? { marketplace: marketplaceInfo(added.record) } : {}),
            state,
          }
        }),

      removeMarketplace: (input) =>
        withWriteLock(async () => {
          await removeMarketplace(input.marketplace)
          return buildState(input.project)
        }),

      inspectMarketplacePlugin: (input) => inspectMarketplacePlugin(input.marketplace, input.plugin),

      installMarketplacePlugin: (input) =>
        withWriteLock(async () => {
          await installMarketplacePlugin(input)
          return buildState(input.project)
        }),

      uninstallMarketplacePlugin: (input) =>
        withWriteLock(async () => {
          const skipped = await uninstallMarketplacePlugin(input.key)
          const state = await buildState(input.project)
          return skipped.length > 0 ? { ...state, skipped } : state
        }),

      setMarketplacePluginEnabled: (input) =>
        withWriteLock(async () => {
          const skipped = await setMarketplacePluginEnabled(input.key, input.enabled)
          const state = await buildState(input.project)
          return skipped.length > 0 ? { ...state, skipped } : state
        }),

      updateMarketplacePlugin: (input) =>
        withWriteLock(async () => {
          await updateMarketplacePlugin(input.key)
          return buildState(input.project)
        }),

      checkMarketplaceUpdates: () => checkMarketplaceUpdates(),

      updateAllMarketplacePlugins: (input) =>
        withWriteLock(async () => {
          const results = await updateMarketplacePlugins(input.keys)
          return { state: await buildState(input.project), results }
        }),

      previewClaudePlugins: (input) =>
        previewClaudePlugins({
          scope: input.scope,
          ...(input.project ? { project: input.project } : {}),
          ...(input.cacheDir ? { cacheDir: input.cacheDir } : {}),
        }),

      installClaudePlugins: (input) =>
        withWriteLock(async () => {
          const scan = await scanClaudePlugins(input.cacheDir ? { cacheDir: input.cacheDir } : {})
          const candidates = new Map(scan.candidates.map((candidate) => [candidate.id, candidate]))
          const results: ClaudeInstallResult[] = []
          const seen = new Set<string>()
          for (const selection of input.plugins) {
            if (seen.has(selection.id)) continue
            seen.add(selection.id)
            const candidate = candidates.get(selection.id)
            if (!candidate) {
              results.push({
                id: selection.id,
                name: selection.id,
                ok: false,
                error: `Claude Code plugin not found: ${selection.id}`,
              })
              continue
            }
            const name = candidate.displayName ?? candidate.name
            try {
              const installed = await installClaudeCandidate(candidate, {
                scope: input.scope,
                ...(input.project ? { project: input.project } : {}),
                ...(selection.adapt === undefined ? {} : { adapt: selection.adapt }),
              })
              results.push({
                id: candidate.id,
                name,
                ok: true,
                key: installed.key,
                ...(installed.skipped.length > 0 ? { skipped: installed.skipped } : {}),
              })
            } catch (error) {
              results.push({ id: candidate.id, name, ok: false, error: message(error) })
            }
          }
          return { state: await buildState(input.project), results }
        }),

      inspectRepository: (input) => inspectRepository(input.url),

      installRepository: (input) =>
        withWriteLock(async () => {
          await installRepository(input.proposal, input.scope, input.project)
          return buildState(input.project)
        }),

      selfUpdateInfo: () => selfUpdateInfo(ctx.app),

      checkSelfUpdate: () => checkSelfUpdate(),

      applySelfUpdate: () => applySelfUpdate(),

      /* ---------------------------------------------------------------------------------------- */
      /* Config safety: backups, previews, scope setup, and Doctor report                         */
      /* ---------------------------------------------------------------------------------------- */

      configBackups: (input) =>
        withWriteLock(async () => ({
          backups: await listConfigBackups(input.scope, input.project),
        })),

      configBackupDiff: (input) =>
        withWriteLock(() => configBackupDiff(input.scope, input.project, input.path)),

      restoreConfigBackup: (input) =>
        withWriteLock(async () => {
          await restoreBackup(input.scope, input.project, input.path)
          return buildState(input.project)
        }),

      previewMcp: (input) =>
        withWriteLock(async () => {
          const paths = await scopePaths(input.scope, input.project)
          return previewMcpChange(paths, {
            name: input.name,
            ...(input.originalName === undefined ? {} : { originalName: input.originalName }),
            config: input.config,
          })
        }),

      ensureScope: (input) =>
        withWriteLock(async () => {
          const paths = await scopePaths(input.scope, input.project)
          await ensureScopeFolders(paths)
          return buildState(input.project)
        }),

      exportDoctorReport: (input) =>
        withWriteLock(async () => {
          const paths = await scopePaths(input.scope, input.project)
          const report = await writeDoctorReport({
            scope: input.scope,
            paths,
            ...(input.project === undefined ? {} : { project: input.project }),
            state: input.state,
          })
          return { path: report }
        }),
    })

    await withWriteLock(async () => {
      try {
        await normalizeMcpUrls(await resolveScope("global"))
      } catch {
        // A broken or missing global config must not block plugin activation.
      }
      try {
        await normalizeMcpUrls(await scopePaths("project", defaultProject()))
      } catch {
        // No project or no readable project config.
      }
      await normalizeInstalledMcpUrls()
    })
  },
})

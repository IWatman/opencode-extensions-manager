import { Schema } from "effect"
import { Rpc } from "@opencode/plugin/rpc"

/**
 * The RPC contract shared by the server half and the GUI half of the plugin.
 * Keep this file free of Node and GUI imports: the GUI bundle includes it.
 */

type PortableSource = Parameters<typeof Schema.toStandardSchemaV1>[0]

/**
 * The GUI bundle runs effect schemas through the host's Standard Schema adapter: the RPC contract must be portable
 * across processes, and a bare effect schema is not. The wrapper keeps the schema's type views, so inputs and outputs
 * stay inferred from these declarations.
 */
const portable = <S extends PortableSource>(schema: S) => Schema.toStandardSchemaV1(schema)

const Scope = Schema.Literals(["global", "project"])
export type Scope = typeof Scope.Type

const ScopeInfo = Schema.Struct({
  /** Global config directory, or the project root for the project scope. */
  root: Schema.String,
  /** Directory that holds the config file. */
  configDir: Schema.String,
  /** Config file this scope writes to. */
  configPath: Schema.String,
  /** False when the file does not exist yet and will be created on the first write. */
  configExists: Schema.Boolean,
  /** Directory that holds skills, `<skillsDir>/<id>/SKILL.md`. */
  skillsDir: Schema.String,
})
export type ScopeInfo = typeof ScopeInfo.Type

const McpEntry = Schema.Struct({
  scope: Scope,
  name: Schema.String,
  /** Raw `mcp.servers.<name>` value, kept untyped so hand-written fields survive a round trip. */
  config: Schema.Unknown,
})
export type McpEntry = typeof McpEntry.Type

const PluginEntry = Schema.Struct({
  scope: Scope,
  index: Schema.Finite,
  /** Raw `plugins[index]` value. */
  raw: Schema.Unknown,
  /** Best-effort package or local path for display. Empty for entries this manager cannot read. */
  package: Schema.String,
  options: Schema.optionalKey(Schema.Unknown),
  /** True for a `"-package"` entry, which removes an automatically discovered plugin. */
  removal: Schema.Boolean,
})
export type PluginEntry = typeof PluginEntry.Type

const SkillEntry = Schema.Struct({
  scope: Scope,
  id: Schema.String,
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  /** Path of the SKILL.md file (or of the single-file skill). */
  path: Schema.String,
  /** Path of the skill directory (or of the single-file skill). */
  dir: Schema.String,
  /** `dir` is a directory with SKILL.md, `file` is `<id>.md` at the skills root. */
  kind: Schema.Literals(["dir", "file"]),
  disabled: Schema.Boolean,
  content: Schema.String,
})
export type SkillEntry = typeof SkillEntry.Type

const Diagnostic = Schema.Struct({
  scope: Scope,
  message: Schema.String,
})
export type Diagnostic = typeof Diagnostic.Type

const MarketplaceInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  owner: Schema.optionalKey(Schema.String),
  url: Schema.String,
  builtin: Schema.Boolean,
  ref: Schema.optionalKey(Schema.String),
  pluginCount: Schema.optionalKey(Schema.Finite),
  error: Schema.optionalKey(Schema.String),
})
export type MarketplaceInfo = typeof MarketplaceInfo.Type

const MarketplacePlugin = Schema.Struct({
  marketplace: Schema.String,
  name: Schema.String,
  displayName: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  author: Schema.optionalKey(Schema.String),
  category: Schema.optionalKey(Schema.String),
  homepage: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  installedKey: Schema.optionalKey(Schema.String),
})
export type MarketplacePlugin = typeof MarketplacePlugin.Type

const ArtifactFingerprints = Schema.Struct({
  mcp: Schema.Record(Schema.String, Schema.String),
  skills: Schema.Record(Schema.String, Schema.String),
  plugins: Schema.Record(Schema.String, Schema.String),
})
export type ArtifactFingerprints = typeof ArtifactFingerprints.Type

const InstalledPlugin = Schema.Struct({
  key: Schema.String,
  marketplace: Schema.String,
  marketplaceName: Schema.String,
  plugin: Schema.String,
  displayName: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  scope: Scope,
  project: Schema.optionalKey(Schema.String),
  enabled: Schema.Boolean,
  installedAt: Schema.String,
  updatedAt: Schema.String,
  version: Schema.optionalKey(Schema.String),
  commit: Schema.optionalKey(Schema.String),
  mcp: Schema.Array(Schema.String),
  skills: Schema.Array(Schema.String),
  plugins: Schema.Array(Schema.String),
  unsupported: Schema.Array(Schema.String),
  /** Content hashes recorded at install time for MCP servers, skills, and plugin entries. */
  fingerprints: Schema.optionalKey(ArtifactFingerprints),
  /** Artifacts kept on purpose because they no longer match the recorded fingerprint. */
  skipped: Schema.optionalKey(Schema.Array(Schema.String)),
  error: Schema.optionalKey(Schema.String),
})
export type InstalledPlugin = typeof InstalledPlugin.Type

const PluginInspection = Schema.Struct({
  marketplace: Schema.String,
  plugin: Schema.String,
  displayName: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  source: Schema.String,
  mcp: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      summary: Schema.String,
    }),
  ),
  skills: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.optionalKey(Schema.String),
      description: Schema.optionalKey(Schema.String),
    }),
  ),
  adaptable: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.optionalKey(Schema.String),
      description: Schema.optionalKey(Schema.String),
      reason: Schema.optionalKey(Schema.String),
    }),
  ),
  plugins: Schema.Array(Schema.String),
  unsupported: Schema.Array(Schema.String),
  warnings: Schema.Array(Schema.String),
})
export type PluginInspection = typeof PluginInspection.Type

const RepositoryProposal = Schema.Struct({
  kind: Schema.Literals(["mcp", "plugin"]),
  name: Schema.optionalKey(Schema.String),
  config: Schema.optionalKey(Schema.Unknown),
  package: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
})
export type RepositoryProposal = typeof RepositoryProposal.Type

const RepositoryInspection = Schema.Struct({
  url: Schema.String,
  owner: Schema.String,
  repo: Schema.String,
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  proposals: Schema.Array(RepositoryProposal),
  notes: Schema.Array(Schema.String),
})
export type RepositoryInspection = typeof RepositoryInspection.Type

export const StateSchema = Schema.Struct({
  global: ScopeInfo,
  project: Schema.optionalKey(ScopeInfo),
  projectError: Schema.optionalKey(Schema.String),
  mcp: Schema.Array(McpEntry),
  plugins: Schema.Array(PluginEntry),
  skills: Schema.Array(SkillEntry),
  diagnostics: Schema.Array(Diagnostic),
  marketplaces: Schema.Array(MarketplaceInfo),
  installedPlugins: Schema.Array(InstalledPlugin),
  marketplaceError: Schema.optionalKey(Schema.String),
  /** Artifacts deliberately left in place by the last uninstall or disable. */
  skipped: Schema.optionalKey(Schema.Array(Schema.String)),
})
export type ManagerState = typeof StateSchema.Type

const ProjectInput = {
  /** Project directory to manage. Omitted means the server location. */
  project: Schema.optionalKey(Schema.String),
}

const TargetInput = {
  scope: Scope,
  project: Schema.optionalKey(Schema.String),
}

export const ManagerRpc = Rpc.define({
  id: "extensions.manager",
  methods: {
    state: {
      input: portable(Schema.Struct(ProjectInput)),
      output: portable(StateSchema),
    },
    saveMcp: {
      input: portable(
        Schema.Struct({
          ...TargetInput,
          name: Schema.String,
          originalName: Schema.optionalKey(Schema.String),
          config: Schema.Unknown,
        }),
      ),
      output: portable(StateSchema),
    },
    removeMcp: {
      input: portable(
        Schema.Struct({
          ...TargetInput,
          name: Schema.String,
        }),
      ),
      output: portable(StateSchema),
    },
    setMcpEnabled: {
      input: portable(
        Schema.Struct({
          ...TargetInput,
          name: Schema.String,
          enabled: Schema.Boolean,
        }),
      ),
      output: portable(StateSchema),
    },
    savePlugin: {
      input: portable(
        Schema.Struct({
          ...TargetInput,
          /** Existing array index to replace; omitted adds a new entry. */
          index: Schema.optionalKey(Schema.Finite),
          package: Schema.String,
          options: Schema.optionalKey(Schema.Unknown),
        }),
      ),
      output: portable(StateSchema),
    },
    removePlugin: {
      input: portable(
        Schema.Struct({
          ...TargetInput,
          index: Schema.Finite,
        }),
      ),
      output: portable(StateSchema),
    },
    saveSkill: {
      input: portable(
        Schema.Struct({
          ...TargetInput,
          id: Schema.String,
          originalId: Schema.optionalKey(Schema.String),
          content: Schema.String,
        }),
      ),
      output: portable(StateSchema),
    },
    removeSkill: {
      input: portable(
        Schema.Struct({
          ...TargetInput,
          id: Schema.String,
        }),
      ),
      output: portable(StateSchema),
    },
    setSkillEnabled: {
      input: portable(
        Schema.Struct({
          ...TargetInput,
          id: Schema.String,
          enabled: Schema.Boolean,
        }),
      ),
      output: portable(StateSchema),
    },
    marketplaces: {
      input: portable(
        Schema.Struct({
          refresh: Schema.optionalKey(Schema.Boolean),
        }),
      ),
      output: portable(
        Schema.Struct({
          marketplaces: Schema.Array(MarketplaceInfo),
        }),
      ),
    },
    catalog: {
      input: portable(
        Schema.Struct({
          marketplace: Schema.String,
          refresh: Schema.optionalKey(Schema.Boolean),
          /** Selects which installed record marks a catalog row as installed. */
          scope: Schema.optionalKey(Scope),
          project: Schema.optionalKey(Schema.String),
        }),
      ),
      output: portable(
        Schema.Struct({
          plugins: Schema.Array(MarketplacePlugin),
        }),
      ),
    },
    addMarketplace: {
      input: portable(
        Schema.Struct({
          url: Schema.String,
          project: Schema.optionalKey(Schema.String),
        }),
      ),
      output: portable(
        Schema.Struct({
          kind: Schema.Literals(["marketplace", "repository"]),
          marketplace: Schema.optionalKey(MarketplaceInfo),
          repository: Schema.optionalKey(RepositoryInspection),
          state: StateSchema,
        }),
      ),
    },
    removeMarketplace: {
      input: portable(
        Schema.Struct({
          marketplace: Schema.String,
          project: Schema.optionalKey(Schema.String),
        }),
      ),
      output: portable(StateSchema),
    },
    inspectMarketplacePlugin: {
      input: portable(
        Schema.Struct({
          marketplace: Schema.String,
          plugin: Schema.String,
        }),
      ),
      output: portable(PluginInspection),
    },
    installMarketplacePlugin: {
      input: portable(
        Schema.Struct({
          ...TargetInput,
          marketplace: Schema.String,
          plugin: Schema.String,
          adapt: Schema.optionalKey(Schema.Boolean),
        }),
      ),
      output: portable(StateSchema),
    },
    uninstallMarketplacePlugin: {
      input: portable(
        Schema.Struct({
          key: Schema.String,
          project: Schema.optionalKey(Schema.String),
        }),
      ),
      output: portable(StateSchema),
    },
    setMarketplacePluginEnabled: {
      input: portable(
        Schema.Struct({
          key: Schema.String,
          enabled: Schema.Boolean,
          project: Schema.optionalKey(Schema.String),
        }),
      ),
      output: portable(StateSchema),
    },
    updateMarketplacePlugin: {
      input: portable(
        Schema.Struct({
          key: Schema.String,
          project: Schema.optionalKey(Schema.String),
        }),
      ),
      output: portable(StateSchema),
    },
    inspectRepository: {
      input: portable(
        Schema.Struct({
          url: Schema.String,
        }),
      ),
      output: portable(RepositoryInspection),
    },
    installRepository: {
      input: portable(
        Schema.Struct({
          ...TargetInput,
          proposal: RepositoryProposal,
        }),
      ),
      output: portable(StateSchema),
    },
  },
  events: {},
})

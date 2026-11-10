import assert from "node:assert/strict"
import test from "node:test"
import {
  claudeUpdates,
  packageUpdates,
  type ClaudeCandidateLike,
  type InstalledClaudeLike,
  type PluginInfoLike,
} from "../src/gui/update-helpers.ts"

test("packageUpdates keeps only outdated package sources and deduplicates targets", () => {
  const plugins: PluginInfoLike[] = [
    { source: { type: "package", target: "opencode-plugin-b", version: "2.0.0", outdated: true } },
    { source: { type: "package", target: "opencode-plugin-a", version: "1.5.0", outdated: true } },
    { source: { type: "package", target: "opencode-plugin-a", version: "1.5.0", outdated: true } },
    { source: { type: "package", target: "opencode-plugin-c", version: "3.0.0" } },
    { source: { type: "package", version: "1.0.0", outdated: true } },
    { source: { type: "builtin" } },
    { source: { type: "local", path: "C:/plugins/local" } },
    { source: { type: "sdk" } },
  ]

  assert.deepEqual(packageUpdates(plugins), [
    { target: "opencode-plugin-a", version: "1.5.0" },
    { target: "opencode-plugin-b", version: "2.0.0" },
  ])
})

test("packageUpdates returns an empty list when nothing is outdated", () => {
  assert.deepEqual(
    packageUpdates([
      { source: { type: "package", target: "one", version: "1.0.0" } },
      { source: { type: "package", target: "two", version: "2.0.0", outdated: false } },
    ]),
    [],
  )
})

test("claudeUpdates compares cached candidates with installed Claude imports", () => {
  const candidates: ClaudeCandidateLike[] = [
    { id: "alpha", name: "alpha", displayName: "Alpha", version: "2.0.0", installedKey: "claude-code/alpha@global" },
    { id: "beta", name: "beta", version: "1.0.0", installedKey: "claude-code/beta@global" },
    { id: "gamma", name: "gamma", version: "4.0.0" },
    { id: "delta", name: "delta", version: "2.0.0", installedKey: "claude-code/delta@global" },
    { id: "epsilon", name: "epsilon", installedKey: "claude-code/epsilon@global" },
  ]
  const installed: InstalledClaudeLike[] = [
    {
      key: "claude-code/alpha@global",
      marketplace: "claude-code",
      version: "1.0.0",
      adapt: true,
    },
    { key: "claude-code/beta@global", marketplace: "claude-code", version: "1.0.0" },
    { key: "claude-code/delta@global", marketplace: "claude-code" },
    { key: "claude-code/epsilon@global", marketplace: "claude-code", version: "1.0.0" },
    { key: "other/alpha@global", marketplace: "other", version: "0.1.0" },
  ]

  assert.deepEqual(claudeUpdates(candidates, installed, { scope: "global" }), [
    {
      key: "claude-code/alpha@global",
      id: "alpha",
      name: "Alpha",
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      scope: "global",
      adapt: true,
    },
  ])
})

test("claudeUpdates scopes project imports and ignores other marketplaces", () => {
  const candidates: ClaudeCandidateLike[] = [
    {
      id: "alpha",
      name: "alpha",
      version: "2.0.0",
      installedKey: "claude-code/alpha@project:C%3A%5Cwork",
    },
  ]
  const installed: InstalledClaudeLike[] = [
    {
      key: "claude-code/alpha@project:C%3A%5Cwork",
      marketplace: "claude-code",
      version: "1.0.0",
    },
    {
      key: "claude-code/alpha@project:C%3A%5Cother",
      marketplace: "claude-code",
      version: "1.0.0",
    },
  ]

  assert.deepEqual(
    claudeUpdates(candidates, installed, {
      scope: "project",
      project: "C:\\work",
      marketplace: "claude-code",
    }),
    [
      {
        key: "claude-code/alpha@project:C%3A%5Cwork",
        id: "alpha",
        name: "alpha",
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        scope: "project",
        project: "C:\\work",
      },
    ],
  )
})

test("claudeUpdates deduplicates records and sorts updates by name", () => {
  const candidates: ClaudeCandidateLike[] = [
    { id: "zulu", name: "zulu", version: "2.0.0", installedKey: "claude-code/zulu@global" },
    { id: "alpha", name: "alpha", version: "2.0.0", installedKey: "claude-code/alpha@global" },
  ]
  const installed: InstalledClaudeLike[] = [
    { key: "claude-code/zulu@global", marketplace: "claude-code", version: "1.0.0" },
    { key: "claude-code/alpha@global", marketplace: "claude-code", version: "1.0.0" },
    { key: "claude-code/alpha@global", marketplace: "claude-code", version: "1.0.0" },
  ]

  assert.deepEqual(
    claudeUpdates(candidates, installed, { scope: "global" }).map((item) => item.name),
    ["alpha", "zulu"],
  )
})

import assert from "node:assert/strict"
import test from "node:test"
import {
  shouldCheckSelfUpdate,
  SELF_UPDATE_CHANNEL_KEY,
  SELF_UPDATE_FREQUENCY_KEY,
} from "../src/gui/self-update-settings.ts"

test("auto-check frequency follows startup, daily, and manual rules", () => {
  const now = Date.parse("2026-11-10T12:00:00.000Z")
  assert.equal(shouldCheckSelfUpdate("startup", undefined, now), true)
  assert.equal(shouldCheckSelfUpdate("startup", new Date(now).toISOString(), now), true)
  assert.equal(shouldCheckSelfUpdate("manual", undefined, now), false)
  assert.equal(shouldCheckSelfUpdate("manual", new Date(now).toISOString(), now), false)
  assert.equal(shouldCheckSelfUpdate("daily", undefined, now), true)
  assert.equal(shouldCheckSelfUpdate("daily", "not a date", now), true)
  assert.equal(shouldCheckSelfUpdate("daily", new Date(now - 23 * 60 * 60 * 1000).toISOString(), now), false)
  assert.equal(shouldCheckSelfUpdate("daily", new Date(now - 24 * 60 * 60 * 1000).toISOString(), now), true)
  assert.equal(shouldCheckSelfUpdate("daily", new Date(now - 48 * 60 * 60 * 1000).toISOString(), now), true)
})

test("self-update preferences use stable localStorage keys", () => {
  assert.equal(SELF_UPDATE_FREQUENCY_KEY, "opencode-extensions-manager.self-update.frequency")
  assert.equal(SELF_UPDATE_CHANNEL_KEY, "opencode-extensions-manager.self-update.channel")
})

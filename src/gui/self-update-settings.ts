/**
 * Browser-local preferences for plugin self-updates. These are deliberately separate from the
 * OpenCode config file: they belong to this settings page, not to the plugin runtime.
 */
export type SelfUpdateFrequency = "startup" | "daily" | "manual"
export type SelfUpdateChannel = "main" | "stable"

export const SELF_UPDATE_FREQUENCY_KEY = "opencode-extensions-manager.self-update.frequency"
export const SELF_UPDATE_CHANNEL_KEY = "opencode-extensions-manager.self-update.channel"
export const SELF_UPDATE_LAST_CHECK_KEY = "opencode-extensions-manager.self-update.last-check"
export const SELF_UPDATE_AVAILABILITY_KEY = "opencode-extensions-manager.self-update.update-available"

const day = 24 * 60 * 60 * 1000

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function read(key: string) {
  try {
    return storage()?.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

function write(key: string, value: string | undefined) {
  try {
    if (value === undefined) storage()?.removeItem(key)
    else storage()?.setItem(key, value)
  } catch {
    // A full or disabled localStorage must not break the settings page.
  }
}

export function readSelfUpdateFrequency(): SelfUpdateFrequency {
  const value = read(SELF_UPDATE_FREQUENCY_KEY)
  return value === "daily" || value === "manual" ? value : "startup"
}

export function writeSelfUpdateFrequency(value: SelfUpdateFrequency) {
  write(SELF_UPDATE_FREQUENCY_KEY, value)
}

export function readSelfUpdateChannel(): SelfUpdateChannel {
  return read(SELF_UPDATE_CHANNEL_KEY) === "stable" ? "stable" : "main"
}

export function writeSelfUpdateChannel(value: SelfUpdateChannel) {
  write(SELF_UPDATE_CHANNEL_KEY, value)
}

export function readLastSelfUpdateCheck(): string | undefined {
  return read(SELF_UPDATE_LAST_CHECK_KEY)
}

export function readSelfUpdateAvailability(): boolean {
  return read(SELF_UPDATE_AVAILABILITY_KEY) === "true"
}

export function recordSelfUpdateCheck(at: string, available: boolean) {
  write(SELF_UPDATE_LAST_CHECK_KEY, at)
  write(SELF_UPDATE_AVAILABILITY_KEY, available ? "true" : "false")
}

export function clearSelfUpdateAvailability() {
  write(SELF_UPDATE_AVAILABILITY_KEY, "false")
}

/** Startup always checks; daily waits 24 hours; manual never checks automatically. */
export function shouldCheckSelfUpdate(
  frequency: SelfUpdateFrequency,
  lastCheck: string | undefined,
  now = Date.now(),
): boolean {
  if (frequency === "manual") return false
  if (frequency === "startup") return true
  if (!lastCheck) return true
  const time = Date.parse(lastCheck)
  if (Number.isNaN(time)) return true
  return now - time >= day
}

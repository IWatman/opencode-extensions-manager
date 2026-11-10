import { createSignal } from "solid-js"
import { ManagerRpc, type SelfUpdateCheck } from "../rpc"
import { errorText, type GuiContext } from "./helpers"
import {
  clearSelfUpdateAvailability,
  readLastSelfUpdateCheck,
  readSelfUpdateAvailability,
  readSelfUpdateChannel,
  readSelfUpdateFrequency,
  recordSelfUpdateCheck,
  shouldCheckSelfUpdate,
  writeSelfUpdateChannel,
  writeSelfUpdateFrequency,
  type SelfUpdateChannel,
  type SelfUpdateFrequency,
} from "./self-update-settings"

/**
 * Shared state for the settings page and the About tab. A module-level store keeps the tab badge
 * and the About section in sync and de-duplicates checks triggered by both components.
 */
const [check, setCheck] = createSignal<SelfUpdateCheck>()
const [checking, setChecking] = createSignal(false)
const [checkError, setCheckError] = createSignal<string>()
const [checkedAt, setCheckedAt] = createSignal<string | undefined>(readLastSelfUpdateCheck())
const [checkedChannel, setCheckedChannel] = createSignal<SelfUpdateChannel>()
const [cachedAvailable, setCachedAvailable] = createSignal(readSelfUpdateAvailability())
const [frequency, setFrequency] = createSignal<SelfUpdateFrequency>(readSelfUpdateFrequency())
const [channel, setChannel] = createSignal<SelfUpdateChannel>(readSelfUpdateChannel())

interface CheckJob {
  readonly channel: SelfUpdateChannel
  readonly promise: Promise<SelfUpdateCheck>
}

let active: CheckJob | undefined
let autoChecked = false

export function selfUpdateCheck() {
  return check()
}

export function selfUpdateChecking() {
  return checking()
}

export function selfUpdateCheckError() {
  return checkError()
}

export function selfUpdateCheckedAt() {
  return checkedAt()
}

export function selfUpdateFrequency() {
  return frequency()
}

export function setSelfUpdateFrequency(value: SelfUpdateFrequency) {
  setFrequency(value)
  writeSelfUpdateFrequency(value)
}

export function selfUpdateChannel() {
  return channel()
}

export function setSelfUpdateChannel(value: SelfUpdateChannel) {
  if (value === channel()) return
  setChannel(value)
  writeSelfUpdateChannel(value)
  resetSelfUpdateCheck()
}

export function resetSelfUpdateCheck() {
  setCheck(undefined)
  setCheckedAt(undefined)
  setCheckedChannel(undefined)
  setCheckError(undefined)
  setCachedAvailable(false)
  clearSelfUpdateAvailability()
}

/** Badge value: a completed check wins, otherwise the cached last result is shown. */
export function selfUpdateAvailable() {
  const current = check()
  if (current) return current.updateAvailable
  if (frequency() === "manual") return false
  return cachedAvailable()
}

export async function runSelfUpdateCheck(
  ctx: GuiContext,
  options: { force?: boolean; channel?: SelfUpdateChannel } = {},
): Promise<SelfUpdateCheck> {
  const targetChannel = options.channel ?? channel()
  if (active) {
    if (active.channel === targetChannel) return active.promise
    try {
      await active.promise
    } catch {
      // A newer channel request supersedes a failed one.
    }
  }
  const current = check()
  if (!options.force && current && checkedChannel() === targetChannel) return current

  setChecking(true)
  setCheckError(undefined)
  let job: CheckJob | undefined
  const promise = ctx.client.rpc(ManagerRpc).checkSelfUpdate({ channel: targetChannel })
    .then((value) => {
      setCheck(value)
      setCheckedAt(value.checkedAt)
      setCheckedChannel(targetChannel)
      setCachedAvailable(value.updateAvailable)
      recordSelfUpdateCheck(value.checkedAt, value.updateAvailable)
      return value
    })
    .catch((error: unknown) => {
      setCheckError(errorText(error))
      throw error
    })
    .finally(() => {
      if (active === job) {
        active = undefined
        setChecking(false)
      }
    })
  job = { channel: targetChannel, promise }
  active = job
  return promise
}

/**
 * Checks once per page session when the saved frequency allows it. Daily uses the persisted
 * timestamp; a stale cached result stays visible until the new check finishes.
 */
export async function autoCheckSelfUpdate(ctx: GuiContext) {
  if (autoChecked) return
  autoChecked = true
  const saved = readSelfUpdateFrequency()
  setFrequency(saved)
  if (!shouldCheckSelfUpdate(saved, readLastSelfUpdateCheck())) return
  try {
    await runSelfUpdateCheck(ctx)
  } catch {
    // The shared error signal is rendered by the About section.
  }
}

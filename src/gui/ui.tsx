import { For, Show, type JSX } from "solid-js"
import type { SortKey } from "./list"
import type { GuiContext } from "./helpers"

/** Lightweight loading rows shown instead of a plain spinner. */
export function SkeletonRows(props: { count?: number }) {
  return (
    <div class="oem-skeleton-list" aria-hidden="true">
      <For each={Array.from({ length: props.count ?? 3 }, (_, index) => index)}>
        {() => (
          <div class="oem-skeleton-row">
            <span class="oem-skeleton oem-skeleton-title" />
            <span class="oem-skeleton oem-skeleton-line" />
          </div>
        )}
      </For>
    </div>
  )
}

/** Native checkbox kept small and theme-neutral so it fits the host's settings rows. */
export function SelectionBox(props: {
  checked: boolean
  label: string
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <input
      type="checkbox"
      class="oem-check"
      checked={props.checked}
      disabled={props.disabled}
      aria-label={props.label}
      onChange={(event) => props.onChange(event.currentTarget.checked)}
    />
  )
}

export function SortControl(props: {
  ctx: GuiContext
  value: SortKey
  options: readonly { value: SortKey; label: string }[]
  onChange: (value: SortKey) => void
}) {
  const ctx = props.ctx
  return (
    <div class="oem-sort">
      <span class="oem-hint">{ctx.t("sort.label")}</span>
      <ctx.ui.Select
        label={ctx.t("sort.label")}
        value={props.value}
        options={props.options}
        onChange={(value) => props.onChange(value as SortKey)}
      />
    </div>
  )
}

export interface BulkProgress {
  readonly current: number
  readonly total: number
  readonly name: string
  readonly mode: "delete" | "toggle"
}

export interface BulkResult {
  readonly ok: number
  readonly failed: number
  readonly failures: readonly string[]
}

export function BulkBar(props: {
  ctx: GuiContext
  count: number
  progress?: BulkProgress
  result?: BulkResult
  busy: boolean
  children: JSX.Element
}) {
  const ctx = props.ctx
  return (
    <div class="oem-bulkbar">
      <span class="oem-bulk-count">{ctx.t("bulk.selected", { count: props.count })}</span>
      <div class="oem-actions">{props.children}</div>
      <Show when={props.progress}>
        {(progress) => (
          <span class="oem-hint oem-bulk-progress" aria-live="polite">
            {ctx.t(progress().mode === "delete" ? "bulk.deleteProgress" : "bulk.progress", {
              current: progress().current,
              total: progress().total,
              name: progress().name,
            })}
          </span>
        )}
      </Show>
      <Show when={!props.progress && props.result}>
        {(result) => (
          <span
            class={result().failed > 0 ? "oem-error oem-bulk-result" : "oem-hint oem-bulk-result"}
            aria-live="polite"
          >
            {ctx.t("bulk.summary", { ok: result().ok, failed: result().failed })}
            <Show when={result().failures.length > 0}> — {result().failures.slice(0, 2).join("; ")}</Show>
          </span>
        )}
      </Show>
    </div>
  )
}

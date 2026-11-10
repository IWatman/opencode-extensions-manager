import { For, Show } from "solid-js"
import { diffLines } from "./diff"
import type { GuiContext } from "./helpers"

/** Compact unified diff with before/after line numbers and a copy-friendly monospace body. */
export function DiffView(props: { ctx: GuiContext; before: string; after: string }) {
  const ctx = props.ctx
  const lines = () => diffLines(props.before, props.after)
  const changed = () => lines().some((line) => line.kind !== "context")

  return (
    <Show
      when={changed()}
      fallback={<div class="oem-hint">{ctx.t("diff.noChanges")}</div>}
    >
      <div class="oem-diff" role="table">
        <For each={lines()}>
          {(line) => (
            <div class={`oem-diff-line oem-diff-${line.kind}`} role="row">
              <span class="oem-diff-gutter" aria-hidden="true">
                {line.oldLine ?? ""}
              </span>
              <span class="oem-diff-gutter" aria-hidden="true">
                {line.newLine ?? ""}
              </span>
              <span class="oem-diff-prefix" aria-hidden="true">
                {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}
              </span>
              <span class="oem-diff-text">{line.text || " "}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}

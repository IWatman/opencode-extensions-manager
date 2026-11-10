/** Shell-like quoting helpers shared by the GUI and the server-side source inspector. */

export function quoteArgument(argument: string) {
  if (argument.length > 0 && !/[\s"'\\]/.test(argument)) return argument
  return JSON.stringify(argument)
}

export function formatCommand(arguments_: readonly string[]) {
  return arguments_.map(quoteArgument).join(" ")
}

/** Splits a command line the way a shell would for the simple quoting a command array needs. */
export function splitCommand(input: string): string[] {
  const result: string[] = []
  let current = ""
  let quote: "'" | '"' | undefined
  let escaped = false
  let started = false

  for (const character of input) {
    if (escaped) {
      // A backslash only escapes characters a shell treats specially. Keep it before ordinary
      // characters, so Windows paths such as C:\work survive instead of becoming C:work.
      if (character === "\\" || character === '"' || character === "'" || /\s/.test(character)) {
        current += character
      } else {
        current += `\\${character}`
      }
      escaped = false
      started = true
      continue
    }
    if (character === "\\" && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) {
        quote = undefined
        continue
      }
      current += character
      started = true
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      started = true
      continue
    }
    if (/\s/.test(character)) {
      if (started) {
        result.push(current)
        current = ""
        started = false
      }
      continue
    }
    current += character
    started = true
  }

  if (escaped) current += "\\"
  if (quote) throw new Error("Unterminated quote")
  if (started) result.push(current)
  return result
}

import * as clack from "@clack/prompts"

import { Cancelled, type Prompter } from "./prompts"

/** A prompt's answer, or Cancelled when the developer pressed Ctrl+C or Escape. */
export function unwrap<T>(value: T): Exclude<T, symbol> {
  if (clack.isCancel(value)) throw new Cancelled()
  return value as Exclude<T, symbol>
}

export function clackPrompter(): Prompter {
  return {
    intro: (title) => clack.intro(title),
    note: (message, title) => clack.note(message, title),
    groupMultiselect: async ({ message, groups, initialValues }) =>
      unwrap(await clack.groupMultiselect<string>({ message, options: groups, initialValues, required: false })),
    multiselect: async ({ message, choices, initialValues }) =>
      unwrap(await clack.multiselect<string>({ message, options: choices, initialValues, required: false })),
    select: async ({ message, choices, initialValue }) =>
      unwrap(await clack.select<string>({ message, options: choices, initialValue })),
    confirm: async ({ message, initialValue }) => unwrap(await clack.confirm({ message, initialValue })),
    outro: (message) => clack.outro(message),
  }
}

/** One option of a prompt. Values are strings so every prompt implementation can carry them. */
export interface Choice {
  value: string
  label: string
  hint?: string
  /** Shown but not selectable (installed rules, agents without an adapter). */
  disabled?: boolean
}

/**
 * The only terminal layer of init. The real one wraps @clack/prompts (init/clack.ts, loaded on demand so hooks
 * never pay for it); tests script the answers. Every prompt throws Cancelled when the developer cancels.
 */
export interface Prompter {
  intro(title: string): void
  note(message: string, title?: string): void
  groupMultiselect(options: {
    message: string
    groups: Record<string, Choice[]>
    initialValues: string[]
  }): Promise<string[]>
  multiselect(options: { message: string; choices: Choice[]; initialValues: string[] }): Promise<string[]>
  select(options: { message: string; choices: Choice[]; initialValue: string }): Promise<string>
  confirm(options: { message: string; initialValue: boolean }): Promise<boolean>
  outro(message: string): void
}

export class Cancelled extends Error {
  constructor() {
    super("cancelled")
  }
}

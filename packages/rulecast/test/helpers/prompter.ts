import { Cancelled, type Choice, type Prompter } from "../../src/init/prompts"

/** Answer a prompt with its default: the initial values, initial value or initial confirm. */
export const ACCEPT = Symbol("accept the default")
/** Answer a prompt the way Ctrl+C does. */
export const CANCEL = Symbol("cancel")

export type ScriptedAnswer = string | string[] | boolean | typeof ACCEPT | typeof CANCEL

export interface AskedPrompt {
  kind: "groupMultiselect" | "multiselect" | "select" | "confirm"
  message: string
  /** Selectable values, in order. */
  values: string[]
  initial: string | string[] | boolean
}

export interface ScriptedPrompter {
  prompter: Prompter
  asked: AskedPrompt[]
  /** intro, note and outro text, in order ("title\nmessage" for notes with a title). */
  shown: string[]
}

/** A Prompter that answers from a script, in order, and fails the test on an unexpected or invalid answer. */
export function scriptedPrompter(answers: ScriptedAnswer[]): ScriptedPrompter {
  const script = [...answers]
  const asked: AskedPrompt[] = []
  const shown: string[] = []
  const selectable = (choices: Choice[]) => choices.filter((choice) => !choice.disabled).map((choice) => choice.value)

  function next(prompt: AskedPrompt): ScriptedAnswer {
    asked.push(prompt)
    if (script.length === 0) throw new Error(`unexpected prompt: ${prompt.message}`)
    const answer = script.shift()!
    if (answer === CANCEL) throw new Cancelled()
    return answer === ACCEPT ? prompt.initial : answer
  }
  function values(prompt: AskedPrompt): string[] {
    const answer = next(prompt)
    if (!Array.isArray(answer) || answer.some((value) => !prompt.values.includes(value))) {
      throw new Error(
        `invalid answer ${JSON.stringify(answer)} to "${prompt.message}" (options ${prompt.values.join(", ")})`,
      )
    }
    return answer
  }

  const prompter: Prompter = {
    intro: (title) => shown.push(title),
    note: (message, title) => shown.push(title === undefined ? message : `${title}\n${message}`),
    outro: (message) => shown.push(message),
    groupMultiselect: async ({ message, groups, initialValues }) =>
      values({
        kind: "groupMultiselect",
        message,
        values: selectable(Object.values(groups).flat()),
        initial: initialValues,
      }),
    multiselect: async ({ message, choices, initialValues }) =>
      values({ kind: "multiselect", message, values: selectable(choices), initial: initialValues }),
    select: async ({ message, choices, initialValue }) => {
      const prompt: AskedPrompt = { kind: "select", message, values: selectable(choices), initial: initialValue }
      const answer = next(prompt)
      if (typeof answer !== "string" || !prompt.values.includes(answer)) {
        throw new Error(
          `invalid answer ${JSON.stringify(answer)} to "${message}" (options ${prompt.values.join(", ")})`,
        )
      }
      return answer
    },
    confirm: async ({ message, initialValue }) => {
      const answer = next({ kind: "confirm", message, values: [], initial: initialValue })
      if (typeof answer !== "boolean") throw new Error(`invalid answer ${JSON.stringify(answer)} to "${message}"`)
      return answer
    },
  }
  return { prompter, asked, shown }
}

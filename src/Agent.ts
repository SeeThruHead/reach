import { Schema } from "effect"

export const Address = Schema.String.pipe(Schema.brand("Address"))
export type Address = typeof Address.Type

export const State = Schema.Literals(["live", "asleep", "ended"])
export type State = typeof State.Type

export const Status = Schema.Literals(["idle", "working", "blocked", "unknown"])
export type Status = typeof Status.Type

export const Agent = Schema.Struct({
  address: Address,
  machine: Schema.String,
  space: Schema.String,
  name: Schema.String,
  pinned: Schema.Boolean,
  state: State,
  status: Status,
  host: Schema.String,
  id: Schema.String,
  cwd: Schema.String,
  resume: Schema.optional(Schema.Array(Schema.String))
})
export type Agent = typeof Agent.Type

export const slug = (text: string | null | undefined) =>
  (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")

export const baseName = (path: string | null | undefined) => (path ?? "").split("/").filter(Boolean).at(-1) ?? ""

export const addressOf = (machine: string, space: string, name: string) => Address.make(`${machine}/${space}/${name}`)

export const statusOf = (state: string | null | undefined): Status => {
  if (state === "idle" || state === "done") return "idle"
  if (state === "working" || state === "busy") return "working"
  if (state === "blocked") return "blocked"
  return "unknown"
}

export const AGENT_PROGRAMS = ["claude", "codex", "opencode", "gemini", "pi", "amp", "aider", "cursor-agent", "copilot"]

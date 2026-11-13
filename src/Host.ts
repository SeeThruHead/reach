import { Effect, Schema } from "effect"
import type { Agent } from "./Agent.ts"

export class HostError extends Schema.TaggedError<HostError>()("HostError", {
  host: Schema.String,
  message: Schema.String
}) {}

export type Host = {
  readonly name: string
  readonly list: Effect.Effect<ReadonlyArray<Agent>, HostError>
  readonly send: (agent: Agent, text: string) => Effect.Effect<void, HostError>
  readonly read: (agent: Agent, lines: number) => Effect.Effect<string, HostError>
  readonly reopen: (agent: Agent) => Effect.Effect<string, HostError>
}

export const cannotReopen = (host: string) => (agent: Agent) =>
  Effect.fail(new HostError({ host, message: `${host} can't reopen ${agent.address}; start it again by hand` }))

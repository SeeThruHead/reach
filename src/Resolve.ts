import { Effect, Schema } from "effect"
import { type Agent, addressOf } from "./Agent.ts"

export class BadAddress extends Schema.TaggedError<BadAddress>()("BadAddress", {
  target: Schema.String,
  message: Schema.String
}) {}

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  address: Schema.String,
  message: Schema.String
}) {}

export class Ambiguous extends Schema.TaggedError<Ambiguous>()("Ambiguous", {
  address: Schema.String,
  candidates: Schema.Array(Schema.String),
  message: Schema.String
}) {}

export class Ended extends Schema.TaggedError<Ended>()("Ended", {
  address: Schema.String,
  resume: Schema.optional(Schema.Array(Schema.String)),
  message: Schema.String
}) {}

export class Taken extends Schema.TaggedError<Taken>()("Taken", {
  address: Schema.String,
  message: Schema.String
}) {}

const part = /^[a-z0-9._-]+$/

export const parseTarget = Effect.fnUntraced(function* (target: string, machine: string) {
  const parts = target.split("/")
  if (!parts.every((p) => part.test(p))) {
    return yield* new BadAddress({
      target,
      message: `"${target}" is not an address: use machine/space/name, lowercase`
    })
  }
  if (parts.length === 3) return addressOf(parts[0] ?? "", parts[1] ?? "", parts[2] ?? "")
  if (parts.length === 2) return addressOf(machine, parts[0] ?? "", parts[1] ?? "")
  return yield* new BadAddress({
    target,
    message: `"${target}" is not an address: use machine/space/name or space/name`
  })
})

const where = (agent: Agent) => `${agent.host}:${agent.id} (${agent.cwd})`

export const pick = Effect.fnUntraced(function* (address: string, agents: ReadonlyArray<Agent>) {
  const matches = agents.filter((agent) => agent.address === address)
  const running = matches.filter((agent) => agent.state !== "ended")
  const [only] = running
  if (running.length === 1 && only) return only
  if (running.length > 1) {
    return yield* new Ambiguous({
      address,
      candidates: running.map(where),
      message: `${address} matches ${running.length} agents, so nothing was picked: ${running.map(where).join(", ")}`
    })
  }
  const [ended] = matches
  if (ended) {
    return yield* new Ended({
      address,
      ...(ended.resume ? { resume: ended.resume } : {}),
      message: `${address} has ended${ended.resume ? `; reopen it with: reach reopen ${address}` : ""}`
    })
  }
  return yield* new NotFound({ address, message: `no agent is at ${address}; reach ls lists them` })
})

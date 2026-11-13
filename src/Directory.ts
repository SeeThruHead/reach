import { Context, Effect, Layer } from "effect"
import type { Agent } from "./Agent.ts"
import { Config } from "./Config.ts"
import { type Host, HostError } from "./Host.ts"
import { herdrApp } from "./hosts/HerdrApp.ts"
import { plugins } from "./hosts/Plugins.ts"
import { tmux } from "./hosts/Tmux.ts"
import { type Ambiguous, type BadAddress, type Ended, NotFound, parseTarget, pick, Taken } from "./Resolve.ts"

type Listing = { readonly agents: ReadonlyArray<Agent>; readonly problems: ReadonlyArray<HostError> }
type Unresolved = BadAddress | NotFound | Ambiguous | Ended

export class Directory extends Context.Service<
  Directory,
  {
    readonly list: Effect.Effect<Listing>
    resolve(target: string): Effect.Effect<Agent, Unresolved>
    send(target: string, text: string): Effect.Effect<Agent, Unresolved | HostError>
    read(target: string, lines: number): Effect.Effect<string, Unresolved | HostError>
    reopen(target: string): Effect.Effect<string, BadAddress | NotFound | HostError>
    pin(target: string, to: string): Effect.Effect<Agent, Unresolved | Taken | HostError>
  }
>()("reach/Directory") {
  static readonly layerNoDeps = Layer.effect(
    Directory,
    Effect.gen(function* () {
      const config = yield* Config
      const hosts: ReadonlyArray<Host> = [yield* herdrApp, yield* tmux, ...(yield* plugins)]

      const list = Effect.forEach(hosts, (host) => Effect.result(host.list), { concurrency: "unbounded" }).pipe(
        Effect.map((results) => ({
          agents: results.flatMap((result) => (result._tag === "Success" ? result.success : [])),
          problems: results.flatMap((result) => (result._tag === "Failure" ? [result.failure] : []))
        })),
        Effect.withSpan("Directory.list")
      )

      const silentHosts = (problems: ReadonlyArray<HostError>) =>
        problems.length === 0 ? "" : ` (no answer from ${problems.map((problem) => problem.host).join(", ")})`

      const resolve = Effect.fn("Directory.resolve")(function* (target: string) {
        const address = yield* parseTarget(target, config.machine)
        yield* Effect.annotateCurrentSpan({ address })
        const { agents, problems } = yield* list
        return yield* pick(address, agents).pipe(
          Effect.catchTag("NotFound", (error) =>
            Effect.fail(new NotFound({ address: error.address, message: `${error.message}${silentHosts(problems)}` }))
          )
        )
      })

      const hostOf = (agent: Agent) =>
        Effect.fromNullishOr(hosts.find((host) => host.name === agent.host)).pipe(
          Effect.mapError(() => new HostError({ host: agent.host, message: `no host named ${agent.host}` }))
        )

      const send = Effect.fn("Directory.send")(function* (target: string, text: string) {
        const agent = yield* resolve(target)
        const host = yield* hostOf(agent)
        yield* host.send(agent, text)
        return agent
      })

      const read = Effect.fn("Directory.read")(function* (target: string, lines: number) {
        const agent = yield* resolve(target)
        const host = yield* hostOf(agent)
        return yield* host.read(agent, lines)
      })

      const reopen = Effect.fn("Directory.reopen")(function* (target: string) {
        const address = yield* parseTarget(target, config.machine)
        const { agents } = yield* list
        const matches = agents.filter((agent) => agent.address === address)
        const running = matches.find((agent) => agent.state !== "ended")
        if (running) return `${address} is ${running.state}; nothing to reopen`
        const ended = matches.find((agent) => agent.resume)
        if (!ended) return yield* new NotFound({ address, message: `no ended agent at ${address} that can be resumed` })
        const host = yield* hostOf(ended)
        return yield* host.reopen(ended)
      })

      const pin = Effect.fn("Directory.pin")(function* (target: string, to: string) {
        const agent = yield* resolve(target)
        const address = yield* parseTarget(to, agent.machine)
        const [machine, space = "", name = ""] = address.split("/")
        if (machine !== agent.machine) {
          return yield* new Taken({
            address,
            message: `${agent.address} runs on ${agent.machine}; a pin can't move it to ${machine}`
          })
        }
        const { agents } = yield* list
        const holder = agents.find(
          (other) => other.address === address && other.state !== "ended" && other.id !== agent.id
        )
        if (holder) return yield* new Taken({ address, message: `${address} is already ${holder.host}:${holder.id}` })
        const host = yield* hostOf(agent)
        yield* host.pin(agent, space, name)
        return { ...agent, address, space, name, pinned: true }
      })

      return Directory.of({ list, resolve, send, read, reopen, pin })
    })
  )

  static readonly layer = Directory.layerNoDeps.pipe(Layer.provideMerge(Config.layer))
}

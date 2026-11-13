import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Cause, Console, Effect, Layer, Option, Predicate, Stdio, Stream } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import type { Agent } from "./Agent.ts"
import { Directory } from "./Directory.ts"
import { Shell } from "./Shell.ts"
import packageJson from "../package.json" with { type: "json" }

const json = Flag.Boolean("json").pipe(Flag.withDescription("Print JSON"), Flag.withDefault(false))
const target = Argument.String("address").pipe(
  Argument.withDescription("machine/space/name, or space/name on this machine")
)

const row = (agent: Agent) =>
  [
    agent.address,
    agent.state,
    agent.status,
    agent.pinned ? "pinned" : "guessed",
    `${agent.host}:${agent.id}`,
    agent.cwd
  ].join("\t")

const failure = (asJson: boolean) => (error: { readonly _tag: string; readonly message: string }) =>
  Effect.gen(function* () {
    if (asJson) yield* Console.log(JSON.stringify({ error }))
    return yield* Effect.fail(error)
  })

const ls = Command.make("ls", { json }, ({ json }) =>
  Effect.gen(function* () {
    const directory = yield* Directory
    const { agents, problems } = yield* directory.list
    if (json) return yield* Console.log(JSON.stringify({ agents, problems }, null, 2))
    yield* Effect.forEach(agents, (agent) => Console.log(row(agent)), { discard: true })
    yield* Effect.forEach(problems, (problem) => Console.error(`${problem.host}: ${problem.message}`), {
      discard: true
    })
  })
).pipe(Command.withDescription("List every agent the hosts report, with its address and state"))

const resolve = Command.make("resolve", { target, json }, ({ target, json }) =>
  Effect.gen(function* () {
    const directory = yield* Directory
    const agent = yield* directory.resolve(target).pipe(Effect.catch(failure(json)))
    yield* Console.log(json ? JSON.stringify({ agent }) : row(agent))
  })
).pipe(Command.withDescription("Find the one agent at an address, or say why there isn't one; never a closest match"))

const readStdin = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio
  return yield* stdio.stdin.pipe(Stream.decodeText(), Stream.mkString)
})

const send = Command.make(
  "send",
  {
    target,
    message: Argument.String("message").pipe(
      Argument.withDescription("The message; read from stdin when left out"),
      Argument.optional
    ),
    json
  },
  ({ target, message, json }) =>
    Effect.gen(function* () {
      const directory = yield* Directory
      const text = Option.isSome(message) ? message.value : yield* readStdin
      const agent = yield* directory.send(target, text.trimEnd()).pipe(Effect.catch(failure(json)))
      yield* Console.log(json ? JSON.stringify({ sent: agent }) : `sent to ${agent.address} (${agent.state})`)
    })
).pipe(Command.withDescription("Deliver a message to the agent at an address; an asleep agent wakes with it"))

const read = Command.make(
  "read",
  { target, lines: Flag.Int("lines").pipe(Flag.withDefault(40), Flag.withDescription("How many lines")) },
  ({ target, lines }) =>
    Effect.gen(function* () {
      const directory = yield* Directory
      yield* Console.log(yield* directory.read(target, lines))
    })
).pipe(Command.withDescription("Print the bottom of an agent's screen"))

const reopen = Command.make("reopen", { target }, ({ target }) =>
  Effect.gen(function* () {
    const directory = yield* Directory
    yield* Console.log(yield* directory.reopen(target))
  })
).pipe(Command.withDescription("Start an ended agent again with its own session, where its host can"))

const reach = Command.make("reach").pipe(
  Command.withDescription("Find and message coding agents by a stable address: machine/space/name"),
  Command.withSubcommands([ls, resolve, send, read, reopen])
)

const services = Directory.layer.pipe(Layer.provide(Shell.layer), Layer.provideMerge(BunServices.layer))

const messageOf = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  return Predicate.hasProperty(error, "message") && Predicate.isString(error.message) && error.message
    ? error.message
    : Cause.pretty(cause)
}

reach.pipe(
  Command.run({ version: packageJson.version }),
  Effect.tapCause((cause) =>
    Cause.hasInterruptsOnly(cause) ? Effect.void : Console.error(`reach: ${messageOf(cause)}`)
  ),
  Effect.provide(services),
  BunRuntime.runMain({ disableErrorReporting: true })
)

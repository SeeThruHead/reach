import { Effect, Option, Schema } from "effect"
import { AGENT_PROGRAMS, type Agent, addressOf, baseName, slug, statusOf } from "../Agent.ts"
import { Config } from "../Config.ts"
import { type Host, HostError } from "../Host.ts"
import { Shell } from "../Shell.ts"

const HOST = "herdr-app"
const SHELLS = ["zsh", "bash", "sh", "fish", "dash", "-zsh", "-bash"]

const Terminal = Schema.Struct({
  address: Schema.String,
  name: Schema.NullOr(Schema.String),
  cwd: Schema.NullOr(Schema.String),
  state: Schema.String,
  reason: Schema.optional(Schema.NullOr(Schema.String)),
  foreground: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        argv: Schema.optional(Schema.Array(Schema.String)),
        cwd: Schema.optional(Schema.NullOr(Schema.String))
      })
    )
  ),
  labels: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.String))),
  status: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        state: Schema.optional(Schema.NullOr(Schema.String)),
        app: Schema.optional(Schema.NullOr(Schema.String))
      })
    )
  )
})
type Terminal = typeof Terminal.Type

const ListReply = Schema.fromJsonString(Schema.Struct({ result: Schema.Struct({ terminals: Schema.Array(Terminal) }) }))

const Machines = Schema.fromJsonString(
  Schema.Struct({
    machines: Schema.Array(
      Schema.Struct({ name: Schema.String, state: Schema.String, temporary: Schema.optional(Schema.Boolean) })
    )
  })
)

const Revive = Schema.fromJsonString(
  Schema.Struct({ kind: Schema.optional(Schema.String), argv: Schema.Array(Schema.String) })
)

const LIST_REQUEST = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "terminal.list", params: { all: true } })
const LIST_SCRIPT = `printf '%s\\n' '${LIST_REQUEST}' | hc connect | head -1`

const label = (terminal: Terminal, key: string) => terminal.labels?.[key] || null

const program = (terminal: Terminal) => baseName(terminal.foreground?.argv?.[0])

const reviveOf = (terminal: Terminal) =>
  Option.getOrNull(Schema.decodeUnknownOption(Revive)(label(terminal, "sth.revive") ?? ""))

const harnessOf = (terminal: Terminal) => {
  if (label(terminal, "sth.session") || label(terminal, "sth.sleep")) return "claude"
  const revive = reviveOf(terminal)
  if (revive?.kind) return revive.kind
  if (AGENT_PROGRAMS.includes(program(terminal))) return program(terminal)
  return terminal.status?.app ? slug(terminal.status.app.replace(/-code$/, "")) : null
}

const isAgent = (terminal: Terminal) => Boolean(label(terminal, "sth.agent")) || harnessOf(terminal) !== null

const resumeOf = (terminal: Terminal) => {
  const session = label(terminal, "sth.sleep") ?? label(terminal, "sth.session")
  if (session) return ["claude", "--resume", session]
  return reviveOf(terminal)?.argv ?? null
}

const stateOf = (terminal: Terminal): Agent["state"] => {
  if (terminal.state !== "live") return "ended"
  if (!SHELLS.includes(program(terminal))) return "live"
  return label(terminal, "sth.sleep") ? "asleep" : "ended"
}

const spaceAndTab = (terminal: Terminal) => {
  const [space, tab] = (label(terminal, "where") ?? "").split(" / ")
  return { space: space ?? "", tab: /^\d*$/.test(tab ?? "") ? "" : (tab ?? "") }
}

const toAgent =
  (machine: string, prefix: string) =>
  (terminal: Terminal): Agent => {
    const pinnedName = label(terminal, "sth.agent")
    const pinnedSpace = label(terminal, "sth.space")
    const place = spaceAndTab(terminal)
    const cwd = terminal.foreground?.cwd || terminal.cwd || ""
    const space = pinnedSpace ?? (slug(place.space) || slug(baseName(cwd)) || "home")
    const name = pinnedName ?? (slug(terminal.name) || slug(place.tab) || harnessOf(terminal) || "agent")
    const resume = resumeOf(terminal)
    return {
      address: addressOf(machine, space, name),
      machine,
      space,
      name,
      pinned: Boolean(pinnedName && pinnedSpace),
      state: stateOf(terminal),
      status: statusOf(terminal.status?.state),
      host: HOST,
      id: `${prefix}${terminal.address}`,
      cwd,
      ...(resume ? { resume } : {})
    }
  }

const inApp = (terminal: Terminal) => Boolean(label(terminal, "herdr.space")) && !terminal.address.includes("/")

export const herdrApp = Effect.gen(function* () {
  const shell = yield* Shell
  const config = yield* Config

  const fail = (message: string) => new HostError({ host: HOST, message })

  const hc = Effect.fnUntraced(function* (args: ReadonlyArray<string>) {
    const result = yield* shell
      .run("hc", args)
      .pipe(Effect.mapError((error) => fail(`${error.command}: ${error.message}`)))
    if (result.code !== 0)
      return yield* fail(`hc ${args[0]} exited ${result.code}: ${result.stdout.trim().slice(0, 300)}`)
    return result.stdout
  })

  const terminalsOn = Effect.fnUntraced(function* (machine: string | null) {
    const args = machine ? ["exec", "--on", machine, "sh", "-c", LIST_SCRIPT] : ["exec", "sh", "-c", LIST_SCRIPT]
    const text = yield* hc(args)
    const reply = yield* Schema.decodeUnknownEffect(ListReply)(text).pipe(
      Effect.mapError(() => fail(`hc answered something that is not a terminal list${machine ? ` on ${machine}` : ""}`))
    )
    return reply.result.terminals
      .filter(inApp)
      .filter(isAgent)
      .map(toAgent(machine ?? config.machine, machine ? `${machine}/` : ""))
  })

  const otherMachines = hc(["machine", "ls", "--json"]).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Machines)),
    Effect.map(({ machines }) => machines.filter((m) => m.state === "connected" && !m.temporary).map((m) => m.name)),
    Effect.orElseSucceed(() => [])
  )

  const list = Effect.gen(function* () {
    const here = yield* terminalsOn(null)
    const names = yield* otherMachines
    const there = yield* Effect.forEach(names, (name) => terminalsOn(name).pipe(Effect.orElseSucceed(() => [])), {
      concurrency: "unbounded"
    })
    return [...here, ...there.flat()]
  }).pipe(Effect.withSpan("HerdrApp.list"))

  const send = Effect.fn("HerdrApp.send")(function* (agent: Agent, text: string) {
    yield* hc(["send", agent.id, text])
  })

  const read = Effect.fn("HerdrApp.read")(function* (agent: Agent, lines: number) {
    return yield* hc(["read", agent.id, "--lines", String(lines)])
  })

  const reopen = Effect.fn("HerdrApp.reopen")(function* (agent: Agent) {
    if (!agent.resume) return yield* fail(`${agent.address} has no recorded way to resume it`)
    const machine = agent.machine === config.machine ? [] : ["--machine", agent.machine]
    const made = yield* shell
      .run("herdr-app", [
        "do",
        "space.new",
        "--name",
        agent.space,
        "--folder",
        agent.cwd,
        "--argv",
        JSON.stringify(agent.resume),
        ...machine
      ])
      .pipe(Effect.mapError((error) => fail(error.message)))
    if (made.code !== 0)
      return yield* fail(`herdr-app could not reopen ${agent.address}: ${made.stdout.trim().slice(0, 300)}`)
    return `reopened ${agent.address} with ${agent.resume.join(" ")}; Threads gives it its address back within a minute`
  })

  const pin = Effect.fn("HerdrApp.pin")(function* (agent: Agent, space: string, name: string) {
    yield* hc(["label", agent.id, `sth.agent=${name}`, `sth.space=${space}`])
  })

  return { name: HOST, list, send, read, reopen, pin } satisfies Host
})

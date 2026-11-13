import { Effect } from "effect"
import { AGENT_PROGRAMS, type Agent, addressOf, baseName, slug } from "../Agent.ts"
import { Config } from "../Config.ts"
import { cannotReopen, type Host, HostError } from "../Host.ts"
import { Shell } from "../Shell.ts"

const HOST = "tmux"
const FORMAT = [
  "#{pane_id}",
  "#{session_name}",
  "#{window_name}",
  "#{pane_current_command}",
  "#{pane_current_path}",
  "#{@agent}",
  "#{@space}"
].join("\t")

const paneOf = (line: string) => {
  const [id = "", session = "", window = "", command = "", cwd = "", agent = "", space = ""] = line.split("\t")
  return { id, session, window, command, cwd, agent, space }
}

type Pane = ReturnType<typeof paneOf>

const isAgent = (pane: Pane) => Boolean(pane.agent) || AGENT_PROGRAMS.includes(pane.command)

export const tmux = Effect.gen(function* () {
  const shell = yield* Shell
  const config = yield* Config
  const fail = (message: string) => new HostError({ host: HOST, message })

  const tmuxRun = Effect.fnUntraced(function* (args: ReadonlyArray<string>, stdin?: string) {
    const result = yield* shell.run("tmux", args, stdin).pipe(Effect.mapError((error) => fail(error.message)))
    if (result.code !== 0) return yield* fail(`tmux ${args[0]} exited ${result.code}`)
    return result.stdout
  })

  const toAgent = (pane: Pane): Agent => {
    const space = slug(pane.space) || slug(pane.session) || slug(baseName(pane.cwd))
    const name = slug(pane.agent) || slug(pane.window) || pane.command
    return {
      address: addressOf(config.machine, space, name),
      machine: config.machine,
      space,
      name,
      pinned: Boolean(pane.agent && pane.space),
      state: "live",
      status: "unknown",
      host: HOST,
      id: pane.id,
      cwd: pane.cwd
    }
  }

  const list = shell.run("tmux", ["list-panes", "-a", "-F", FORMAT]).pipe(
    Effect.map((result) =>
      result.code === 0 ? result.stdout.split("\n").filter(Boolean).map(paneOf).filter(isAgent).map(toAgent) : []
    ),
    Effect.orElseSucceed(() => []),
    Effect.withSpan("Tmux.list")
  )

  const send = Effect.fn("Tmux.send")(function* (agent: Agent, text: string) {
    yield* tmuxRun(["load-buffer", "-b", "reach", "-"], text)
    yield* tmuxRun(["paste-buffer", "-b", "reach", "-d", "-p", "-t", agent.id])
    yield* tmuxRun(["send-keys", "-t", agent.id, "Enter"])
  })

  const read = Effect.fn("Tmux.read")(function* (agent: Agent, lines: number) {
    return yield* tmuxRun(["capture-pane", "-p", "-t", agent.id, "-S", String(-lines)])
  })

  const pin = Effect.fn("Tmux.pin")(function* (agent: Agent, space: string, name: string) {
    yield* tmuxRun(["set-option", "-p", "-t", agent.id, "@agent", name])
    yield* tmuxRun(["set-option", "-p", "-t", agent.id, "@space", space])
  })

  return { name: HOST, list, send, read, reopen: cannotReopen(HOST), pin } satisfies Host
})

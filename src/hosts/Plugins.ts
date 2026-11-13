import { join } from "node:path"
import { Effect, FileSystem, Option, Schema } from "effect"
import { type Agent, Address, addressOf, baseName, slug, statusOf } from "../Agent.ts"
import { Config } from "../Config.ts"
import { cannotReopen, type Host, HostError } from "../Host.ts"
import { Shell } from "../Shell.ts"

const Listed = Schema.fromJsonString(
  Schema.Struct({
    agents: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        cwd: Schema.String,
        status: Schema.optional(Schema.String),
        name: Schema.optional(Schema.String),
        space: Schema.optional(Schema.String),
        address: Schema.optional(Schema.String)
      })
    )
  })
)

const NAME = /^[a-z][a-z0-9-]*$/
const RESERVED = ["herdr-app", "tmux"]

const hostName = (file: string) => baseName(file).replace(/\.[^.]+$/, "")

export const plugins = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const shell = yield* Shell
  const config = yield* Config

  const filesIn = (folder: string) =>
    fs.readDirectory(folder).pipe(
      Effect.map((names) => names.map((name) => join(folder, name))),
      Effect.orElseSucceed(() => [])
    )

  const files = (yield* Effect.forEach(config.pluginFolders, filesIn)).flat()
  const named = files.filter((file) => NAME.test(hostName(file)) && !RESERVED.includes(hostName(file)))
  const unique = named.filter((file, index) => named.findIndex((other) => hostName(other) === hostName(file)) === index)

  const plugin = (file: string): Host => {
    const host = hostName(file)
    const fail = (message: string) => new HostError({ host, message })

    const call = Effect.fnUntraced(function* (args: ReadonlyArray<string>, stdin?: string) {
      const result = yield* shell.run(file, args, stdin).pipe(Effect.mapError((error) => fail(error.message)))
      if (result.code !== 0) return yield* fail(`${host} ${args[0]} exited ${result.code}`)
      return result.stdout
    })

    const toAgent = (item: (typeof Listed.Type)["agents"][number]): Agent => {
      const given = Option.getOrNull(Schema.decodeUnknownOption(Address)(item.address ?? ""))
      const [machine = config.machine, givenSpace, givenName] = given ? given.split("/") : []
      const space = givenSpace ?? (slug(item.space) || slug(baseName(item.cwd)))
      const name = givenName ?? (slug(item.name) || host)
      return {
        address: addressOf(machine, space, name),
        machine,
        space,
        name,
        pinned: Boolean(given || (item.space && item.name)),
        state: "live",
        status: statusOf(item.status),
        host,
        id: item.id,
        cwd: item.cwd
      }
    }

    const list = call(["list"]).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Listed)),
      Effect.map(({ agents }) => agents.map(toAgent)),
      Effect.mapError((error) =>
        error instanceof HostError ? error : fail(`list printed something that is not { agents: [...] }`)
      )
    )

    const send = Effect.fn("Plugin.send")(function* (agent: Agent, text: string) {
      yield* call(["send", agent.id], text)
    })

    const read = Effect.fn("Plugin.read")(function* (agent: Agent, lines: number) {
      return yield* call(["read", agent.id, String(lines)])
    })

    return { name: host, list, send, read, reopen: cannotReopen(host) }
  }

  return unique.map(plugin)
})

import { hostname, homedir } from "node:os"
import { join } from "node:path"
import { Context, Effect, FileSystem, Layer, Option, Schema } from "effect"
import { slug } from "./Agent.ts"

export class ConfigError extends Schema.TaggedError<ConfigError>()("ConfigError", {
  message: Schema.String
}) {}

const ConfigFile = Schema.Struct({
  machine: Schema.optional(Schema.String),
  plugins: Schema.optional(Schema.Array(Schema.String))
})

export class Config extends Context.Service<
  Config,
  {
    readonly machine: string
    readonly home: string
    readonly pluginFolders: ReadonlyArray<string>
  }
>()("reach/Config") {
  static readonly layer = Layer.effect(
    Config,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const home = process.env["HOME"] ?? homedir()
      const folder = process.env["REACH_HOME"] ?? join(home, ".config", "reach")
      const text = yield* fs.readFileString(join(folder, "config.json")).pipe(Effect.option)
      const file = yield* Option.match(text, {
        onNone: () => Effect.succeed<typeof ConfigFile.Type>({}),
        onSome: (raw) =>
          Schema.decodeUnknownEffect(Schema.fromJsonString(ConfigFile))(raw).pipe(
            Effect.mapError(
              (error) => new ConfigError({ message: `${join(folder, "config.json")} is not valid: ${error.message}` })
            )
          )
      })
      const machine = slug(process.env["REACH_MACHINE"] ?? file.machine ?? hostname().split(".")[0])
      const pluginFolders = file.plugins ?? [join(folder, "plugins"), join(home, ".review-desk", "plugins")]
      return Config.of({ machine, home, pluginFolders })
    })
  )
}

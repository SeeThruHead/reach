import { Context, Duration, Effect, Layer, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

export class ShellError extends Schema.TaggedError<ShellError>()("ShellError", {
  command: Schema.String,
  message: Schema.String
}) {}

const RUN_TIMEOUT = Duration.seconds(30)

export class Shell extends Context.Service<
  Shell,
  {
    run(
      command: string,
      args: ReadonlyArray<string>,
      stdin?: string
    ): Effect.Effect<{ readonly stdout: string; readonly code: number }, ShellError>
  }
>()("reach/Shell") {
  static readonly layer = Layer.effect(
    Shell,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const collect = Effect.fnUntraced(function* (command: string, args: ReadonlyArray<string>, stdin?: string) {
        const input = stdin === undefined ? "ignore" : Stream.make(new TextEncoder().encode(stdin))
        const handle = yield* spawner.spawn(ChildProcess.make(command, [...args], { stdin: input, stderr: "ignore" }))
        const stdout = yield* handle.stdout.pipe(Stream.decodeText(), Stream.mkString)
        const code = yield* handle.exitCode
        return { stdout, code: Number(code) }
      }, Effect.scoped)

      const run = Effect.fn("Shell.run")(function* (command: string, args: ReadonlyArray<string>, stdin?: string) {
        yield* Effect.annotateCurrentSpan({ command })
        const line = [command, ...args].join(" ")
        return yield* collect(command, args, stdin).pipe(
          Effect.timeout(RUN_TIMEOUT),
          Effect.mapError((error) => new ShellError({ command: line, message: error.message || String(error) }))
        )
      })

      return Shell.of({ run })
    })
  )
}

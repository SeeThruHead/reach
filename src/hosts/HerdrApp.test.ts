import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Config } from "../Config.ts"
import { Shell } from "../Shell.ts"
import { herdrApp } from "./HerdrApp.ts"

const terminal = (fields: Record<string, unknown>) => ({
  name: null,
  cwd: "/home/sth/code/x",
  state: "live",
  foreground: { argv: ["claude"] },
  ...fields
})

const reply = (terminals: ReadonlyArray<unknown>) => JSON.stringify({ result: { terminals } })

const fakeShell = (byMachine: Record<string, string>, sent: Array<ReadonlyArray<string>>) =>
  Layer.succeed(
    Shell,
    Shell.of({
      run: (_command, args) =>
        Effect.sync(() => {
          sent.push(args)
          if (args[0] === "machine")
            return { stdout: JSON.stringify({ machines: [{ name: "mac-mini", state: "connected" }] }), code: 0 }
          if (args[0] === "exec")
            return { stdout: byMachine[args[1] === "--on" ? (args[2] ?? "") : "here"] ?? "", code: 0 }
          return { stdout: "", code: 0 }
        })
    })
  )

const config = Layer.succeed(Config, Config.of({ machine: "sthdev", home: "/home/sth", pluginFolders: [] }))

const listWith = (byMachine: Record<string, string>, sent: Array<ReadonlyArray<string>> = []) =>
  Effect.gen(function* () {
    const host = yield* herdrApp
    return yield* host.list
  }).pipe(Effect.provide(Layer.mergeAll(fakeShell(byMachine, sent), config)))

describe("herdr-app host", () => {
  it.effect("uses pins when a terminal has them, and qualifies other machines", () =>
    Effect.gen(function* () {
      const agents = yield* listWith({
        here: reply([
          terminal({
            address: "t5f",
            name: "renamed",
            labels: {
              "herdr.space": "sp",
              "sth.agent": "chief-of-staff",
              "sth.space": "chief-of-staff",
              "sth.session": "s1"
            },
            status: { state: "done" }
          })
        ]),
        "mac-mini": reply([
          terminal({
            address: "t12",
            labels: { "herdr.space": "sp", "sth.agent": "reviewer", "sth.space": "review-desk" }
          })
        ])
      })
      expect(agents.map((a) => [a.address, a.id, a.state, a.status, a.pinned])).toEqual([
        ["sthdev/chief-of-staff/chief-of-staff", "t5f", "live", "idle", true],
        ["mac-mini/review-desk/reviewer", "mac-mini/t12", "live", "unknown", true]
      ])
      expect(agents[0]?.resume).toEqual(["claude", "--resume", "s1"])
    })
  )

  it.effect("guesses an address from the space and terminal name when there are no pins", () =>
    Effect.gen(function* () {
      const agents = yield* listWith({
        here: reply([
          terminal({ address: "t5", labels: { "herdr.space": "sp", where: "Pricing Card / 1", "sth.session": "s" } })
        ])
      })
      expect(agents.map((a) => [a.address, a.pinned])).toEqual([["sthdev/pricing-card/claude", false]])
    })
  )

  it.effect("tells asleep, quit-to-a-shell and finished apart, and skips plain shells and other apps' terminals", () =>
    Effect.gen(function* () {
      const agents = yield* listWith({
        here: reply([
          terminal({
            address: "t1",
            foreground: { argv: ["bash", "asleep.sh"] },
            labels: { "herdr.space": "sp", "sth.agent": "a", "sth.space": "s", "sth.sleep": "x" }
          }),
          terminal({
            address: "t2",
            foreground: { argv: ["/usr/bin/zsh"] },
            labels: { "herdr.space": "sp", "sth.agent": "b", "sth.space": "s", "sth.session": "y" }
          }),
          terminal({
            address: "t3",
            state: "finished",
            foreground: null,
            labels: { "herdr.space": "sp", "sth.agent": "c", "sth.space": "s", "sth.session": "z" }
          }),
          terminal({ address: "t4", foreground: { argv: ["zsh"] }, labels: { "herdr.space": "sp" } }),
          terminal({ address: "t5", labels: {} }),
          terminal({ address: "mac-mini/t9", labels: { "herdr.space": "sp", "sth.agent": "d", "sth.space": "s" } })
        ])
      })
      expect(agents.map((a) => [a.id, a.state])).toEqual([
        ["t1", "asleep"],
        ["t2", "ended"],
        ["t3", "ended"]
      ])
    })
  )
})

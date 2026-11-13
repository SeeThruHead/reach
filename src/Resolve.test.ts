import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { type Agent, addressOf } from "./Agent.ts"
import { parseTarget, pick } from "./Resolve.ts"

const agent = (
  space: string,
  name: string,
  state: Agent["state"],
  id: string,
  resume?: ReadonlyArray<string>
): Agent => ({
  address: addressOf("sthdev", space, name),
  machine: "sthdev",
  space,
  name,
  pinned: true,
  state,
  status: "idle",
  host: "herdr-app",
  id,
  cwd: "/w",
  ...(resume ? { resume } : {})
})

describe("parseTarget", () => {
  it.effect("reads a full address and fills this machine into space/name", () =>
    Effect.gen(function* () {
      expect(yield* parseTarget("mac-mini/review-desk/reviewer", "sthdev")).toBe("mac-mini/review-desk/reviewer")
      expect(yield* parseTarget("homelab/homelab", "sthdev")).toBe("sthdev/homelab/homelab")
    })
  )

  it.effect("refuses anything else", () =>
    Effect.gen(function* () {
      expect((yield* Effect.flip(parseTarget("homelab", "sthdev")))._tag).toBe("BadAddress")
      expect((yield* Effect.flip(parseTarget("Home Lab/x", "sthdev")))._tag).toBe("BadAddress")
      expect((yield* Effect.flip(parseTarget("a/b/c/d", "sthdev")))._tag).toBe("BadAddress")
    })
  )
})

describe("pick", () => {
  it.effect("finds the one running agent, ignoring ended terminals at the same address", () =>
    Effect.gen(function* () {
      const found = yield* pick("sthdev/cos/cos", [
        agent("cos", "cos", "ended", "t3g"),
        agent("cos", "cos", "live", "t5f")
      ])
      expect(found.id).toBe("t5f")
    })
  )

  it.effect("an asleep agent counts as reachable", () =>
    Effect.gen(function* () {
      expect((yield* pick("sthdev/m/m", [agent("m", "m", "asleep", "t49")])).state).toBe("asleep")
    })
  )

  it.effect("two running agents at one address is an error naming both, never a pick", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        pick("sthdev/d/d", [agent("d", "d", "live", "t1"), agent("d", "d", "live", "t2")])
      )
      expect(error._tag).toBe("Ambiguous")
      expect(error._tag === "Ambiguous" && error.candidates).toEqual(["herdr-app:t1 (/w)", "herdr-app:t2 (/w)"])
    })
  )

  it.effect("only ended agents: says so, with how to resume", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        pick("sthdev/c/c", [agent("c", "c", "ended", "t3g", ["claude", "--resume", "s"])])
      )
      expect(error._tag).toBe("Ended")
      expect(error._tag === "Ended" && error.resume).toEqual(["claude", "--resume", "s"])
    })
  )

  it.effect("no agent there: not found, even when a similar one exists", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(pick("sthdev/homelab/home", [agent("homelab", "homelab", "live", "t4k")]))
      expect(error._tag).toBe("NotFound")
    })
  )
})

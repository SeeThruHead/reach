# reach

A Bun and Effect v4 CLI (`effect/cli`), compiled to one binary with `bun build --compile`.

## Commands

- `bun run check`: format check, lint, typecheck, tests. Run it before every commit.
- `bun run dev -- <args>`: run from source. `bun run build`: `dist/reach`.
- Test against a separate herdr-core with `HC_SESSION=<name>` and `REACH_MACHINE=<name>`, never the live one.

## How it starts

`src/main.ts` defines the commands and provides `Directory.layer`, `Shell.layer` and `BunServices.layer`, then
runs once with `BunRuntime.runMain`. Errors print as one `reach: <message>` line.

## Architecture

- `Agent.ts`: the agent schema, addresses and the small pure helpers (slug, status mapping).
- `Resolve.ts`: pure resolution. `parseTarget` reads an address; `pick` returns the one running agent or a typed
  error (`BadAddress`, `NotFound`, `Ambiguous`, `Ended`). Never a closest match.
- `Host.ts`: the host contract (list, send, read, reopen), the same three calls as Review Desk's host plugins.
- `hosts/`: one file per host. Each builds its agents' addresses from pins, or guesses them.
- `Directory.ts`: the service. Lists every host concurrently (a host that fails is reported, not fatal) and
  resolves, sends, reads and reopens through the agent's own host.
- `Shell.ts`: the only module that runs programs; every run has a 30s timeout.

## Rules

- No registry. Answers come from the hosts each time.
- Ambiguity is an error everywhere.
- The JSON shapes `ls --json` and `resolve --json` print are public: only add fields.

## What reviewers check

Effect style per Shane's `effect.md` (services as `Context.Service`, `Effect.fn` names, typed errors), one level
of abstraction per function, and that host code goes through `Shell`.

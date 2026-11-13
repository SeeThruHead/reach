# reach

reach finds coding agents by a stable address and hands them messages. An address is `machine/space/name`,
for example `sthdev/homelab/homelab`: the machine the agent runs on, the space it works in, and its name in
that space. A space can hold several agents; names are unique within a space.

reach keeps no registry of its own. Each time it is asked, it asks the hosts agents run in and builds the
directory from what they report, so it always knows what is alive, asleep or ended right now.

```text
reach ls [--json]                      every agent: address, state, status, pinned or guessed, host, folder
reach resolve <address> [--json]       the one agent at that address, or why there isn't one
reach send <address> [message]         deliver a message (from stdin when left out)
reach read <address> [--lines 40]      the bottom of its screen
reach reopen <address>                 start an ended agent again with its own session
```

`space/name` means that space on this machine.

## How it resolves

- One running agent (live or asleep) at the address: that one. Sending to an asleep agent wakes it with the
  message, where the host supports that.
- More than one: an error that names every candidate. reach never picks.
- Only ended agents there: an error that says how to resume it (`reach reopen`).
- None: not found. There is no closest match.

`resolve --json` prints `{ "agent": {...} }`, or `{ "error": { "_tag": "NotFound" | "Ambiguous" | "Ended" | "BadAddress", "message": ... } }`
and exits 1. Other tools build on that.

## Where addresses come from

| Host                                                   | Pinned address                                           | Guessed when there is no pin                                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Herdr app (`hc`), this machine and every connected one | labels `sth.agent` and `sth.space` on the terminal       | space from the Herdr space name (else the folder), name from the terminal name (else the tab, else the agent program) |
| tmux                                                   | pane options `@agent` and `@space`                       | space from the session name, name from the window name                                                                |
| Plugins                                                | `address`, or `space` and `name`, in the plugin's `list` | space from the folder, name from the plugin                                                                           |

`reach ls` marks each address `pinned` or `guessed`. Guessed addresses work, and two agents that guess the same
address are refused rather than mixed up. Pin them to make them stable: in the Herdr app the Threads mod pins
every agent when it first sees it, and keeps the pin by session id when the agent comes back in a new terminal.
In tmux, `tmux set -p @agent reviewer; tmux set -p @space api`.

## Plugins

A plugin is an executable that speaks Review Desk's host contract, so the same plugin works for both tools:

- `list` prints `{ "agents": [{ "id", "cwd", "status"?, "name"?, "space"?, "address"? }] }`.
- `send <id>` reads the message on stdin and submits it.
- `read <id> <lines>` prints the bottom of the screen.

reach loads them from `~/.config/reach/plugins/` and `~/.review-desk/plugins/`. The file name without its
extension is the host name.

## Configure

`~/.config/reach/config.json` (or `$REACH_HOME/config.json`), all optional:

```json
{ "machine": "mac-mini", "plugins": ["/path/to/plugins"] }
```

`machine` is this machine's name in addresses; it defaults to the short host name, lowercased. Use the name the
Herdr app's other machines know it by (`hc machine ls` there), so an address reads the same from every machine.
`REACH_MACHINE` overrides it for one run.

## Install

```sh
brew install seethruhead/tap/reach
```

Or `bun install && bun run build`, which writes `dist/reach`.

## License

MIT

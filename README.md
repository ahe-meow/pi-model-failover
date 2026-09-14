# pi-model-failover

Batch provider management and ordered failover chains for the [Pi coding agent](https://github.com/badlogic/pi-mono).

`pi-model-failover` lets one Pi model use several providers and API keys without changing the requester's model name. Targets are tried in order; temporary failures cool down, revoked credentials enter manual recovery, and the next healthy target takes over.

## Requirements

- Pi `0.85.x` (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `@earendil-works/pi-tui` `^0.85.1`)
- Node.js 20 or newer

## Install

Install the published package with Pi:

```sh
pi install pi-model-failover
```

For a local checkout during development:

```sh
pi install /path/to/pi-model-failover
```

Open the TUI with `/failover`. The command is intentionally TUI-only; invoking it from another Pi mode shows a warning and does not mutate state.

## `/failover` tour

The command opens four tabs:

| Tab | What it does |
| --- | --- |
| **Model Manager** | Add or edit providers, paste API keys in batches, import catalog models, and sync attributes. |
| **Chains** | Create ordered Chains, edit Target settings, add individual Targets, or use Same-Model Import. Each Chain appears to Pi as `failover/<chain-id>`. |
| **History** | Review newest-first failover events, filter by Chain or provider, inspect event JSON, reset a Target, and refresh the JSONL log. |
| **Settings** | Set global retry/TTFT/no-progress defaults and reset every Target's cooldown or manual recovery state. |

Typical flow:

1. Add providers in **Model Manager** or paste a key group.
2. Create a Chain, choose its model, and order the Targets with `J`/`K`.
3. Select `failover/<chain-id>` from Pi's normal model picker.
4. Inspect failures in **History**; use `r` to reset a recovered Target after fixing its credentials.

The Chain detail view shows the effective context window, reasoning support, input types, retry mode, TTFT settings, and current Target status (`ok`, `cool`, or `manual`).

## Failover behavior

- HTTP 5xx, network errors, TTFT timeouts, and no-progress timeouts can move the request to the next Target.
- HTTP 401-style persistent failures enter **Manual Recovery** and stay excluded until reset.
- Cooldowns use the capped ladder `1 / 5 / 15 / 60` minutes.
- A request-parameter rejection can retry once without the rejected parameter and does not raise a cooldown.
- `ttftAction: cooldown-only` lets the current request finish; `ttftAction: abort` cancels the attempt and switches during the same request.

> **Billing warning:** Aborting still bills the prompt tokens of the aborted request on most providers/relays.

## Coexistence with Pi

The extension uses Pi's existing `models.json` provider format and registration APIs. It adds only its own managed provider nodes and the reserved `failover` Virtual Models. Pi's built-in providers and the existing Model Manager continue to work normally.

Provider deletion removes the selected provider node, removes its Targets from affected Chains, and refreshes the affected Virtual Models. The extension does not migrate V1 configuration or rewrite unrelated `models.json` fields.

## Files and permissions

Extension data is stored under:

```text
~/.pi/agent/pi-model-failover/
├── config.json       # global settings, catalog, key groups, and Chains
├── state.json        # cooldown and Manual Recovery state
└── history.jsonl     # newest failover events, capped at 500
```

The directory is created with mode `0700`; managed files are written atomically with mode `0600`. Pi's provider credentials remain in the existing `~/.pi/agent/models.json` because that is Pi's provider storage contract.

If `state.json` is corrupt or newer than this release understands, the extension preserves it, switches to in-memory state, and shows one notification. The rest of the TUI remains usable until the file is repaired.

## Secret handling

API keys are accepted where Pi expects them and are never shown raw in the TUI, History, notifications, user-facing errors, or logs. Displayed secrets use the form `sk-…abcd` (first three characters, an ellipsis, and the last four). Header values with key/token/auth names use the same redaction rule.

Do not commit `models.json`, `config.json`, `state.json`, or `history.jsonl` when they contain personal credentials or provider data.

## Development checks

```sh
npm run check
npm pack --dry-run
npm publish --dry-run
```

Publishing is a user action; the dry-run commands do not publish a package.

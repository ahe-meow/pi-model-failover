# pi-model-failover

Batch provider management and ordered failover chains for the [Pi coding agent](https://github.com/badlogic/pi-mono).

`pi-model-failover` lets one Pi model use several providers and API keys without changing the requester's model name. Managed provider names are normalized for safe IDs, while existing provider names may fall back to their Provider ID when left blank. Targets are tried in order; temporary failures cool down, revoked credentials enter manual recovery, and the next healthy target takes over.

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
| **Model Manager** | Add or edit providers, normalize provider names, paste API keys in batches, import catalog models, and sync attributes. |
| **Chains** | Create ordered Chains, edit Target settings, add individual Targets, or use Same-Model Import. Each Chain appears to Pi as `failover/<chain-id>`. |
| **History** | Review newest-first failover events, filter by Chain or provider, inspect event JSON, reset a Target, and refresh the JSONL log. |
| **Settings** | Set global Server Quality switches and timeout defaults, then reset every Target's cooldown or manual recovery state. |

Typical flow:

1. Add providers in **Model Manager** or paste a key group.
2. Create a Chain, choose its model, and order the Targets with `J`/`K`.
3. In Model Manager detail, press `p` to use the highlighted provider model; in Chains list or detail, press `p` to use that Chain.
4. Select `failover/<chain-id>` from Pi's normal model picker.
5. Inspect failures in **History**; press `r` there to reset a recovered Target after fixing its credentials. In the Chains list, `r` resets the selected Chain (`R` is an alternate binding); in Chain detail, `r` resets the selected Target.

The Chain detail view lists each Target's number, `provider/modelId`, cost multiplier, and current status (`ok`, `cool`, or `manual`); retry mode, timeout values, Server Quality overrides, and per-target `reasoningEffort` live in the Target settings form opened with `Enter`.

The Key Group editor keeps one API key entry per row. `Up`/`Down` navigates between rows, `Enter` commits the current row, `Ctrl+U` clears the selected row, `Ctrl+S` saves the edited rows and returns to the batch form, and `Esc` returns to the form. Submit the batch from the form with `Ctrl+S`. Blank rows are available while editing and are omitted from the saved group. A successful Key Group save uses informational feedback and requests an immediate TUI redraw. Provider, Catalog, Chain, and Settings saves also request a redraw after persistence.

Provider add derives the Provider ID from the normalized Name. Runs of whitespace or other illegal name characters become one `-`; when editing an existing provider, an empty display Name falls back to its existing Provider ID. The Provider ID field itself remains strictly validated when it is edited.

## Failover behavior

- HTTP 5xx, network errors, TTFT timeouts, and no-progress timeouts can move the request to the next Target.
- HTTP 401-style persistent failures enter **Manual Recovery**, stay excluded until reset, and still record their real reason (`http-401`, `http-402`, `http-403`, `http-404`, or quota/billing `http-429`).
- **History** shows the real HTTP reason plus the provider's structured error detail (`status`, `code`, and response `body`) when recorded; sensitive body content is redacted before it is written or displayed.
- After every Target is exhausted, the failover error identifies the Chain name and ID, final Target, status, and reason. The user-facing error does not include credentials or a raw response body.
- Cooldowns use the capped ladder `1 / 5 / 15 / 60` minutes.
- A request-parameter rejection can retry once without the rejected parameter and does not raise a cooldown.
- Server Quality has global `serverQuality: { enabled, ttft, noProgress }` switches and optional per-Target `inherit`/`on`/`off` overrides. Disabled signals do not start timers; requests continue until the provider or Pi aborts.
- The effective Server Quality policy is snapshotted when a request starts. Timer failures classify as `server-quality` while retaining `ttft-timeout` or `no-progress` as their History reason.
- In `retry` mode, and for Server Quality failures in `smart` mode, timer failures share the Target's `maxRetries` and backoff budget. `switch` advances immediately. Cooldown state and History are written only when the shared retry budget is exhausted (or immediately in `switch` mode).

## Coexistence with Pi

The extension uses Pi's existing `models.json` provider format and registration APIs. It adds only its own managed provider nodes and the reserved `failover` Virtual Models. Pi's built-in providers and the existing Model Manager continue to work normally.

Provider deletion removes the selected provider node, removes its Targets from affected Chains, and refreshes the affected Virtual Models. Renaming a provider ID moves the `models.json` key, rewrites matching Chain Targets, and carries the Target's cooldown and Manual Recovery state to the new ID; past History rows keep the ID they were recorded with. Configuration is version 2. Loading a v1 file removes the legacy global and Target `ttftAction` fields, supplies the v2 Server Quality defaults, and preserves unknown data; new Target overrides remain optional so omitted fields inherit global settings. When an endpoint import returns to Catalog, its imported models stay selected even if the active Catalog filter hides those rows.

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

# Remnic CLI and Pi Connector Usage

## Confirmed installation model

Remnic is installed and managed outside this repository:

- CLI: `/usr/local/lib/node_modules/@remnic/cli`, version `9.69.56`.
- Pi plugin dependency: `@remnic/plugin-pi`, version `9.69.56`.
- Daemon: background HTTP/MCP server on `http://127.0.0.1:4318`.
- Pi connector: generated bridge at `~/.pi/agent/extensions/remnic/index.ts`.
- The generated bridge imports `createRemnicPiExtension` from the globally installed plugin and points it at the private connector config.

This is not a project-local dependency and should not be added to this repository's `package.json`. The CLI owns the daemon, connector config, token, and generated bridge. Pi loads the generated bridge only so Remnic can attach to Pi hooks and expose tools.

## Safe lifecycle and health commands

```bash
remnic daemon start
remnic daemon status
remnic status --json
remnic connectors doctor pi
remnic connectors list
```

The current read-only checks showed:

- daemon running on port `4318`;
- Pi connector config valid;
- Pi connector publisher healthy;
- generated extension present at `~/.pi/agent/extensions/remnic`.

`remnic connectors status` is for external source connectors such as Google Drive and Notion. It does not report the Pi bridge; use `remnic connectors doctor pi` for the Pi bridge.

Mutating lifecycle commands require deliberate use:

```bash
remnic daemon stop
remnic daemon restart
remnic connectors install pi
remnic connectors remove pi
remnic token generate pi
```

Do not run these during repository work unless the user asks. The connector config contains an auth token and is owner-only (`0600`); do not read or print it.

## How memory reaches Pi

The Pi bridge is a thin connector over the daemon. According to the installed `@remnic/plugin-pi` documentation and type declarations, it can:

1. recall relevant context in Pi's `before_agent_start`/context path;
2. observe Pi user, assistant, and tool messages;
3. register daemon-backed Remnic MCP tools when authentication is configured;
4. coordinate LCM flush/checkpoint operations around Pi compaction;
5. persist small dedupe state through Pi custom entries.

The connector's generated slash commands are:

```text
/remnic-status
/remnic-recall <query>
/remnic-remember <memory>
/remnic-lcm-search <query>
/remnic-why
/remnic-compact
```

The daemon-side CLI provides explicit read/search operations such as:

```bash
remnic status --json
remnic query "topic" --explain
remnic xray "topic" --format text
remnic doctor
```

Use CLI commands for daemon/operator inspection. Use the Pi connector's automatic recall, slash commands, or registered `remnic_*` MCP tools during coding sessions. Do not read the private connector config directly.

## Separate local project-memory layer

`pi-smart-compact` is also enabled in Pi settings. It is separate from Remnic:

- `smart_recall` / `smart_save_memory` use its project-scoped SQLite FTS5 context graph;
- Remnic uses the daemon-backed memory namespace and connector protocol;
- neither should be treated as a dependency of `pi-model-failover`.

For this repository, use project-scoped smart memory for durable coding decisions only after user confirmation. Use Remnic for daemon-backed user/session memory when its tools are available.

## Primary sources

- `/usr/local/lib/node_modules/@remnic/cli/README.md`
- `/usr/local/lib/node_modules/@remnic/cli/package.json`
- `/usr/local/lib/node_modules/@remnic/cli/node_modules/@remnic/plugin-pi/README.md`
- `/usr/local/lib/node_modules/@remnic/cli/node_modules/@remnic/plugin-pi/dist/index.d.ts`
- `/root/.pi/agent/extensions/remnic/README.md`
- `/root/.pi/agent/extensions/remnic/index.ts`
- `remnic --help`
- `remnic connectors --help`
- `remnic daemon status`
- `remnic connectors doctor pi`

## Unknowns

The private connector config was intentionally not read, so its exact namespace and token were not exposed. The daemon reported no optional memory extensions; this does not prevent the core daemon and Pi connector from operating.

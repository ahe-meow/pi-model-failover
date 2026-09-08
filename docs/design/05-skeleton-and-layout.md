# 05 Skeleton and layout

Created in P0 (`docs/design/07-plan.md`). Modules: `docs/design/03-components.md`. Constraints: `docs/design/01-constraints.md`.

## Directory tree

```text
.
├── AGENTS.md
├── CONTEXT.md
├── LICENSE                     MIT
├── README.md                   written in P4
├── package.json
├── tsconfig.json
├── biome.json
├── vitest.config.ts
├── .gitignore
├── .scratch/                   task markdown per phase (docs/agents/issue-tracker.md)
│   ├── README.md
│   └── p0-shell/
├── docs/
│   ├── adr/
│   ├── agents/
│   └── design/
├── src/
│   ├── index.ts                wiring only
│   ├── strings.ts              every user-visible string
│   ├── config/
│   │   ├── writeQueue.ts
│   │   ├── jsonStore.ts
│   │   ├── configStore.ts
│   │   ├── sharedState.ts
│   │   └── migrations.ts
│   ├── domain/
│   │   ├── types.ts
│   │   ├── ports.ts
│   │   ├── redact.ts
│   │   ├── catalog.ts
│   │   ├── providers.ts
│   │   ├── keyGroups.ts
│   │   ├── chains.ts
│   │   ├── failureClass.ts
│   │   ├── cooldown.ts
│   │   └── engine.ts
│   ├── adapters/
│   │   ├── nodeFs.ts           FileSystem + Clock over node:fs / timers
│   │   ├── modelsJson.ts
│   │   ├── registrar.ts
│   │   ├── failoverProvider.ts
│   │   └── catalogImporters.ts
│   ├── history/
│   │   └── historyLog.ts
│   └── tui/
│       ├── app.ts
│       ├── primitives/
│       │   ├── tabBar.ts
│       │   ├── scrollList.ts
│       │   ├── keyHints.ts
│       │   ├── helpOverlay.ts
│       │   ├── form.ts
│       │   ├── multiSelectList.ts
│       │   └── confirm.ts
│       └── tabs/
│           ├── modelManager.ts   (+ modelManager/*.ts when split)
│           ├── chains.ts
│           ├── history.ts
│           └── settings.ts
└── test/
    ├── fakes/
    │   ├── memoryFs.ts         FileSystem fake with mode tracking
    │   ├── fakeClock.ts
    │   └── fakePi.ts           registerProvider/unregisterProvider/on/registerCommand recorder
    ├── fixtures/
    │   └── models.pmm-and-unknown.json
    ├── config/                 mirrors src/config
    ├── domain/
    ├── adapters/
    ├── history/
    ├── tui/
    └── strings.spec.ts         no hard-coded UI strings outside src/strings.ts
```

Each `test/<layer>/<module>.spec.ts` mirrors `src/<layer>/<module>.ts`. Phases add files in this tree only; a new module gets its `03-components.md` section in the same change.

## package.json (P0)

```json
{
  "name": "pi-model-failover",
  "version": "2.0.0-alpha.0",
  "description": "Batch provider management and model failover chains for the Pi coding agent",
  "license": "MIT",
  "type": "module",
  "main": "./src/index.ts",
  "files": ["src", "README.md", "LICENSE"],
  "keywords": ["pi", "pi-extension", "failover", "models"],
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "biome check .",
    "format": "biome format --write .",
    "check": "npm run typecheck && npm run lint && npm test",
    "dev": "pi -e ./src/index.ts"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.12",
    "@types/node": "^22",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "typescript": "^5",
    "vitest": "^3"
  }
}
```

Pi loads extensions as TypeScript source (`pi -e ./src/index.ts`, and packages install the same way), so `main` points at `src/index.ts` and there is no build step. The `*` peer ranges are pinned to the installed Pi major in P4 before publishing.

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true,
    "noEmit": true, "skipLibCheck": true, "types": ["node"]
  },
  "include": ["src", "test"]
}
```

## biome.json

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.12/schema.json",
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "rules": { "preset": "recommended", "suspicious": { "noExplicitAny": "error" } } },
  "javascript": { "formatter": { "quoteStyle": "double", "semicolons": "always" } },
  "files": { "includes": ["**", "!!node_modules", "!!.scratch", "!!.atl", "!!.pi", "!!openspec"] }
}
```

## vitest.config.ts

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["test/**/*.spec.ts"], environment: "node", clearMocks: true },
});
```

## .gitignore

The existing file keeps its `.atl/` line (local Pi runtime state). P0 appends:

```text
node_modules/
*.tgz
.vitest/
coverage/
*.log
```

`.pi/` and `openspec/` are session tooling already present in the working tree; whether they are committed is the parent's call, not P0's.

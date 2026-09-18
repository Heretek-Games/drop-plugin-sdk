# AGENTS.md — Drop Plugin SDK contributor & AI agent guide

**Drop Plugin SDK** (`drop-plugin-sdk`) provides the developer toolchain, public TypeScript types, testing harnesses, and verification CLI for the Drop plugin system.

---

## 1. Architecture

- **`packages/plugin-sdk/`**: Contains `@drop-oss/plugin-sdk`.
  - `src/types.ts`: Pure TypeScript types matching Drop server's plugin manager contract and desktop client runtime (`PLUGIN_API_VERSION = 3`), including the `RunnerProvider` (`game:runner`), `AuthProvider` (`auth:provider`), `DepotStorageProvider` (`storage:depot`), `settingsSchema`, and `PluginContext.settings` contracts.
  - `src/mock.ts`: `MockPluginContext` & `MockPluginStorage` for server plugin testing.
  - `src/client-mock.ts`: `MockClientPluginContext`, `MockScopedGameFs`, and `MockScopedGameScanner` for desktop client testing.
  - `src/conformance.ts`: Manifest capability conformance helpers, generic over `PluginCapability`.
- **`packages/plugin-cli/`**: Contains `@drop-oss/plugin-cli`.
  - `bin/drop-plugin.js`: Executable CLI (`drop-plugin`) providing `init`, `dev`, `sign`, `pack`, `build`, `validate`, and `test`.
  - `src/builder.ts`: `esbuild` bundler with `unplugin-vue` SFC compilation, scoped-CSS extraction, a `globalThis.Vue` runtime shim, and watch mode.
  - `src/devServer.ts`: `drop-plugin dev` watch build + CORS static server for live Drop Desktop loading.
  - `src/scaffolder.ts`: `init` with `--template` (`starter | client-ui | metadata | store | runner | fullstack`).
  - `src/signer.ts`: Cryptographic signer computing SHA-256 digests of all files and packaging into `.dropplugin` archives.
- **`templates/`**: `starter-plugin` (golden full-stack sample, with `.sdk-scope.json`, scope switch script, and release workflow) plus SPI-specific `template-client-ui`, `template-metadata`, `template-store`, `template-runner`, and `template-fullstack` scaffolds.

---

## 2. Invariants

- **`PLUGIN_API_VERSION` compatibility**: Keep `PLUGIN_API_VERSION = 3` in sync with Drop core (`SUPPORTED_API_VERSIONS = [1, 2, 3]`). Pre-1.0 breaking contract changes land in a minor release.
- **Capability Gating**: Ensure `MockPluginContext` and `MockClientPluginContext` enforce capability checks.
- **Confinement in Signer**: `signer.ts` must always prevent path traversal (`..` or symlink escapes).

---

## 3. Development Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm run build

# Run unit tests
pnpm run test

# Publish dry-run
pnpm run publish:dry-run

# Publish legacy @droposs/* mirror packages (same version line; used by the v* publish workflow)
node scripts/publish-legacy-scope.mjs --dry-run

# Local publish (requires authenticated npm login)
pnpm run publish:local
```

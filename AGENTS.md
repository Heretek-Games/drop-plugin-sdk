# AGENTS.md — Drop Plugin SDK contributor & AI agent guide

**Drop Plugin SDK** (`drop-plugin-sdk`) provides the developer toolchain, public TypeScript types, testing harnesses, and verification CLI for the Drop plugin system.

---

## 1. Architecture

- **`packages/plugin-sdk/`**: Contains `@drop-oss/plugin-sdk`.
  - `src/types.ts`: Pure TypeScript types matching Drop server's plugin manager contract and desktop client runtime (`PLUGIN_API_VERSION = 2`).
  - `src/mock.ts`: `MockPluginContext` & `MockPluginStorage` for server plugin testing.
  - `src/client-mock.ts`: `MockClientPluginContext`, `MockScopedGameFs`, and `MockScopedGameScanner` for desktop client testing.
- **`packages/plugin-cli/`**: Contains `@drop-oss/plugin-cli`.
  - `bin/drop-plugin.js`: Executable CLI (`drop-plugin`) providing `sign`, `pack`, `build`, and `test`.
  - `src/signer.ts`: Cryptographic signer computing SHA-256 digests of all files and packaging into `.dropplugin` archives.
- **`templates/starter-plugin/`**: Golden sample plugin with server and client entry points.

---

## 2. Invariants

- **`PLUGIN_API_VERSION` compatibility**: Always keep `PLUGIN_API_VERSION = 2` in sync with Drop core. Bumping the version requires major semver bump.
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

# Local publish (requires authenticated npm login)
pnpm run publish:local
```

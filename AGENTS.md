# AGENTS.md — Drop Plugin SDK contributor & AI agent guide

**Drop Plugin SDK** (`drop-plugin-sdk`) provides the developer toolchain, public TypeScript types, and verification CLI for the Drop plugin system.

---

## 1. Architecture

- **`packages/plugin-sdk/`**: Contains `@drop/plugin-sdk`.
  - `src/types.ts`: Pure TypeScript types matching Drop server's plugin manager contract (`PLUGIN_API_VERSION = 1`).
  - `src/mock.ts`: `MockPluginContext` & `MockPluginStorage` for running unit tests completely decoupled from Nuxt/Nitro.
- **`packages/plugin-cli/`**: Contains `@drop/plugin-cli`.
  - `bin/drop-plugin.js`: Executable CLI providing `sign`, `build`, and `test`.
  - `src/signer.ts`: Cryptographic signer computing SHA-256 digests of all files and HMAC-SHA256 signature when `DROP_PLUGIN_SIGNING_KEY` is present.
- **`templates/starter-plugin/`**: Golden sample plugin.

---

## 2. Invariants

- **`PLUGIN_API_VERSION` compatibility**: Always keep `PLUGIN_API_VERSION = 1` in sync with Drop core. Bumping the version requires major semver bump.
- **Capability Gating**: Ensure `MockPluginContext` enforces capability checks (e.g. attempting to register a route without `routes` throws an error).
- **Confinement in Signer**: `signer.ts` must always prevent path traversal (`..` or symlink escapes).

---

## 3. Development Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run unit tests
pnpm test
```

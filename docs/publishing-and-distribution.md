# Packaging, Signing & Distribution Guide

This guide covers preparing, packaging, cryptographically signing, and distributing your Drop plugins via GitHub Releases, remote HTTP registries, and direct bundle uploads.

---

## 1. Automated Packaging (`drop-plugin pack`)

To produce a single, portable distribution archive ready for installation into Drop:

```bash
# 1. Build and compile TypeScript source to ESM
npx drop-plugin build .

# 2. Package into a .dropplugin archive
npx drop-plugin pack . ./dist-package
```

The resulting file `dist-package/<plugin-id>-<version>.dropplugin` contains:

- The verified `drop-plugin.json` manifest.
- Base64-encoded bundles for server and client targets.
- SHA-256 digests for all files.
- Packing metadata and timestamp.

---

## 2. Cryptographic Signing (`drop-plugin sign`)

When Drop instances enforce strict supply chain validation (`DROP_PLUGIN_REQUIRE_SIGNATURE=true`), bundles must include an HMAC-SHA256 signature generated with an administrator-authorized key.

```bash
# Sign the bundle in-place
export DROP_PLUGIN_SIGNING_KEY="your-secret-key"
npx drop-plugin sign .
```

The CLI:

1. Computes the individual SHA-256 digest of every bundle file.
2. Orders files deterministically and builds an aggregate digest stream.
3. Computes the HMAC-SHA256 signature over the aggregate digest.
4. Writes the signature and file digests back into `drop-plugin.json`.

---

## 3. Automated CI/CD with GitHub Actions

You can automate building, testing, signing, and releasing `.dropplugin` packages on every Git tag release.

Use `templates/release-action.yml` as the canonical per-repository release workflow: it installs dependencies (`npm ci` when a lockfile exists, `npm install` otherwise), builds, tests, validates the manifest, packs the archive, attaches a `.sha256` checksum, and publishes a prerelease automatically for tags like `v1.0.0-rc.1`. Every scaffolded template under `templates/` ships a copy of this workflow, a matching `ci.yml`, a `typecheck` script, and a `.sdk-scope.json` + `scripts/switch-sdk-scope.mjs` pair, so a freshly scaffolded repo can tag `v1.0.0` and release without manual edits.


---

## 4. Community Registry Index (`registry.json`)

Inspired by Stash Community Scripts and Playnite Addons, Drop servers can subscribe to a remote community registry URL (`DROP_PLUGIN_REGISTRY=https://.../registry.json`).

### Registry Schema

```json
{
  "name": "Community Drop Plugins",
  "url": "https://raw.githubusercontent.com/example/community-plugins/main/registry.json",
  "plugins": [
    {
      "id": "drop-gse",
      "name": "Drop GSE Multiplayer",
      "version": "0.3.0",
      "description": "Multiplayer rooms over virtual mesh VPNs",
      "author": "Heretek Games",
      "checksum": "ef5a794af074807c3d94c4c7b8b463d5905e3f43edc6e3461d48cd440804900d",
      "downloadUrl": "https://github.com/Heretek-Games/drop-gse/releases/download/v0.3.0/drop-gse-0.3.0.dropplugin"
    }
  ]
}
```

When a Drop server has a registry configured:

1. Administrators can install plugins by URL with 1-click.
2. Drop queries the registry periodically or on demand via `GET /api/v1/plugins/updates`.
3. If an update is detected, Drop highlights it in the Web Admin settings and allows 1-click upgrades.

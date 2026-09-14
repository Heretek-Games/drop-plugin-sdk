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

Create `.github/workflows/release.yml`:

```yaml
name: Release Drop Plugin

on:
  push:
    tags:
      - "v*"

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install pnpm
        uses: pnpm/action-setup@v4

      - name: Install dependencies
        run: pnpm install

      - name: Run test suite
        run: npx @droposs/plugin-cli test .

      - name: Build bundles
        run: npx @droposs/plugin-cli build .

      - name: Package plugin archive
        run: npx @droposs/plugin-cli pack . ./dist-package

      - name: Compute SHA-256 Checksum
        id: checksum
        run: |
          PACKAGE_FILE=$(ls dist-package/*.dropplugin)
          echo "file=$PACKAGE_FILE" >> $GITHUB_OUTPUT
          sha256sum "$PACKAGE_FILE" > "$PACKAGE_FILE.sha256"

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            ${{ steps.checksum.outputs.file }}
            ${{ steps.checksum.outputs.file }}.sha256
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

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

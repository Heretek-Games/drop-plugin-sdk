import type {
  ClientCapability,
  PluginCapability,
  PluginManifest,
  ServerCapability,
} from "./types.js";

/**
 * Manifest conformance helpers.
 *
 * Drop's `PluginManager` replaces a plugin's class metadata with the shipped
 * `drop-plugin.json` before registering it, so the manifest is the authoritative
 * capability source at runtime. A capability the code requires but the manifest
 * omits therefore fails closed at init. These helpers let a plugin's own test
 * suite assert that the shipped manifest actually grants what the code uses,
 * resolving capabilities per target exactly as the server and desktop runtimes
 * do (see `getManifestCapabilities`).
 */

export interface CapabilityComparison {
  /** Capabilities required by the code but absent from the manifest. */
  missing: PluginCapability[];
  /** Capabilities declared in the manifest but not required by the code. */
  extra: PluginCapability[];
}

export interface RequiredCapabilities {
  server?: readonly ServerCapability[];
  client?: readonly ClientCapability[];
}

/**
 * Capabilities a manifest grants for a target, mirroring Drop's runtime
 * resolution per target:
 *
 * - `"server"`: the top-level `capabilities` array only. Drop's
 *   `PluginManager` builds the plugin context from `metadata.capabilities`
 *   (`drop/server/server/internal/plugins/manager.ts`), so a capability
 *   declared only under `server.capabilities` fails closed at runtime.
 * - `"client"`: `client.capabilities` when it is present as an array (even an
 *   empty one), otherwise the top-level `capabilities` array. The desktop host
 *   applies this fallback in `drop/desktop/main/plugins/09.client-plugins.ts`
 *   and never unions the two lists.
 */
export function getManifestCapabilities(
  manifest: Pick<PluginManifest, "capabilities" | "server" | "client">,
  target: "server" | "client",
): PluginCapability[] {
  const topLevel = manifest.capabilities ?? [];
  if (target === "server") {
    return [...topLevel];
  }
  const scoped = manifest.client?.capabilities;
  return Array.isArray(scoped) ? [...scoped] : [...topLevel];
}

export function compareCapabilities(
  required: readonly PluginCapability[],
  declared: readonly PluginCapability[],
): CapabilityComparison {
  const requiredSet = new Set(required);
  const declaredSet = new Set(declared);
  return {
    missing: required.filter((cap) => !declaredSet.has(cap)),
    extra: declared.filter((cap) => !requiredSet.has(cap)),
  };
}

/**
 * Validate that a shipped manifest grants every capability the plugin code
 * requires. Throws a descriptive error naming the missing (and, unless
 * `allowExtra` is set, the unused) capabilities.
 */
export function assertManifestSupports(
  manifest: Pick<PluginManifest, "id" | "capabilities" | "server" | "client">,
  required: RequiredCapabilities,
  options: { allowExtra?: boolean } = {},
): void {
  const problems: string[] = [];

  for (const target of ["server", "client"] as const) {
    const needed = required[target];
    if (!needed) continue;
    const declared = getManifestCapabilities(manifest, target);
    const { missing, extra } = compareCapabilities(needed, declared);
    if (missing.length > 0) {
      problems.push(
        `${target}: manifest is missing required ${missing.join(", ")}`,
      );
    }
    if (!options.allowExtra && extra.length > 0) {
      problems.push(
        `${target}: manifest declares unused ${extra.join(", ")}`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Plugin manifest '${manifest.id ?? "<unknown>"}' failed capability conformance: ${problems.join("; ")}`,
    );
  }
}

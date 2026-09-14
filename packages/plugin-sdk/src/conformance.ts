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
 * suite assert that the shipped manifest actually grants what the code uses.
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
 * Capabilities a manifest declares for a target. Drop reads server capabilities
 * from the top-level `capabilities` array and client capabilities from
 * `client.capabilities`; both are accepted here so v1 and v2 manifests work.
 */
export function getManifestCapabilities(
  manifest: Pick<PluginManifest, "capabilities" | "server" | "client">,
  target: "server" | "client",
): PluginCapability[] {
  const topLevel = manifest.capabilities ?? [];
  const scoped =
    target === "server"
      ? (manifest.server?.capabilities ?? [])
      : (manifest.client?.capabilities ?? []);
  return Array.from(new Set<PluginCapability>([...topLevel, ...scoped]));
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

import * as esbuild from "esbuild";
import path from "node:path";
import { readFile, writeFile, stat } from "node:fs/promises";
import vue from "unplugin-vue/esbuild";
import { signPlugin } from "./signer.js";

export interface BuildOptions {
  minify?: boolean;
  sourcemap?: boolean;
  sign?: boolean;
  signingKey?: string;
  /** Write derived manifest fields here instead of the source manifest. */
  outManifest?: string;
  /** Watch for changes and rebuild incrementally. */
  watch?: boolean;
  /** Callback invoked on incremental rebuild completion (in watch mode). */
  onRebuild?: (result: { error?: Error }) => void;
}

export interface BuildResult {
  serverBuilt: boolean;
  clientBuilt: boolean;
  contexts?: esbuild.BuildContext[];
}

/**
 * Global shim so bundled Vue SFCs and imports from "vue" resolve to globalThis.Vue (set by Drop Desktop)
 * at runtime without requiring browser import maps.
 */
const vueGlobalShimPlugin: esbuild.Plugin = {
  name: "vue-global-shim",
  setup(build) {
    build.onResolve({ filter: /^vue$/ }, () => {
      return { path: "virtual:vue", namespace: "vue-shim" };
    });
    build.onLoad({ filter: /.*/, namespace: "vue-shim" }, () => {
      return {
        contents: `
          const v = globalThis.Vue || (typeof window !== "undefined" ? window.Vue : {});
          export default v;
          export const {
            ref, reactive, computed, watch, watchEffect,
            onMounted, onUnmounted, onUpdated, onBeforeMount, onBeforeUnmount,
            h, defineComponent, nextTick, shallowRef, shallowReactive,
            toRef, toRefs, isRef, isReactive, unref,
            openBlock, createElementBlock, createBlock, createVNode, createCommentVNode,
            createTextVNode, createElementVNode, toDisplayString, withDirectives,
            vShow, vModelText, vModelCheckbox, vModelRadio, vModelSelect,
            Fragment, Static, Comment, Text, Teleport, Suspense, KeepAlive,
            renderSlot, resolveComponent, resolveDirective, normalizeClass, normalizeStyle,
            withCtx, withModifiers, withKeys, renderList, pushScopeId, popScopeId
          } = new Proxy(v, {
            get: (target, prop) => {
              const root = globalThis.Vue || (typeof window !== "undefined" ? window.Vue : undefined);
              return root ? root[prop] : target[prop];
            }
          });
        `,
        loader: "js",
      };
    });
  },
};

export async function buildPlugin(
  targetDir = ".",
  options: BuildOptions = {},
): Promise<BuildResult> {
  const dir = path.resolve(process.cwd(), targetDir);
  const manifestPath = path.join(dir, "drop-plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

  let serverBuilt = false;
  let clientBuilt = false;
  const contexts: esbuild.BuildContext[] = [];

  // 1. Build Server Entry if source exists
  const serverSourceCandidates = [
    manifest.server?.source,
    "src/index.ts",
    "src/index.js",
    "src/server.ts",
  ].filter(Boolean);

  let serverEntrySource: string | null = null;
  for (const candidate of serverSourceCandidates) {
    const p = path.join(dir, candidate);
    if (await stat(p).catch(() => null)) {
      serverEntrySource = p;
      break;
    }
  }

  const serverOutFile = path.resolve(
    dir,
    manifest.server?.entry ?? manifest.entry ?? "dist/src/index.js",
  );

  if (serverEntrySource) {
    const serverConfig: esbuild.BuildOptions = {
      entryPoints: [serverEntrySource],
      outfile: serverOutFile,
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      sourcemap: options.sourcemap ?? true,
      minify: options.minify ?? false,
      external: [
        "@drop-oss/plugin-sdk",
        "@droposs/plugin-sdk",
        "@drop/plugin-sdk",
        "h3",
        "pino",
      ],
    };

    if (options.watch) {
      const serverCtx = await esbuild.context(serverConfig);
      await serverCtx.watch();
      contexts.push(serverCtx);
    } else {
      await esbuild.build(serverConfig);
    }
    serverBuilt = true;
  }

  // 2. Build Client Entry if source exists
  const clientSourceCandidates = [
    manifest.client?.source,
    "src/client.ts",
    "src/client.js",
  ].filter(Boolean);

  let clientEntrySource: string | null = null;
  for (const candidate of clientSourceCandidates) {
    const p = path.join(dir, candidate);
    if (await stat(p).catch(() => null)) {
      clientEntrySource = p;
      break;
    }
  }

  const clientOutFile = path.resolve(
    dir,
    manifest.client?.entry ?? manifest.clientEntry ?? "dist/src/client.js",
  );

  if (clientEntrySource) {
    const clientPlugins: esbuild.Plugin[] = [
      vueGlobalShimPlugin,
      (vue as unknown as (opts: unknown) => esbuild.Plugin)({
        isProduction: true,
        sourceMap: false,
      }),
    ];

    const clientConfig: esbuild.BuildOptions = {
      entryPoints: [clientEntrySource],
      outfile: clientOutFile,
      bundle: true,
      platform: "browser",
      target: "es2022",
      format: "esm",
      sourcemap: options.sourcemap ?? true,
      minify: options.minify ?? false,
      plugins: clientPlugins,
      external: [
        "@drop-oss/plugin-sdk",
        "@droposs/plugin-sdk",
        "@drop/plugin-sdk",
      ],
    };

    if (options.watch) {
      const clientCtx = await esbuild.context(clientConfig);
      await clientCtx.watch();
      contexts.push(clientCtx);
    } else {
      await esbuild.build(clientConfig);
    }
    clientBuilt = true;

    // Check if CSS was emitted and update manifest.client.css if necessary
    const clientCssCandidate = clientOutFile.replace(/\.[^.]+$/, ".css");
    if (await stat(clientCssCandidate).catch(() => null)) {
      const relCss = path
        .relative(dir, clientCssCandidate)
        .replaceAll("\\", "/");
      if (manifest.client && manifest.client.css !== relCss) {
        manifest.client.css = relCss;
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      }
    }
  }

  // 3. Automatically re-sign the plugin bundle after building
  if (options.sign !== false) {
    await signPlugin(dir, options.signingKey, true, {
      outManifest: options.outManifest,
    });
  }

  return { serverBuilt, clientBuilt, contexts: contexts.length > 0 ? contexts : undefined };
}


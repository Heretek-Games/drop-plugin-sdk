# SPIKE REPORT: Plugin Isolation, Sandboxing & WASM/WASI Evaluation

**Issue**: Heretek-Games/drop-plugin-sdk#8  
**Parent Epic**: Heretek-Games/drop-plugin-sdk#2  
**Date**: September 2026  
**Status**: Recommendation Complete (Go / No-Go Decision)

---

## 1. Executive Summary & Decision

### Recommendation:
1. **NO-GO on WebAssembly (WASM/WASI) as the primary execution runtime for general TypeScript/JavaScript Drop plugins.**
   - Compiling JavaScript/TypeScript plugins to WASM requires embedding a guest JS engine (e.g. QuickJS via Javy, ComponentizeJS, or Extism). This introduces prohibitive binary size bloat (2–6 MB per plugin), breaks standard npm/Node.js ecosystem compatibility, and severely degrades developer authoring experience.
2. **GO on Isolated Worker Subprocesses (`node:child_process` / `worker_threads` with JSON-RPC IPC) for `trust: "sandboxed"` plugins.**
   - Full TypeScript/JavaScript compatibility, independent V8 heap isolation, strict resource constraints (CPU/memory quotas), fault/crash containment, and seamless compatibility with host OS confinement (Linux `seccomp`/cgroups, macOS sandbox-exec, Windows AppContainer).
3. **FUTURE OPT-IN for WASM/WASI specifically for pure compute / codec plugins.**
   - If Drop introduces plugin extensions for custom decompressors, binary format parsers, or hashing algorithms, a dedicated WASM engine (e.g. Wasmtime / `@extism/extism`) can provide microsecond sandboxed compute without JS overhead.

---

## 2. Threat Model for Third-Party Plugins

In Drop's architecture, plugins can be authored by third-party community developers and distributed via `.dropplugin` archives, remote registry indexes, or URLs.

### 2.1 Assets at Risk
- **Host Process Memory**:
  - Environment variables containing system secrets (`DROP_ADMIN_TOKEN`, database passwords, OIDC client secrets, session encryption keys).
  - Live Prisma ORM client instances and database connection pools.
  - Active user session tokens and in-memory caches.
- **Filesystem**:
  - Host server data directory (`<dataDir>/`), sqlite/postgres files, user configuration.
  - Desktop client game install directories and executable binaries.
  - User personal files (`~/.ssh`, `~/.config`, documents).
- **Network & Perimeter**:
  - Unauthenticated access to the local loopback (`127.0.0.1`) and local area network (SSRF attacks against local database ports, NAS devices, router administration interfaces).
  - Outbound data exfiltration / telemetry to command-and-control servers.
- **Host Availability (Denial of Service)**:
  - Event loop blocking via infinite loops or sync CPU work (`while(true)`).
  - Memory exhaustion (unbounded allocations triggering OOM kills of the host server).
  - Uncaught exceptions or unhandled promise rejections terminating the host process.

### 2.2 Attack Vectors in In-Process Execution (`trust: "trusted"`)
- **Prototype Pollution & Monkey-Patching**: Modifying `Object.prototype`, `Array.prototype`, or global constructors (`fetch`, `Promise`) to intercept or tamper with core server behavior.
- **Global Scope Escapes**: Accessing Node.js built-ins (`fs`, `child_process`, `net`, `process`) despite undeclared capabilities.
- **Crash Propagation**: Any unhandled error or segfault in native bindings immediately halts the host application.

---

## 3. Comparative Architecture Spike

We evaluated three potential isolation runtime architectures against the Drop plugin contract (`PluginContext`, `capabilities`, `routes`, `storage`, `events`, `websocket`).

| Criteria | 1. WebAssembly / WASI | 2. Worker Subprocess (IPC) | 3. V8 Isolates (`isolated-vm`) |
| :--- | :--- | :--- | :--- |
| **Language Support** | Rust, C, Go native; JS requires guest engine | Pure TypeScript / JavaScript | Pure JavaScript |
| **Ecosystem / npm** | ❌ None (no Node APIs, limited polyfills) | ✅ 100% (standard npm packages work) | ⚠️ Partial (no native Node modules) |
| **Memory Isolation** | ✅ Hardware / linear memory boundary | ✅ Separate OS process / heap | ✅ Distinct V8 Isolate heap |
| **Binary Package Size** | ⚠️ Heavy (2–6 MB due to QuickJS bytecode) | ✅ Light (5–50 KB standard JS/TS bundles) | ✅ Light |
| **Cold Start Overhead** | ~20–50 ms (engine init) | ~30–80 ms (spawn) / <5 ms (prewarmed) | <5 ms |
| **Call Latency** | ~0.05 ms (host function call) | ~0.15–0.30 ms (Unix domain socket/stdio) | ~0.02 ms (in-process isolate) |
| **Fault Containment** | ✅ Trap contained in WASM instance | ✅ Process crash contained by supervisor | ⚠️ C++ panic crashes process |
| **OS Sandboxing** | Host controls host calls | ✅ Can apply `seccomp`, cgroups, `pledge` | Limited to V8 runtime constraints |
| **Build & Toolchain** | High friction (complex toolchain) | Native `esbuild` / `@droposs/plugin-cli` | High (native node-gyp C++ compilation) |

### 3.1 WASM/WASI Deep-Dive
Using tools like Extism or Javy to run TypeScript requires bundling an interpreter into each plugin. This results in:
1. Significant bundle inflation: Even a 10-line "Hello World" plugin exceeds 3MB.
2. Inability to use popular npm libraries that rely on standard Node.js runtime globals or async microtask queues.
3. Complex memory marshalling: Every HTTP request and response must be copied into and out of linear memory buffers via memory pointers.

### 3.2 Worker Subprocess Deep-Dive
Spawning plugins in an external worker process (`node:child_process.fork` or an isolated binary supervisor):
1. **Clean Separation**: Complete protection against prototype pollution, memory leaks, and fatal process exits.
2. **Zero Toolchain Disruption**: Plugin developers continue writing standard TypeScript with `@droposs/plugin-sdk` and bundling via `@droposs/plugin-cli`.
3. **OS-Level Enforcement**: On Linux, the supervisor process can drop privileges and restrict system calls using `prctl(PR_SET_NO_NEW_PRIVS)` and `seccomp` profiles.

---

## 4. Required API & Contract Evolution

To support untrusted isolated execution (`trust: "sandboxed"`), the plugin contract must adapt from in-memory object references to serialized message-passing protocols.

### 4.1 Route Handlers: In-Memory vs Serialized Envelope
- **Current In-Process (`trust: "trusted"`)**:
  ```ts
  ctx.registerRoute("GET", "/items", (event: H3Event, context) => {
    return { items: [] };
  });
  ```
- **Isolated Envelope (`trust: "sandboxed"`)**:
  Route invocations cross the IPC boundary as standardized RPC envelopes:
  ```ts
  export interface PluginRequestEnvelope {
    requestId: string;
    pluginId: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    headers: Record<string, string>;
    query: Record<string, string | string[]>;
    body?: unknown;
  }

  export interface PluginResponseEnvelope {
    requestId: string;
    status: number;
    headers?: Record<string, string>;
    body?: unknown;
  }
  ```

### 4.2 Storage, Events & WebSocket
- Storage methods (`get`, `set`, `delete`) already return `Promise<T>` in `PluginStorage`, making them 100% compatible with asynchronous IPC proxies.
- Event broadcasting (`ctx.broadcast`, `ctx.subscribe`) and WebSocket messaging already use discrete serializable payloads.

The client RPC abstraction already published in `@droposs/plugin-sdk` (`PluginRpcClient`) serves as the reference implementation for IPC envelope serialization.

---

## 5. Migration Sketch & Implementation Roadmap

```
  Phase 1 (Delivered)              Phase 2 (Proposed)                Phase 3 (Desktop UI)
+-------------------------+     +--------------------------+     +-------------------------+
| In-Process Trusted      |     | Out-of-Process Worker    |     | Desktop Client Sandbox  |
| - Capability Gating     | --> | - trust: "sandboxed"     | --> | - Web Components/Iframe |
| - HMAC & SHA-256 Code   |     | - JSON-RPC Stdio IPC     |     | - postMessage Bridge    |
| - Registry Pinning      |     | - Cgroup & Memory Limits |     | - Isolated LocalStorage |
+-------------------------+     +--------------------------+     +-------------------------+
```

### Phase 1: Cryptographic Integrity & Capability Consent (Delivered)
- Dual-tier signing (aggregate code SHA-256 digest + HMAC signature).
- Fail-closed signature verification (`DROP_PLUGIN_REQUIRE_SIGNATURE=true`).
- Allow-list and version pinning (`DROP_PLUGIN_REGISTRY`).
- Capability permission consent dialog before installation (`plugins.vue`).

### Phase 2: Worker Subprocess Runner (`trust: "sandboxed"`)
1. Introduce an internal `PluginRunner` SPI in `server/server/internal/plugins/`:
   - `InProcessRunner` (for built-in and verified trusted plugins).
   - `WorkerProcessRunner` (spawns an isolated Node worker process with `--max-old-space-size=128`).
2. Protocol Handler:
   - Establish bidirectional JSON-RPC over stdio or local IPC stream.
   - Host supervisor intercepts calls and enforces capability checks before proxying to database/storage.
3. Resource Limits:
   - Cap worker memory at 128 MB.
   - Enforce request timeout (5,000 ms default); terminate and restart misbehaving workers.

### Phase 3: Desktop Client Webview/Iframe Sandboxing
- Render third-party UI extensions inside sandboxed `<iframe>` elements with restricted attributes:
  `sandbox="allow-scripts allow-forms"`.
- Communication via `window.postMessage` to the client plugin manager host.
- Zero direct access to Tauri IPC commands (`invoke()`) or local files.

---

## 6. Conclusion

WebAssembly is not suitable as the primary runtime for Drop's JavaScript/TypeScript plugins due to extreme bundle overhead and ecosystem incompatibility. Subprocess worker isolation provides the optimal balance of enterprise-grade security isolation, fault tolerance, resource quotas, and zero developer friction.

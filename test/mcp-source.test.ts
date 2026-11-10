import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { inspectMcpSource } from "../src/marketplaces.ts"

const originalFetch = globalThis.fetch

function jsonResponse(value: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => (typeof value === "string" ? value : JSON.stringify(value)),
  } as Response
}

function missingResponse() {
  return {
    ok: false,
    status: 404,
    statusText: "Not Found",
    text: async () => "",
  } as Response
}

function configOf(proposal: { config?: unknown } | undefined) {
  return (proposal?.config ?? {}) as Record<string, unknown>
}

function mockFetch(t: test.TestContext, routes: Record<string, unknown>) {
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    calls.push(url)
    if (Object.hasOwn(routes, url)) return jsonResponse(routes[url])
    return missingResponse()
  }) as typeof fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  return calls
}

test("inspectMcpSource reads a pasted Claude-style JSON config", async () => {
  const inspection = await inspectMcpSource(
    JSON.stringify({
      mcpServers: {
        fetch: { command: "uvx", args: ["mcp-server-fetch"], env: { TOKEN: "secret" } },
        remote: { type: "sse", url: "https://mcp.example.com/sse", headers: { Authorization: "Bearer x" } },
        broken: { type: "local" },
        blank: { type: "remote", url: "  " },
      },
    }),
  )

  assert.equal(inspection.url, "Pasted JSON")
  assert.equal(inspection.proposals.length, 2)
  assert.deepEqual(inspection.proposals[0], {
    kind: "mcp",
    name: "fetch",
    config: { type: "local", command: ["uvx", "mcp-server-fetch"], environment: { TOKEN: "secret" } },
    reason: "Pasted JSON contains an MCP server",
  })
  assert.deepEqual(inspection.proposals[1]?.config, {
    type: "remote",
    url: "https://mcp.example.com/sse",
    headers: { Authorization: "Bearer x" },
  })
  assert.ok(inspection.notes.some((note) => note.includes("blank")))
})

test("inspectMcpSource accepts a single pasted server and JSONC comments", async () => {
  const inspection = await inspectMcpSource(`{
    // one server, not wrapped in mcpServers
    "type": "local",
    "command": ["node", "server.js"],
  }`)

  assert.equal(inspection.proposals.length, 1)
  assert.equal(inspection.proposals[0]?.name, "mcp-server")
  assert.deepEqual(inspection.proposals[0]?.config, { type: "local", command: ["node", "server.js"] })
})

test("inspectMcpSource downloads a GitHub blob through its raw URL", async (t) => {
  const calls = mockFetch(t, {
    "https://raw.githubusercontent.com/acme/tools/main/config/mcp.json": {
      mcpServers: { fetch: { command: "uvx", args: ["mcp-server-fetch"] } },
    },
  })

  const inspection = await inspectMcpSource("https://github.com/acme/tools/blob/main/config/mcp.json")

  assert.deepEqual(calls, ["https://raw.githubusercontent.com/acme/tools/main/config/mcp.json"])
  assert.equal(inspection.url, "https://github.com/acme/tools/blob/main/config/mcp.json")
  assert.equal(inspection.owner, "acme")
  assert.equal(inspection.repo, "tools")
  assert.equal(inspection.proposals.length, 1)
  assert.equal(inspection.proposals[0]?.name, "fetch")
})

test("inspectMcpSource scans a GitHub README file for MCP commands", async (t) => {
  mockFetch(t, {
    "https://raw.githubusercontent.com/acme/readme/main/README.md":
      "# Tools\n\nRun `npx -y @acme/mcp-server` to start it.",
  })

  const inspection = await inspectMcpSource("https://github.com/acme/readme/blob/main/README.md")

  assert.equal(inspection.proposals.length, 1)
  assert.deepEqual(inspection.proposals[0]?.config, {
    type: "local",
    command: ["npx", "-y", "@acme/mcp-server"],
  })
  assert.equal(inspection.proposals[0]?.reason, "Command found in the source")
})

test("inspectMcpSource turns npm sources into npx servers", async () => {
  const shorthand = await inspectMcpSource("@modelcontextprotocol/server-filesystem@latest")
  assert.equal(shorthand.owner, "npm")
  assert.deepEqual(shorthand.proposals[0]?.config, {
    type: "local",
    command: ["npx", "-y", "@modelcontextprotocol/server-filesystem@latest"],
  })

  const registry = await inspectMcpSource("https://registry.npmjs.org/@acme/mcp-tools")
  assert.equal(registry.url, "https://www.npmjs.com/package/@acme/mcp-tools")
  assert.deepEqual(registry.proposals[0]?.config, {
    type: "local",
    command: ["npx", "-y", "@acme/mcp-tools"],
  })

  const page = await inspectMcpSource("https://www.npmjs.com/package/mcp-server-demo/v/1.2.0")
  assert.equal(page.name, "mcp-server-demo")
  assert.deepEqual(page.proposals[0]?.config, {
    type: "local",
    command: ["npx", "-y", "mcp-server-demo@1.2.0"],
  })
})

test("inspectMcpSource treats MCP-looking URLs as remote endpoints without fetching", async (t) => {
  const calls = mockFetch(t, {})

  const pathEndpoint = await inspectMcpSource("https://api.example.com/mcp")
  assert.deepEqual(calls, [])
  assert.equal(configOf(pathEndpoint.proposals[0]).type, "remote")
  assert.equal(configOf(pathEndpoint.proposals[0]).url, "https://api.example.com/mcp")

  const hostEndpoint = await inspectMcpSource("https://mcp.example.com")
  assert.equal(configOf(hostEndpoint.proposals[0]).url, "https://mcp.example.com/")
})

test("inspectMcpSource extracts commands, packages, endpoints, and JSON links from a docs page", async (t) => {
  const calls = mockFetch(t, {
    "https://docs.example.com/guide/servers": `
      <html><body>
        <h1>MCP servers</h1>
        <pre><code>npx -y @modelcontextprotocol/server-filesystem /tmp</code></pre>
        <p>Connect to https://mcp.example.com/mcp for the hosted server.</p>
        <a href="https://www.npmjs.com/package/@acme/mcp-tools">npm package</a>
        <a href="/configs/remote.json">JSON config</a>
      </body></html>`,
    "https://docs.example.com/configs/remote.json": {
      mcp: { servers: { linked: { type: "remote", url: "https://linked.example.com/mcp" } } },
    },
  })

  const inspection = await inspectMcpSource("https://docs.example.com/guide/servers")

  assert.deepEqual(calls.sort(), [
    "https://docs.example.com/configs/remote.json",
    "https://docs.example.com/guide/servers",
  ])
  const names = inspection.proposals.map((proposal) => proposal.name)
  assert.ok(inspection.proposals.some((proposal) => configOf(proposal).url === "https://mcp.example.com/mcp"))
  assert.ok(
    inspection.proposals.some(
      (proposal) =>
        proposal.reason === "Command found in the source" &&
        JSON.stringify(configOf(proposal).command) ===
          JSON.stringify(["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"]),
    ),
  )
  assert.ok(names.includes("acme-mcp-tools"))
  assert.ok(names.includes("linked"))
})

test("inspectMcpSource reads a local JSONC file", async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), "oem-mcp-source-"))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const file = path.join(folder, "mcp.json")
  await writeFile(
    file,
    `{
      // local config
      "mcp": {
        "servers": {
          "local": { "type": "local", "command": ["node", "server.js"] },
        },
      },
    }`,
  )

  const inspection = await inspectMcpSource(file)

  assert.equal(inspection.owner, "local")
  assert.equal(inspection.proposals.length, 1)
  assert.deepEqual(inspection.proposals[0]?.config, { type: "local", command: ["node", "server.js"] })
})

test("inspectMcpSource merges config files from a local folder", async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), "oem-mcp-folder-"))
  t.after(() => rm(folder, { recursive: true, force: true }))
  await mkdir(path.join(folder, ".cursor"))
  await writeFile(
    path.join(folder, ".mcp.json"),
    JSON.stringify({ mcpServers: { one: { command: "node", args: ["one.js"] } } }),
  )
  await writeFile(
    path.join(folder, "opencode.jsonc"),
    `{
      "mcp": {
        "servers": {
          "one": { "type": "local", "command": ["node", "duplicate.js"] },
          "two": { "type": "remote", "url": "https://two.example.com/mcp" },
        },
      },
    }`,
  )
  await writeFile(
    path.join(folder, ".cursor", "mcp.json"),
    JSON.stringify({ mcpServers: { three: { command: "three" } } }),
  )

  const inspection = await inspectMcpSource(folder)

  assert.deepEqual(
    inspection.proposals.map((proposal) => proposal.name),
    ["one", "two", "three"],
  )
  assert.deepEqual(inspection.proposals[0]?.config, { type: "local", command: ["node", "one.js"] })
})

test("inspectMcpSource filters GitHub repository proposals to MCP servers only", async (t) => {
  mockFetch(t, {
    "https://raw.githubusercontent.com/acme/kit/main/package.json": {
      name: "acme-kit",
      keywords: ["opencode-plugin"],
    },
    "https://raw.githubusercontent.com/acme/kit/main/.mcp.json": {
      mcpServers: { kit: { command: "npx", args: ["-y", "acme-kit"] } },
    },
  })

  const inspection = await inspectMcpSource("https://github.com/acme/kit")

  assert.deepEqual(
    inspection.proposals.map((proposal) => proposal.kind),
    ["mcp"],
  )
  assert.ok(inspection.notes.some((note) => note.includes("Plugins tab")))
})

test("inspectMcpSource finds a JSON config embedded in a GitHub README", async (t) => {
  const calls = mockFetch(t, {
    "https://raw.githubusercontent.com/vercel-labs/agent-desktop/main/README.md": [
      "# agent-desktop",
      "",
      "## MCP",
      "",
      "```json",
      '{ "mcpServers": { "agent-desktop": { "command": "agent-desktop", "args": ["mcp"] } } }',
      "```",
      "",
    ].join("\n"),
    "https://raw.githubusercontent.com/vercel-labs/agent-desktop/main/npm/package.json": {
      name: "agent-desktop",
      bin: { "agent-desktop": "bin/agent-desktop" },
    },
  })

  const inspection = await inspectMcpSource("https://github.com/vercel-labs/agent-desktop")

  assert.ok(
    calls.includes("https://raw.githubusercontent.com/vercel-labs/agent-desktop/main/npm/package.json"),
  )
  assert.equal(inspection.name, "agent-desktop")
  assert.equal(inspection.proposals.length, 1)
  assert.equal(inspection.proposals[0]?.name, "agent-desktop")
  assert.deepEqual(configOf(inspection.proposals[0]), {
    type: "local",
    command: ["npx", "-y", "agent-desktop", "mcp"],
  })
  assert.match(inspection.proposals[0]?.reason ?? "", /npx/)
})

test("inspectMcpSource reads inline README JSON without a package manifest", async (t) => {
  mockFetch(t, {
    "https://raw.githubusercontent.com/acme/tool/main/README.md":
      'Add this to your config: { "mcpServers": { "custom": { "command": "custom-mcp", "args": ["serve"] } } } and restart.',
  })

  const inspection = await inspectMcpSource("https://github.com/acme/tool")

  assert.equal(inspection.proposals.length, 1)
  assert.equal(inspection.proposals[0]?.name, "custom")
  assert.deepEqual(configOf(inspection.proposals[0]), {
    type: "local",
    command: ["custom-mcp", "serve"],
  })
})

test("inspectMcpSource rejects empty and unsupported sources", async () => {
  await assert.rejects(() => inspectMcpSource("   "), /Enter a GitHub URL/)
  await assert.rejects(() => inspectMcpSource("ftp://example.com/mcp"), /Unsupported source/)
  await assert.rejects(() => inspectMcpSource("not a source"), /Unsupported source/)
})

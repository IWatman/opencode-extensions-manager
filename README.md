# OpenCode Extensions Manager

**English** | [Русский](README.ru.md)

A desktop GUI plugin for **OpenCode** that adds a **Settings → Extensions Manager** page for managing MCP servers, plugins, skills, and plugin marketplaces without editing `opencode.json` by hand.

> Status: experimental. Built for OpenCode Desktop **2.2.x** and the experimental `./gui-experimental` plugin API.

## Features

- **MCP servers**
  - Local servers with command, working directory, and environment variables.
  - Remote servers with URL, headers, and OAuth configuration.
  - Enable/disable without deleting the entry.
  - Runtime status: connected, starting, disabled, failed, sign-in required.
- **Plugins**
  - npm packages.
  - Local plugin folders.
  - Per-plugin JSON options.
  - `-package` removal directives.
- **Skills**
  - Folder skills: `<skillsDir>/<id>/SKILL.md`.
  - Single-file skills: `<skillsDir>/<id>.md`.
  - Full-text editor, rename, enable/disable.
- **Plugin marketplaces**
  - Built-in Anthropic marketplace catalog: `anthropics/claude-plugins-official`.
  - Nothing is installed automatically from it.
  - Add more marketplaces by GitHub URL, `owner/repo`, or local folder.
  - Search the catalog, install, update, enable/disable, and remove plugins.
  - Automatic compatibility extraction for Claude Code plugins:
    - MCP servers from `.mcp.json` / `mcpServers`.
    - Skills from `skills/**/SKILL.md`.
    - OpenCode plugins when the repository itself is an OpenCode plugin.
    - Claude commands, agents, hooks, and LSP servers are reported as unsupported.
- **Global and project scopes**
  - Global: `~/.config/opencode`.
  - Project: the nearest `.opencode` directory, with a folder picker.
- **Safe JSONC writes**
  - Comments and formatting are preserved.
  - Atomic writes.
  - `.bak` backup before every change.
  - Invalid JSONC blocks writes instead of corrupting the file.
- **Localization**
  - Russian and English UI.
- **Automatic compatibility fixes**
  - Strips Claude-specific `?client=claude-…` parameters from remote MCP URLs.
  - Ignores docs such as `README.md` when scanning skills.
  - Can add minimal YAML frontmatter to skills that need it.

## Requirements

- **OpenCode Desktop 2.2.x**
- **Node.js 22+** (only for building or running from source)
- Windows, macOS, or Linux

## Installation

### From source

1. Clone the repository:

   ```bash
   git clone https://github.com/IWatman/opencode-extensions-manager.git
   cd opencode-extensions-manager
   ```

2. Install dependencies and build the GUI bundle:

   ```bash
   npm install
   npm run build
   ```

3. Add the absolute path to your global OpenCode config.

   **Windows** — `C:\Users\<you>\.config\opencode\opencode.json`:

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": [
       "C:\\Users\\<you>\\Documents\\opencode-extensions-manager"
     ]
   }
   ```

   **macOS / Linux** — `~/.config/opencode/opencode.json`:

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": [
       "/absolute/path/to/opencode-extensions-manager"
     ]
   }
   ```

4. Restart OpenCode Desktop.

5. Open **Settings → Extensions Manager**. The page can also be opened from the command palette.

### From GitHub (experimental)

If your OpenCode build supports Git package specs in `plugins`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:IWatman/opencode-extensions-manager"]
}
```

The repository includes the prebuilt GUI bundle at `dist/gui-experimental.cjs`. If the GUI page does not appear, clone the repository and build it locally instead.

## Usage

### Scope

Use the scope selector to choose where changes are written:

- **Global** — applies to every project.
- **Project** — applies only to the selected folder.

Project scope uses the nearest `.opencode` directory, matching OpenCode's own configuration discovery. If no `.opencode` directory exists, it is created on the first write.

### MCP servers

- Add local or remote servers.
- Edit name, type, command/URL, environment, headers, and OAuth settings.
- Toggle a server without deleting it.
- If a remote server needs authentication, use the **Sign in** action or run the copied command in a terminal.

### Plugins

- Add npm packages or local plugin folders.
- Pass JSON options to a plugin.
- Use a `-package` entry to remove an automatically discovered plugin.

### Skills

- Create and edit `SKILL.md` files.
- Rename a skill folder.
- Disable a skill: it is moved to `<skillsDir>/.disabled` and ignored by OpenCode.

### Marketplaces

1. Open the **Plugin marketplaces** section.
2. The official Anthropic catalog is already listed.
3. Click **Catalog** to browse it.
4. Use search to find a plugin.
5. Click **Install** and confirm the compatible parts.

Marketplace metadata and installed records are stored in:

```text
~/.config/opencode/extensions-manager.json
```

Uninstalling a marketplace plugin removes only the MCP servers, skills, and plugin entries that the manager added.

## MCP OAuth

OpenCode performs the browser OAuth flow. The manager prepares the configuration and copies the command:

```bash
opencode mcp auth <server-name>
```

Useful commands:

```bash
opencode mcp list
opencode mcp logout <server-name>
```

OAuth modes in the MCP editor:

- **Automatic** — no `oauth` field; OpenCode uses dynamic client registration.
- **Custom OAuth client** — set `client_id`, `client_secret`, `scope`, `callback_port`, `redirect_uri`, and `auth_server_metadata_url`.
- **Disabled** — writes `oauth: false`, for servers that use an API key or custom headers.

OAuth tokens are stored by OpenCode in:

```text
~/.local/share/opencode/mcp-auth.json
```

The manager cannot open the browser itself because the OpenCode GUI API does not expose an MCP auth call. It copies the exact CLI command instead.

### Context7

The Anthropic marketplace contains a Context7 plugin. Installing it adds the remote MCP:

```text
https://mcp.context7.com/mcp
```

Context7 works anonymously. For higher rate limits, get a free API key from [context7.com/dashboard](https://context7.com/dashboard) and use a header:

```text
CONTEXT7_API_KEY={env:CONTEXT7_API_KEY}
```

or:

```text
Authorization=Bearer <your-key>
```

## Marketplace compatibility

Claude Code plugins are not executed by OpenCode directly. The manager installs the parts that OpenCode can use:

| Claude plugin part | OpenCode support |
| --- | --- |
| `.mcp.json` / `mcpServers` | Converted to OpenCode MCP configuration |
| `skills/**/SKILL.md` | Installed as OpenCode skills |
| OpenCode plugin repository | Added to `plugins` |
| Commands, agents, hooks, LSP | Not supported; shown as warnings |

Skills without valid YAML frontmatter are listed separately during installation. Enable **Adapt automatically** to add a minimal frontmatter with the folder name and the first line as the description.

## Configuration files

| Purpose | Path |
| --- | --- |
| Global config | `~/.config/opencode/opencode.json` or `opencode.jsonc` |
| Project config | nearest `.opencode/opencode.json` or `opencode.jsonc` |
| Global skills | `~/.config/opencode/skills` |
| Project skills | `<project>/.opencode/skills` |
| Disabled skills | `<skillsDir>/.disabled` |
| Manager registry | `~/.config/opencode/extensions-manager.json` |
| OAuth tokens | `~/.local/share/opencode/mcp-auth.json` |

If both `opencode.json` and `opencode.jsonc` exist, the manager edits `opencode.jsonc` because OpenCode loads it later.

## Development

```bash
npm install
npm run typecheck          # TypeScript checks
npm run smoke              # Config, MCP, plugins, skills
npm run smoke:marketplace  # Local marketplace install/update/remove
npm run build              # Production GUI bundle
npm run dev                # Rebuild GUI in watch mode
```

After changing GUI code, run `npm run build` and restart OpenCode Desktop. Server-side changes reload through OpenCode's watcher, but a restart is the reliable option.

## Limitations

- Built for OpenCode 2.2.x and its experimental GUI API.
- Claude Code commands, agents, hooks, and LSP servers are not supported by OpenCode.
- GitHub API rate limits apply when fetching marketplace plugin trees. Trees are cached for five minutes.
- Skills are scanned one level deep: `<skillsDir>/<id>/SKILL.md` and `<skillsDir>/<id>.md`.
- The OAuth browser flow is started by the OpenCode CLI, not by the manager.
- Marketplace installations are always manual; nothing from the default catalog is installed automatically.
- Installing third-party plugins and MCP servers runs third-party code. Review the source before installing.

## Contributing

Issues and pull requests are welcome. Please run `npm run typecheck`, `npm run smoke`, and `npm run smoke:marketplace` before submitting a PR.

## License

[MIT](LICENSE)

# OpenCode 扩展管理器

[English](README.md) | [Русский](README.ru.md) | **简体中文** | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [日本語](README.ja.md) | 繁體中文 | 한국어 | Italiano | Polski | Türkçe | Українська

一个 **OpenCode** 桌面 GUI 插件。它在 **设置 → 扩展管理器** 中新增页面，用来管理 MCP 服务器、插件、技能和插件市场，无需手动编辑 `opencode.json`。

> 状态：实验性。面向 OpenCode Desktop **2.2.x** 和实验性的 `./gui-experimental` 插件 API。

## 功能

- **MCP 服务器**
  - 本地服务器：命令、工作目录和环境变量。
  - 远程服务器：URL、请求头和 OAuth 配置。
  - 启用/禁用，无需删除条目。
  - 运行状态：已连接、启动中、已禁用、失败、需要登录。
  - **从链接安装**：可在 GitHub 仓库或文件、npm 包、JSON/JSONC 配置、文档页面、远程 MCP 端点、本地文件或文件夹，或粘贴的 JSON 中查找服务器。
- **插件**
  - npm 包。
  - 本地插件文件夹。
  - 每个插件的 JSON 选项。
  - `-package` 移除指令。
- **技能**
  - 文件夹技能：`<skillsDir>/<id>/SKILL.md`。
  - 单文件技能：`<skillsDir>/<id>.md`。
  - 全文编辑器、重命名、启用/禁用。
- **插件市场**
  - 内置 Anthropic 市场目录：`anthropics/claude-plugins-official`。
  - 不会从该目录自动安装任何内容。
  - 可通过 GitHub URL、`owner/repo` 或本地文件夹添加更多市场。
  - 搜索目录、安装、更新、启用/禁用和移除插件。
  - 自动提取 Claude Code 插件的兼容部分：
    - 从 `.mcp.json` / `mcpServers` 提取 MCP 服务器。
    - 从 `skills/**/SKILL.md` 提取技能。
    - 如果仓库本身是 OpenCode 插件，则添加为 OpenCode 插件。
    - Claude 命令、代理、hooks 和 LSP 服务器会被标记为不支持。
- **全局和项目范围**
  - 全局：`~/.config/opencode`。
  - 项目：最近的 `.opencode` 目录，并提供文件夹选择器。
- **安全的 JSONC 写入**
  - 保留注释和格式。
  - 原子写入。
  - 每次更改前创建 `.bak` 备份。
  - JSONC 无效时阻止写入，避免损坏文件。
- **本地化**
  - 英语、俄语、简体中文、繁体中文、西班牙语、法语、德语、日语、韩语、意大利语、波兰语、土耳其语和乌克兰语界面。
  - 其他语言回退到英语。
  - 已提供英语、俄语、简体中文、西班牙语、法语、德语和日语 README；其他界面语言尚未翻译。
- **自动兼容修复**
  - 从远程 MCP URL 中移除 Claude 专用的 `?client=claude-…` 参数。
  - 扫描技能时忽略 `README.md` 等文档。
  - 可为缺少 frontmatter 的技能添加最小 YAML frontmatter。
- **从 Claude Code 导入**
  - 扫描 Claude Code 插件缓存，预览 MCP 服务器、技能、OpenCode 插件以及不支持的部分。
  - 源文件夹只读；导入使用与市场插件相同的事务性安装流程和所有权指纹。
- **更新中心**
  - 按原始来源检查市场插件、npm/GitHub 包插件和 Claude Code 导入。
  - 独立更新每个项目，并按项目显示结果。
  - 手动添加的 MCP 服务器和技能没有更新来源，会被跳过。
- **诊断**
  - 检查无效的 JSONC 和解析错误、跨范围的重复 MCP 名称、重复的插件条目、无效或无法读取的 MCP 和插件条目、失败或需要登录的 MCP 服务器、缺失的配置文件，以及缺失或无法读取的技能文件夹。
  - 仅提供安全操作：运行检查、显示路径、重试失败的 MCP 服务器、复制登录命令，以及经确认后移除重复的插件条目。
  - 不会自行改写配置。

## 要求

- **OpenCode Desktop 2.2.x**
- **Node.js 22+**（仅用于构建或从源码运行）
- Windows、macOS 或 Linux

## 安装

### 从源码安装

1. 克隆仓库：

   ```bash
   git clone https://github.com/IWatman/opencode-extensions-manager.git
   cd opencode-extensions-manager
   ```

2. 安装依赖并构建 GUI 包：

   ```bash
   npm install
   npm run build
   ```

3. 将绝对路径添加到全局 OpenCode 配置。

   **Windows** — `C:\Users\<you>\.config\opencode\opencode.json`：

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": [
       "C:\\Users\\<you>\\Documents\\opencode-extensions-manager"
     ]
   }
   ```

   **macOS / Linux** — `~/.config/opencode/opencode.json`：

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": [
       "/absolute/path/to/opencode-extensions-manager"
     ]
   }
   ```

4. 重启 OpenCode Desktop。

5. 打开 **设置 → 扩展管理器**。也可以从命令面板打开。

### 从 GitHub 安装（实验性）

如果你的 OpenCode 构建支持 `plugins` 中的 Git 包规范：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:IWatman/opencode-extensions-manager"]
}
```

仓库包含预构建的 GUI 包 `dist/gui-experimental.cjs`。如果没有出现 GUI 页面，请克隆仓库并在本地构建。

## 使用

### 范围

使用范围选择器决定更改写入哪里：

- **全局** — 应用于所有项目。
- **项目** — 仅应用于所选文件夹。

项目范围使用最近的 `.opencode` 目录，与 OpenCode 自身的配置发现一致。如果不存在 `.opencode` 目录，会在第一次写入时创建。

### MCP 服务器

- 添加本地或远程服务器。
- 点击 **从链接安装**，可从 GitHub 仓库或文件、npm 包、JSON/JSONC 配置链接、文档页面、远程 MCP 端点、本地文件或文件夹，或粘贴的 JSON 中检测服务器。请查看检测到的服务器，只安装你信任的服务器。
- 编辑名称、类型、命令/URL、环境变量、请求头和 OAuth 设置。
- 切换启用/禁用，无需删除服务器。
- 如果远程服务器需要认证，使用 **登录** 操作，或在终端运行复制的命令。

### 插件

- 添加 npm 包或本地插件文件夹。
- 向插件传递 JSON 选项。
- 使用 `-package` 条目移除自动发现的插件。

### 技能

- 创建和编辑 `SKILL.md` 文件。
- 重命名技能文件夹。
- 禁用技能：移动到 `<skillsDir>/.disabled`，OpenCode 会忽略它。

### 市场

1. 打开 **插件市场** 部分。
2. 官方 Anthropic 目录已经列出。
3. 点击 **目录** 浏览。
4. 使用搜索查找插件。
5. 点击 **安装** 并确认兼容部分。

市场元数据和安装记录保存在：

```text
~/.config/opencode/extensions-manager.json
```

卸载市场插件只会移除管理器添加的 MCP 服务器、技能和插件条目。

### 从 Claude Code 导入

管理器可以扫描 Claude Code 的插件缓存（`~/.claude/plugins/cache` 或 `$CLAUDE_CONFIG_DIR/plugins/cache`），并在安装任何内容之前预览兼容部分。

1. 打开 **从 Claude Code 导入**。该部分会在打开时扫描缓存；点击 **再次扫描** 刷新。
2. 查看每个缓存插件：MCP 服务器、技能、OpenCode 插件以及不支持的 Claude Code 部分。每个候选项都会显示源路径。
3. 选择要导入的插件并确认。源文件夹只会被读取。
4. 可选：启用 **自动适配缺少 frontmatter 的技能**，为需要它的技能添加最小 YAML frontmatter。

导入使用与市场插件相同的事务性安装流程和所有权指纹，因此卸载和禁用只会移除仍与安装时一致的产物。

### 更新中心

**更新中心** 位于 **概览** 标签页，会按照已安装项目的来源进行检查：

- 市场插件：检查其市场来源；
- npm 和 GitHub 包插件：通过 OpenCode 的插件服务检查；
- Claude Code 导入：与缓存中的插件版本比较。

1. 点击 **检查更新**。
2. 查看过时的项目及其当前和最新版本或提交（如果可用）。
3. 点击 **更新所有过时项** 执行批量更新。每个项目独立更新；单个失败不会中断其余项目，按项目显示的结果会列出成功、失败以及因不再匹配安装指纹而保留的市场产物。

手动添加的 MCP 服务器和技能没有更新来源，因此不会被改动。

### 诊断

**诊断** 会检查当前配置并报告问题，不会修改任何内容：

- 无效的 JSONC 或解析错误，以及无法读取的配置文件。
- 尚未创建的配置文件。
- 在全局和项目范围中同时定义的 MCP 服务器名称。
- 重复的插件条目，以及不是包字符串或包对象的插件条目。
- 既不是本地命令也不是远程 URL 的 MCP 条目，包括缺少命令的本地条目和缺少 URL 的远程条目。
- 运行状态为失败或需要登录的 MCP 服务器。
- 缺失或无法读取的技能文件夹。

诊断提供以下安全操作：

- **运行检查** 刷新诊断结果。
- **显示配置文件**、**显示配置文件夹**、**显示技能文件夹** 和 **显示项目文件夹** 会在文件管理器中打开对应路径。
- **重试** 会重新连接失败的 MCP 服务器。
- **登录** 会为需要认证的服务器复制 `opencode mcp auth <server>`。
- **删除 #N** 会在确认后通过管理器现有的 RPC 删除重复的插件条目，并保留 `.bak` 备份。

诊断不会自行改写配置。需要编辑配置的修复（例如跨范围的重复 MCP 名称、无效条目或技能文件夹权限）只会报告，需要手动处理。

## MCP OAuth

OpenCode 执行浏览器 OAuth 流程。管理器准备配置并复制命令：

```bash
opencode mcp auth <server-name>
```

常用命令：

```bash
opencode mcp list
opencode mcp logout <server-name>
```

MCP 编辑器中的 OAuth 模式：

- **自动** — 不写入 `oauth` 字段；OpenCode 使用动态客户端注册。
- **自定义 OAuth 客户端** — 设置 `client_id`、`client_secret`、`scope`、`callback_port`、`redirect_uri` 和 `auth_server_metadata_url`。
- **禁用** — 写入 `oauth: false`，适用于使用 API 密钥或自定义请求头的服务器。

OAuth 令牌由 OpenCode 保存在：

```text
~/.local/share/opencode/mcp-auth.json
```

管理器无法自行打开浏览器，因为 OpenCode GUI API 没有暴露 MCP 认证调用。它会复制准确的 CLI 命令。

### Context7

Anthropic 市场包含 Context7 插件。安装后会添加远程 MCP：

```text
https://mcp.context7.com/mcp
```

Context7 可匿名使用。如需更高速率限制，请从 [context7.com/dashboard](https://context7.com/dashboard) 获取免费 API 密钥并使用请求头：

```text
CONTEXT7_API_KEY={env:CONTEXT7_API_KEY}
```

或：

```text
Authorization=Bearer <your-key>
```

## 市场兼容性

OpenCode 不会直接执行 Claude Code 插件。管理器只安装 OpenCode 可用的部分：

| Claude 插件部分 | OpenCode 支持 |
| --- | --- |
| `.mcp.json` / `mcpServers` | 转换为 OpenCode MCP 配置 |
| `skills/**/SKILL.md` | 安装为 OpenCode 技能 |
| OpenCode 插件仓库 | 添加到 `plugins` |
| 命令、代理、hooks、LSP | 不支持；显示为警告 |

没有有效 YAML frontmatter 的技能会在安装时单独列出。启用 **自动适配** 可添加最小 frontmatter，以文件夹名作为 name，第一行作为 description。

## 配置文件

| 用途 | 路径 |
| --- | --- |
| 全局配置 | `~/.config/opencode/opencode.json` 或 `opencode.jsonc` |
| 项目配置 | 最近的 `.opencode/opencode.json` 或 `opencode.jsonc` |
| 全局技能 | `~/.config/opencode/skills` |
| 项目技能 | `<project>/.opencode/skills` |
| 已禁用技能 | `<skillsDir>/.disabled` |
| 管理器注册表 | `~/.config/opencode/extensions-manager.json` |
| OAuth 令牌 | `~/.local/share/opencode/mcp-auth.json` |

如果 `opencode.json` 和 `opencode.jsonc` 同时存在，管理器会编辑 `opencode.jsonc`，因为 OpenCode 后加载它。

## 开发

```bash
npm install
npm run typecheck          # TypeScript 检查
npm run smoke              # 配置、MCP、插件、技能
npm run smoke:marketplace  # 本地市场安装/更新/移除
npm run build              # 生产 GUI 包
npm run dev                # 监听并重建 GUI
```

修改 GUI 代码后，运行 `npm run build` 并重启 OpenCode Desktop。服务端更改会通过 OpenCode 的文件监视器重新加载，但重启最可靠。

## 限制

- 面向 OpenCode 2.2.x 及其实验性 GUI API。
- OpenCode 不支持 Claude Code 的命令、代理、hooks 和 LSP 服务器。
- 获取市场插件树时受 GitHub API 速率限制。树缓存五分钟。
- 更新检查使用版本元数据或解析后的 GitHub 提交 SHA；如果本地市场更改了文件但两者都未变化，则会报告为最新。
- 诊断不会自行改写配置，唯一例外是明确执行移除重复插件条目的操作。
- 技能只扫描一层：`<skillsDir>/<id>/SKILL.md` 和 `<skillsDir>/<id>.md`。
- OAuth 浏览器流程由 OpenCode CLI 启动，而不是管理器。
- 市场安装始终是手动的；默认目录中的任何内容都不会自动安装。
- 安装第三方插件和 MCP 服务器会运行第三方代码。安装前请审查来源。

## 贡献

欢迎提交 issue 和 pull request。提交 PR 前请运行 `npm run typecheck`、`npm run smoke` 和 `npm run smoke:marketplace`。

## 许可证

[MIT](LICENSE)

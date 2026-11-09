# OpenCode 扩展管理器

[English](README.md) | [Русский](README.ru.md) | **简体中文** | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [日本語](README.ja.md)

一个 **OpenCode** 桌面 GUI 插件。它在 **设置 → 扩展管理器** 中新增页面，用来管理 MCP 服务器、插件、技能和插件市场，无需手动编辑 `opencode.json`。

> 状态：实验性。面向 OpenCode Desktop **2.2.x** 和实验性的 `./gui-experimental` 插件 API。

## 功能

- **MCP 服务器**
  - 本地服务器：命令、工作目录和环境变量。
  - 远程服务器：URL、请求头和 OAuth 配置。
  - 启用/禁用，无需删除条目。
  - 运行状态：已连接、启动中、已禁用、失败、需要登录。
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
  - 英语、俄语、简体中文、西班牙语、法语、德语和日语界面。
  - 其他语言回退到英语。
- **自动兼容修复**
  - 从远程 MCP URL 中移除 Claude 专用的 `?client=claude-…` 参数。
  - 扫描技能时忽略 `README.md` 等文档。
  - 可为缺少 frontmatter 的技能添加最小 YAML frontmatter。

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
- 技能只扫描一层：`<skillsDir>/<id>/SKILL.md` 和 `<skillsDir>/<id>.md`。
- OAuth 浏览器流程由 OpenCode CLI 启动，而不是管理器。
- 市场安装始终是手动的；默认目录中的任何内容都不会自动安装。
- 安装第三方插件和 MCP 服务器会运行第三方代码。安装前请审查来源。

## 贡献

欢迎提交 issue 和 pull request。提交 PR 前请运行 `npm run typecheck`、`npm run smoke` 和 `npm run smoke:marketplace`。

## 许可证

[MIT](LICENSE)

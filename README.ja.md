# OpenCode Extensions Manager

[English](README.md) | [Русский](README.ru.md) | [简体中文](README.zh.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | **日本語**

**OpenCode** 用のデスクトップ GUI プラグインです。**設定 → 拡張機能マネージャー** ページを追加し、`opencode.json` を手で編集せずに MCP サーバー、プラグイン、スキル、プラグインマーケットプレイスを管理できます。

> ステータス: 実験的。OpenCode Desktop **2.2.x** と実験的な `./gui-experimental` プラグイン API 向けです。

## 機能

- **MCP サーバー**
  - ローカルサーバー: コマンド、作業ディレクトリ、環境変数。
  - リモートサーバー: URL、ヘッダー、OAuth 設定。
  - エントリを削除せずに有効/無効を切り替え。
  - 実行状態: 接続済み、起動中、無効、失敗、サインインが必要。
- **プラグイン**
  - npm パッケージ。
  - ローカルプラグインフォルダー。
  - プラグインごとの JSON オプション。
  - `-package` 削除ディレクティブ。
- **スキル**
  - フォルダースキル: `<skillsDir>/<id>/SKILL.md`。
  - 単一ファイルスキル: `<skillsDir>/<id>.md`。
  - 全文エディター、名前変更、有効/無効。
- **プラグインマーケットプレイス**
  - 組み込みの Anthropic マーケットプレイスカタログ: `anthropics/claude-plugins-official`。
  - そこから自動でインストールされることはありません。
  - GitHub URL、`owner/repo`、ローカルフォルダーでマーケットプレイスを追加。
  - カタログ検索、インストール、更新、有効/無効、削除。
  - Claude Code プラグインの互換部分を自動抽出:
    - `.mcp.json` / `mcpServers` から MCP サーバー。
    - `skills/**/SKILL.md` からスキル。
    - リポジトリ自体が OpenCode プラグインの場合は OpenCode プラグイン。
    - Claude のコマンド、エージェント、フック、LSP サーバーは未対応として表示。
- **グローバル/プロジェクトスコープ**
  - グローバル: `~/.config/opencode`。
  - プロジェクト: 最も近い `.opencode` ディレクトリ。フォルダー選択付き。
- **安全な JSONC 書き込み**
  - コメントと書式を保持。
  - アトミック書き込み。
  - 変更前に `.bak` バックアップ。
  - 無効な JSONC はファイルを壊さず書き込みをブロック。
- **ローカライズ**
  - 英語、ロシア語、簡体字中国語、スペイン語、フランス語、ドイツ語、日本語の UI。
  - その他の言語は英語にフォールバック。
- **自動互換修正**
  - リモート MCP URL から Claude 固有の `?client=claude-…` パラメータを除去。
  - スキル走査時に `README.md` などのドキュメントを無視。
  - 必要なスキルに最小限の YAML frontmatter を追加可能。

## 要件

- **OpenCode Desktop 2.2.x**
- **Node.js 22+**（ビルドまたはソースから実行する場合のみ）
- Windows、macOS、Linux

## インストール

### ソースから

1. リポジトリをクローン:

   ```bash
   git clone https://github.com/IWatman/opencode-extensions-manager.git
   cd opencode-extensions-manager
   ```

2. 依存関係をインストールし、GUI バンドルをビルド:

   ```bash
   npm install
   npm run build
   ```

3. グローバル OpenCode 設定に絶対パスを追加。

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

4. OpenCode Desktop を再起動。

5. **設定 → 拡張機能マネージャー** を開く。コマンドパレットからも開けます。

### GitHub から（実験的）

OpenCode ビルドが `plugins` の Git パッケージ指定に対応している場合:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:IWatman/opencode-extensions-manager"]
}
```

リポジトリにはビルド済み GUI バンドル `dist/gui-experimental.cjs` が含まれます。GUI ページが表示されない場合は、リポジトリをクローンしてローカルでビルドしてください。

## 使い方

### スコープ

スコープセレクターで変更の保存先を選びます:

- **グローバル** — すべてのプロジェクトに適用。
- **プロジェクト** — 選択したフォルダーだけに適用。

プロジェクトスコープは OpenCode 本体の設定探索と同じく、最も近い `.opencode` ディレクトリを使用します。存在しない場合は最初の書き込み時に作成されます。

### MCP サーバー

- ローカルまたはリモートサーバーを追加。
- 名前、種類、コマンド/URL、環境変数、ヘッダー、OAuth 設定を編集。
- 削除せずにサーバーを有効/無効に切り替え。
- リモートサーバーが認証を求める場合は、**サインイン** を使うか、コピーしたコマンドをターミナルで実行。

### プラグイン

- npm パッケージまたはローカルプラグインフォルダーを追加。
- プラグインに JSON オプションを渡す。
- `-package` エントリで自動検出されたプラグインを削除。

### スキル

- `SKILL.md` ファイルを作成・編集。
- スキルのフォルダー名を変更。
- スキルを無効化: `<skillsDir>/.disabled` に移動され、OpenCode では無視されます。

### マーケットプレイス

1. **プラグインマーケットプレイス** セクションを開く。
2. 公式 Anthropic カタログがすでに一覧にあります。
3. **カタログ** をクリックして閲覧。
4. 検索でプラグインを探す。
5. **インストール** をクリックし、互換部分を確認。

マーケットプレイスのメタデータとインストール記録は次に保存されます:

```text
~/.config/opencode/extensions-manager.json
```

マーケットプレイスのプラグインをアンインストールすると、マネージャーが追加した MCP サーバー、スキル、プラグインエントリだけが削除されます。

## MCP OAuth

OAuth のブラウザーフローは OpenCode が実行します。マネージャーは設定を準備し、コマンドをコピーします:

```bash
opencode mcp auth <server-name>
```

便利なコマンド:

```bash
opencode mcp list
opencode mcp logout <server-name>
```

MCP エディターの OAuth モード:

- **自動** — `oauth` フィールドなし。OpenCode が動的クライアント登録を使用。
- **カスタム OAuth クライアント** — `client_id`、`client_secret`、`scope`、`callback_port`、`redirect_uri`、`auth_server_metadata_url` を設定。
- **無効** — API キーやカスタムヘッダーを使うサーバー向けに `oauth: false` を書き込み。

OAuth トークンは OpenCode により次に保存されます:

```text
~/.local/share/opencode/mcp-auth.json
```

OpenCode の GUI API には MCP 認証呼び出しがないため、マネージャー自身はブラウザーを開けません。代わりに正確な CLI コマンドをコピーします。

### Context7

Anthropic マーケットプレイスには Context7 プラグインがあります。インストールするとリモート MCP が追加されます:

```text
https://mcp.context7.com/mcp
```

Context7 は匿名で利用できます。レート制限を上げるには [context7.com/dashboard](https://context7.com/dashboard) で無料 API キーを取得し、ヘッダーを使用します:

```text
CONTEXT7_API_KEY={env:CONTEXT7_API_KEY}
```

または:

```text
Authorization=Bearer <your-key>
```

## マーケットプレイスの互換性

OpenCode は Claude Code プラグインを直接実行しません。マネージャーは OpenCode が利用できる部分だけをインストールします:

| Claude プラグインの部分 | OpenCode の対応 |
| --- | --- |
| `.mcp.json` / `mcpServers` | OpenCode の MCP 設定に変換 |
| `skills/**/SKILL.md` | OpenCode スキルとしてインストール |
| OpenCode プラグインリポジトリ | `plugins` に追加 |
| コマンド、エージェント、フック、LSP | 未対応。警告として表示 |

有効な YAML frontmatter がないスキルはインストール時に別途表示されます。**自動適応** を有効にすると、フォルダー名を name、最初の行を description とする最小限の frontmatter が追加されます。

## 設定ファイル

| 用途 | パス |
| --- | --- |
| グローバル設定 | `~/.config/opencode/opencode.json` または `opencode.jsonc` |
| プロジェクト設定 | 最も近い `.opencode/opencode.json` または `opencode.jsonc` |
| グローバルスキル | `~/.config/opencode/skills` |
| プロジェクトスキル | `<project>/.opencode/skills` |
| 無効なスキル | `<skillsDir>/.disabled` |
| マネージャーレジストリ | `~/.config/opencode/extensions-manager.json` |
| OAuth トークン | `~/.local/share/opencode/mcp-auth.json` |

`opencode.json` と `opencode.jsonc` の両方がある場合、OpenCode が後に読み込む `opencode.jsonc` を編集します。

## 開発

```bash
npm install
npm run typecheck          # TypeScript チェック
npm run smoke              # 設定、MCP、プラグイン、スキル
npm run smoke:marketplace  # ローカルマーケットプレイスのインストール/更新/削除
npm run build              # 本番 GUI バンドル
npm run dev                # ウォッチモードで GUI を再ビルド
```

GUI コードを変更したら `npm run build` を実行し、OpenCode Desktop を再起動してください。サーバー側の変更は OpenCode のウォッチャーで再読み込みされますが、再起動が最も確実です。

## 制限事項

- OpenCode 2.2.x と実験的な GUI API 向け。
- Claude Code のコマンド、エージェント、フック、LSP サーバーは OpenCode では未対応。
- マーケットプレイスのプラグインツリー取得時には GitHub API のレート制限が適用されます。ツリーは 5 分間キャッシュされます。
- スキルは 1 階層だけ走査します: `<skillsDir>/<id>/SKILL.md` と `<skillsDir>/<id>.md`。
- OAuth のブラウザーフローはマネージャーではなく OpenCode CLI が開始します。
- マーケットプレイスからのインストールは常に手動です。デフォルトカタログから自動インストールされることはありません。
- サードパーティのプラグインや MCP サーバーをインストールすると、サードパーティのコードが実行されます。インストール前にソースを確認してください。

## コントリビュート

Issue と Pull Request を歓迎します。PR を送る前に `npm run typecheck`、`npm run smoke`、`npm run smoke:marketplace` を実行してください。

## ライセンス

[MIT](LICENSE)

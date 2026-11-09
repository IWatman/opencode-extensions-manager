# OpenCode Extensions Manager

[English](README.md) | [Русский](README.ru.md) | [简体中文](README.zh.md) | [Español](README.es.md) | [Français](README.fr.md) | **Deutsch** | [日本語](README.ja.md) | 繁體中文 | 한국어 | Italiano | Polski | Türkçe | Українська

Ein Desktop-GUI-Plugin für **OpenCode**, das eine Seite **Einstellungen → Erweiterungsmanager** hinzufügt. Damit lassen sich MCP-Server, Plugins, Skills und Plugin-Marktplätze verwalten, ohne `opencode.json` von Hand zu bearbeiten.

> Status: experimentell. Entwickelt für OpenCode Desktop **2.2.x** und die experimentelle Plugin-API `./gui-experimental`.

## Funktionen

- **MCP-Server**
  - Lokale Server mit Befehl, Arbeitsverzeichnis und Umgebungsvariablen.
  - Entfernte Server mit URL, Headern und OAuth-Konfiguration.
  - Aktivieren/Deaktivieren, ohne den Eintrag zu löschen.
  - Laufzeitstatus: verbunden, startet, deaktiviert, fehlgeschlagen, Anmeldung erforderlich.
- **Plugins**
  - npm-Pakete.
  - Lokale Plugin-Ordner.
  - JSON-Optionen pro Plugin.
  - `-package`-Entfernungsdirektiven.
- **Skills**
  - Ordner-Skills: `<skillsDir>/<id>/SKILL.md`.
  - Einzeldatei-Skills: `<skillsDir>/<id>.md`.
  - Volltext-Editor, Umbenennen, Aktivieren/Deaktivieren.
- **Plugin-Marktplätze**
  - Integrierter Anthropic-Marktplatzkatalog: `anthropics/claude-plugins-official`.
  - Daraus wird nichts automatisch installiert.
  - Weitere Marktplätze per GitHub-URL, `owner/repo` oder lokalem Ordner hinzufügen.
  - Katalog durchsuchen, Plugins installieren, aktualisieren, aktivieren/deaktivieren und entfernen.
  - Automatische Kompatibilitätsextraktion für Claude-Code-Plugins:
    - MCP-Server aus `.mcp.json` / `mcpServers`.
    - Skills aus `skills/**/SKILL.md`.
    - OpenCode-Plugins, wenn das Repository selbst ein OpenCode-Plugin ist.
    - Claude-Befehle, Agenten, Hooks und LSP-Server werden als nicht unterstützt gemeldet.
- **Globale und Projekt-Bereiche**
  - Global: `~/.config/opencode`.
  - Projekt: der nächstgelegene `.opencode`-Ordner, mit Ordnerauswahl.
- **Sichere JSONC-Schreibvorgänge**
  - Kommentare und Formatierung bleiben erhalten.
  - Atomare Schreibvorgänge.
  - `.bak`-Sicherung vor jeder Änderung.
  - Ungültiges JSONC blockiert Schreibvorgänge, statt die Datei zu beschädigen.
- **Lokalisierung**
  - Oberfläche auf Englisch, Russisch, vereinfachtem und traditionellem Chinesisch, Spanisch, Französisch, Deutsch, Japanisch, Koreanisch, Italienisch, Polnisch, Türkisch und Ukrainisch.
  - Andere Sprachen verwenden Englisch als Fallback.
  - Übersetzte READMEs gibt es für Englisch, Russisch, vereinfachtes Chinesisch, Spanisch, Französisch, Deutsch und Japanisch; die anderen UI-Sprachen sind noch nicht übersetzt.
- **Automatische Kompatibilitätskorrekturen**
  - Entfernt Claude-spezifische `?client=claude-…`-Parameter aus entfernten MCP-URLs.
  - Ignoriert Dokumente wie `README.md` beim Scannen von Skills.
  - Kann Skills, denen es fehlt, ein minimales YAML-Frontmatter hinzufügen.
- **Aus Claude Code importieren**
  - Durchsucht den Plugin-Cache von Claude Code und zeigt eine Vorschau der MCP-Server, Skills, OpenCode-Plugins und nicht unterstützten Teile.
  - Quellordner werden nur gelesen; der Import nutzt denselben transaktionalen Installationspfad und dieselben Eigentums-Fingerabdrücke wie Marktplatz-Plugins.
- **Update-Center**
  - Prüft alle installierten Marktplatz-Plugins gegen ihre Marktplatzquelle.
  - Aktualisiert alle veralteten Plugins in einem Durchgang; ein Fehler stoppt die übrigen nicht, und die Ergebnisse werden pro Plugin angezeigt.
- **Diagnose**
  - Prüft ungültiges JSONC und Parse-Fehler, doppelte MCP-Namen über Bereiche hinweg, doppelte Plugin-Einträge, ungültige oder nicht lesbare MCP- und Plugin-Einträge, fehlgeschlagene MCP-Server oder solche mit Anmeldebedarf, fehlende Konfigurationsdateien sowie fehlende oder nicht lesbare Skill-Ordner.
  - Bietet nur sichere Aktionen: Prüfungen starten, Pfade anzeigen, fehlgeschlagene MCP-Server erneut versuchen, Anmeldebefehle kopieren und doppelte Plugin-Einträge nach Bestätigung entfernen.
  - Schreibt die Konfiguration nie von selbst um.

## Voraussetzungen

- **OpenCode Desktop 2.2.x**
- **Node.js 22+** (nur zum Bauen oder Ausführen aus dem Quellcode)
- Windows, macOS oder Linux

## Installation

### Aus dem Quellcode

1. Repository klonen:

   ```bash
   git clone https://github.com/IWatman/opencode-extensions-manager.git
   cd opencode-extensions-manager
   ```

2. Abhängigkeiten installieren und GUI-Paket bauen:

   ```bash
   npm install
   npm run build
   ```

3. Den absoluten Pfad zur globalen OpenCode-Konfiguration hinzufügen.

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

4. OpenCode Desktop neu starten.

5. **Einstellungen → Erweiterungsmanager** öffnen. Die Seite ist auch über die Befehlspalette erreichbar.

### Von GitHub (experimentell)

Wenn dein OpenCode-Build Git-Paketspezifikationen in `plugins` unterstützt:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:IWatman/opencode-extensions-manager"]
}
```

Das Repository enthält das vorgebaute GUI-Paket unter `dist/gui-experimental.cjs`. Wenn die GUI-Seite nicht erscheint, klone das Repository und baue es lokal.

## Verwendung

### Bereich

Mit der Bereichsauswahl legst du fest, wohin Änderungen geschrieben werden:

- **Global** — gilt für jedes Projekt.
- **Projekt** — gilt nur für den ausgewählten Ordner.

Der Projektbereich verwendet den nächstgelegenen `.opencode`-Ordner, genau wie die Konfigurationserkennung von OpenCode. Existiert keiner, wird er beim ersten Schreiben erstellt.

### MCP-Server

- Lokale oder entfernte Server hinzufügen.
- Name, Typ, Befehl/URL, Umgebungsvariablen, Header und OAuth-Einstellungen bearbeiten.
- Server aktivieren/deaktivieren, ohne ihn zu löschen.
- Wenn ein entfernter Server eine Authentifizierung benötigt, **Anmelden** verwenden oder den kopierten Befehl im Terminal ausführen.

### Plugins

- npm-Pakete oder lokale Plugin-Ordner hinzufügen.
- JSON-Optionen an ein Plugin übergeben.
- Einen `-package`-Eintrag verwenden, um ein automatisch erkanntes Plugin zu entfernen.

### Skills

- `SKILL.md`-Dateien erstellen und bearbeiten.
- Einen Skill-Ordner umbenennen.
- Einen Skill deaktivieren: Er wird nach `<skillsDir>/.disabled` verschoben und von OpenCode ignoriert.

### Marktplätze

1. Den Abschnitt **Plugin-Marktplätze** öffnen.
2. Der offizielle Anthropic-Katalog ist bereits aufgeführt.
3. Auf **Katalog** klicken, um ihn zu durchsuchen.
4. Mit der Suche ein Plugin finden.
5. Auf **Installieren** klicken und die kompatiblen Teile bestätigen.

Marktplatz-Metadaten und Installationsdatensätze werden gespeichert unter:

```text
~/.config/opencode/extensions-manager.json
```

Beim Deinstallieren eines Marktplatz-Plugins werden nur die MCP-Server, Skills und Plugin-Einträge entfernt, die der Manager hinzugefügt hat.

### Aus Claude Code importieren

Der Manager kann den Plugin-Cache von Claude Code (`~/.claude/plugins/cache` oder `$CLAUDE_CONFIG_DIR/plugins/cache`) durchsuchen und kompatible Teile in der Vorschau anzeigen, bevor etwas installiert wird.

1. **Aus Claude Code importieren** öffnen. Der Abschnitt durchsucht den Cache beim Öffnen; **Erneut durchsuchen** aktualisiert die Liste.
2. Jedes zwischengespeicherte Plugin prüfen: MCP-Server, Skills, OpenCode-Plugins und nicht unterstützte Claude Code-Teile. Für jeden Kandidaten wird der Quellpfad angezeigt.
3. Die zu importierenden Plugins auswählen und bestätigen. Quellordner werden nur gelesen.
4. Optional: **Skills ohne Frontmatter anpassen** aktivieren, um Skills, die es benötigen, ein minimales YAML-Frontmatter hinzuzufügen.

Importe nutzen denselben transaktionalen Installationspfad und dieselben Eigentums-Fingerabdrücke wie Marktplatz-Plugins. Deinstallieren und Deaktivieren entfernen daher nur Artefakte, die noch dem installierten Stand entsprechen.

### Update-Center

Das **Update-Center** prüft alle installierten Marktplatz-Plugins gegen ihre Marktplatzquelle.

1. **Nach Updates suchen** anklicken.
2. Veraltete Plugins mit ihren aktuellen und neuesten Versionen oder Commits prüfen, sofern verfügbar.
3. **Alle veralteten aktualisieren** anklicken, um sie in einem Durchgang zu aktualisieren. Jedes Plugin wird unabhängig aktualisiert; ein Fehler stoppt die übrigen nicht, und die Ergebnisse pro Plugin zeigen Erfolge, Fehler und beibehaltene Artefakte, die nicht mehr zum Installations-Fingerabdruck passen.

Einzelne Updates aus der Liste der installierten Plugins funktionieren weiterhin wie bisher.

### Diagnose

**Diagnose** prüft die aktuelle Konfiguration und meldet Probleme, ohne etwas zu ändern:

- Ungültiges JSONC oder Parse-Fehler sowie nicht lesbare Konfigurationsdateien.
- Konfigurationsdateien, die noch nicht erstellt wurden.
- MCP-Servernamen, die sowohl im globalen als auch im Projekt-Bereich definiert sind.
- Doppelte Plugin-Einträge sowie Plugin-Einträge, die weder ein Paket-String noch ein Paketobjekt sind.
- MCP-Einträge, die weder ein lokaler Befehl noch eine entfernte URL sind, einschließlich lokaler Einträge ohne Befehl und entfernter Einträge ohne URL.
- MCP-Server, deren Laufzeitstatus fehlgeschlagen ist oder die eine Anmeldung erfordern.
- Fehlende oder nicht lesbare Skill-Ordner.

Sichere Aktionen der Diagnose:

- **Prüfungen starten** aktualisiert die Diagnose.
- **Konfigurationsdatei anzeigen**, **Konfigurationsordner anzeigen**, **Skill-Ordner anzeigen** und **Projektordner anzeigen** öffnen die Pfade im Dateimanager.
- **Erneut versuchen** verbindet einen fehlgeschlagenen MCP-Server erneut.
- **Anmelden** kopiert `opencode mcp auth <server>` für Server, die eine Authentifizierung benötigen.
- **#N entfernen** entfernt einen doppelten Plugin-Eintrag über die vorhandene RPC des Managers, nach Bestätigung und mit einer `.bak`-Sicherung.

Die Diagnose schreibt die Konfiguration nie von selbst um. Korrekturen, die eine Bearbeitung der Konfiguration erfordern, etwa doppelte MCP-Namen über Bereiche hinweg, ungültige Einträge oder Berechtigungen des Skill-Ordners, werden nur gemeldet und müssen manuell erledigt werden.

## MCP-OAuth

OpenCode führt den OAuth-Browserablauf aus. Der Manager bereitet die Konfiguration vor und kopiert den Befehl:

```bash
opencode mcp auth <server-name>
```

Nützliche Befehle:

```bash
opencode mcp list
opencode mcp logout <server-name>
```

OAuth-Modi im MCP-Editor:

- **Automatisch** — kein `oauth`-Feld; OpenCode verwendet die dynamische Client-Registrierung.
- **Eigener OAuth-Client** — `client_id`, `client_secret`, `scope`, `callback_port`, `redirect_uri` und `auth_server_metadata_url` setzen.
- **Deaktiviert** — schreibt `oauth: false`, für Server mit API-Schlüssel oder eigenen Headern.

OAuth-Token speichert OpenCode unter:

```text
~/.local/share/opencode/mcp-auth.json
```

Der Manager kann den Browser nicht selbst öffnen, da die OpenCode-GUI-API keinen MCP-Authentifizierungsaufruf bereitstellt. Stattdessen kopiert er den exakten CLI-Befehl.

### Context7

Der Anthropic-Marktplatz enthält ein Context7-Plugin. Die Installation fügt den entfernten MCP hinzu:

```text
https://mcp.context7.com/mcp
```

Context7 funktioniert anonym. Für höhere Ratenlimits hol dir einen kostenlosen API-Schlüssel auf [context7.com/dashboard](https://context7.com/dashboard) und verwende einen Header:

```text
CONTEXT7_API_KEY={env:CONTEXT7_API_KEY}
```

oder:

```text
Authorization=Bearer <your-key>
```

## Marktplatz-Kompatibilität

Claude-Code-Plugins werden von OpenCode nicht direkt ausgeführt. Der Manager installiert die Teile, die OpenCode verwenden kann:

| Claude-Plugin-Teil | OpenCode-Unterstützung |
| --- | --- |
| `.mcp.json` / `mcpServers` | Wird in OpenCode-MCP-Konfiguration umgewandelt |
| `skills/**/SKILL.md` | Wird als OpenCode-Skill installiert |
| OpenCode-Plugin-Repository | Wird zu `plugins` hinzugefügt |
| Befehle, Agenten, Hooks, LSP | Nicht unterstützt; wird als Warnung angezeigt |

Skills ohne gültiges YAML-Frontmatter werden während der Installation separat aufgeführt. Aktiviere **Automatisch anpassen**, um ein minimales Frontmatter mit dem Ordnernamen als Name und der ersten Zeile als Beschreibung hinzuzufügen.

## Konfigurationsdateien

| Zweck | Pfad |
| --- | --- |
| Globale Konfiguration | `~/.config/opencode/opencode.json` oder `opencode.jsonc` |
| Projektkonfiguration | nächstgelegene `.opencode/opencode.json` oder `opencode.jsonc` |
| Globale Skills | `~/.config/opencode/skills` |
| Projekt-Skills | `<project>/.opencode/skills` |
| Deaktivierte Skills | `<skillsDir>/.disabled` |
| Manager-Registry | `~/.config/opencode/extensions-manager.json` |
| OAuth-Token | `~/.local/share/opencode/mcp-auth.json` |

Wenn sowohl `opencode.json` als auch `opencode.jsonc` existieren, bearbeitet der Manager `opencode.jsonc`, weil OpenCode es später lädt.

## Entwicklung

```bash
npm install
npm run typecheck          # TypeScript-Prüfungen
npm run smoke              # Konfiguration, MCP, Plugins, Skills
npm run smoke:marketplace  # Lokalen Marktplatz installieren/aktualisieren/entfernen
npm run build              # Produktions-GUI-Paket
npm run dev                # GUI im Watch-Modus neu bauen
```

Nach Änderungen am GUI-Code `npm run build` ausführen und OpenCode Desktop neu starten. Serverseitige Änderungen werden vom OpenCode-Watcher neu geladen, aber ein Neustart ist zuverlässiger.

## Einschränkungen

- Entwickelt für OpenCode 2.2.x und seine experimentelle GUI-API.
- Claude-Code-Befehle, -Agenten, -Hooks und -LSP-Server werden von OpenCode nicht unterstützt.
- Beim Abrufen von Plugin-Bäumen aus Marktplätzen gelten GitHub-API-Ratenlimits. Bäume werden fünf Minuten lang zwischengespeichert.
- Update-Prüfungen verwenden Versionsmetadaten oder aufgelöste GitHub-Commit-SHAs. Ein lokaler Marktplatz, der Dateien ändert, ohne eines von beiden zu ändern, wird als aktuell gemeldet.
- Die Diagnose schreibt die Konfiguration nicht von selbst um, außer bei der ausdrücklichen Aktion zum Entfernen eines doppelten Plugin-Eintrags.
- Skills werden eine Ebene tief gescannt: `<skillsDir>/<id>/SKILL.md` und `<skillsDir>/<id>.md`.
- Der OAuth-Browserablauf wird von der OpenCode-CLI gestartet, nicht vom Manager.
- Marktplatz-Installationen sind immer manuell; nichts aus dem Standardkatalog wird automatisch installiert.
- Die Installation von Plugins und MCP-Servern Dritter führt fremden Code aus. Prüfe die Quelle vor der Installation.

## Mitwirken

Issues und Pull Requests sind willkommen. Bitte vor dem Einreichen eines PR `npm run typecheck`, `npm run smoke` und `npm run smoke:marketplace` ausführen.

## Lizenz

[MIT](LICENSE)

# OpenCode Extensions Manager

[English](README.md) | [Русский](README.ru.md) | [简体中文](README.zh.md) | [Español](README.es.md) | **Français** | [Deutsch](README.de.md) | [日本語](README.ja.md)

Plugin GUI de bureau pour **OpenCode** qui ajoute une page **Paramètres → Gestionnaire d’extensions** pour gérer les serveurs MCP, plugins, skills et places de marché de plugins sans modifier `opencode.json` à la main.

> Statut : expérimental. Conçu pour OpenCode Desktop **2.2.x** et l’API expérimentale de plugins `./gui-experimental`.

## Fonctionnalités

- **Serveurs MCP**
  - Serveurs locaux avec commande, répertoire de travail et variables d’environnement.
  - Serveurs distants avec URL, en-têtes et configuration OAuth.
  - Activer/désactiver sans supprimer l’entrée.
  - Statut d’exécution : connecté, démarrage, désactivé, échec, connexion requise.
- **Plugins**
  - Paquets npm.
  - Dossiers de plugins locaux.
  - Options JSON par plugin.
  - Directives de suppression `-package`.
- **Skills**
  - Skills en dossier : `<skillsDir>/<id>/SKILL.md`.
  - Skills en fichier unique : `<skillsDir>/<id>.md`.
  - Éditeur plein texte, renommage, activation/désactivation.
- **Places de marché de plugins**
  - Catalogue intégré de la place de marché Anthropic : `anthropics/claude-plugins-official`.
  - Rien n’est installé automatiquement depuis ce catalogue.
  - Ajoutez d’autres places de marché par URL GitHub, `owner/repo` ou dossier local.
  - Recherchez dans le catalogue, installez, mettez à jour, activez/désactivez et supprimez des plugins.
  - Extraction automatique de compatibilité pour les plugins Claude Code :
    - Serveurs MCP depuis `.mcp.json` / `mcpServers`.
    - Skills depuis `skills/**/SKILL.md`.
    - Plugins OpenCode lorsque le dépôt est lui-même un plugin OpenCode.
    - Les commandes, agents, hooks et serveurs LSP Claude sont signalés comme non pris en charge.
- **Portées globale et projet**
  - Globale : `~/.config/opencode`.
  - Projet : le dossier `.opencode` le plus proche, avec un sélecteur de dossier.
- **Écritures JSONC sûres**
  - Les commentaires et le formatage sont conservés.
  - Écritures atomiques.
  - Sauvegarde `.bak` avant chaque modification.
  - Un JSONC invalide bloque l’écriture au lieu de corrompre le fichier.
- **Localisation**
  - Interface en anglais, russe, chinois simplifié, espagnol, français, allemand et japonais.
  - Les autres langues utilisent l’anglais en secours.
- **Corrections de compatibilité automatiques**
  - Supprime les paramètres `?client=claude-…` propres à Claude des URL MCP distantes.
  - Ignore les documents comme `README.md` lors de l’analyse des skills.
  - Peut ajouter un frontmatter YAML minimal aux skills qui en ont besoin.

## Prérequis

- **OpenCode Desktop 2.2.x**
- **Node.js 22+** (uniquement pour compiler ou exécuter depuis les sources)
- Windows, macOS ou Linux

## Installation

### Depuis les sources

1. Clonez le dépôt :

   ```bash
   git clone https://github.com/IWatman/opencode-extensions-manager.git
   cd opencode-extensions-manager
   ```

2. Installez les dépendances et compilez le paquet GUI :

   ```bash
   npm install
   npm run build
   ```

3. Ajoutez le chemin absolu à votre configuration OpenCode globale.

   **Windows** — `C:\Users\<you>\.config\opencode\opencode.json` :

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": [
       "C:\\Users\\<you>\\Documents\\opencode-extensions-manager"
     ]
   }
   ```

   **macOS / Linux** — `~/.config/opencode/opencode.json` :

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": [
       "/absolute/path/to/opencode-extensions-manager"
     ]
   }
   ```

4. Redémarrez OpenCode Desktop.

5. Ouvrez **Paramètres → Gestionnaire d’extensions**. La page est aussi accessible depuis la palette de commandes.

### Depuis GitHub (expérimental)

Si votre version d’OpenCode prend en charge les spécifications de paquets Git dans `plugins` :

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:IWatman/opencode-extensions-manager"]
}
```

Le dépôt contient le paquet GUI précompilé dans `dist/gui-experimental.cjs`. Si la page GUI n’apparaît pas, clonez le dépôt et compilez-le localement.

## Utilisation

### Portée

Utilisez le sélecteur de portée pour choisir où les modifications sont écrites :

- **Globale** — s’applique à tous les projets.
- **Projet** — s’applique uniquement au dossier sélectionné.

La portée projet utilise le dossier `.opencode` le plus proche, comme la découverte de configuration d’OpenCode. S’il n’existe pas, il est créé à la première écriture.

### Serveurs MCP

- Ajoutez des serveurs locaux ou distants.
- Modifiez le nom, le type, la commande/URL, les variables d’environnement, les en-têtes et les réglages OAuth.
- Activez ou désactivez un serveur sans le supprimer.
- Si un serveur distant demande une authentification, utilisez **Se connecter** ou exécutez la commande copiée dans un terminal.

### Plugins

- Ajoutez des paquets npm ou des dossiers de plugins locaux.
- Transmettez des options JSON à un plugin.
- Utilisez une entrée `-package` pour supprimer un plugin détecté automatiquement.

### Skills

- Créez et modifiez des fichiers `SKILL.md`.
- Renommez le dossier d’un skill.
- Désactivez un skill : il est déplacé vers `<skillsDir>/.disabled` et ignoré par OpenCode.

### Places de marché

1. Ouvrez la section **Places de marché de plugins**.
2. Le catalogue officiel Anthropic est déjà listé.
3. Cliquez sur **Catalogue** pour le parcourir.
4. Utilisez la recherche pour trouver un plugin.
5. Cliquez sur **Installer** et confirmez les parties compatibles.

Les métadonnées des places de marché et les enregistrements d’installation sont stockés dans :

```text
~/.config/opencode/extensions-manager.json
```

La désinstallation d’un plugin de place de marché ne supprime que les serveurs MCP, skills et entrées de plugins ajoutés par le gestionnaire.

## OAuth MCP

OpenCode effectue le flux OAuth dans le navigateur. Le gestionnaire prépare la configuration et copie la commande :

```bash
opencode mcp auth <server-name>
```

Commandes utiles :

```bash
opencode mcp list
opencode mcp logout <server-name>
```

Modes OAuth de l’éditeur MCP :

- **Automatique** — aucun champ `oauth` ; OpenCode utilise l’enregistrement dynamique du client.
- **Client OAuth personnalisé** — définissez `client_id`, `client_secret`, `scope`, `callback_port`, `redirect_uri` et `auth_server_metadata_url`.
- **Désactivé** — écrit `oauth: false`, pour les serveurs qui utilisent une clé API ou des en-têtes personnalisés.

Les jetons OAuth sont stockés par OpenCode dans :

```text
~/.local/share/opencode/mcp-auth.json
```

Le gestionnaire ne peut pas ouvrir le navigateur lui-même car l’API GUI d’OpenCode n’expose pas d’appel d’authentification MCP. Il copie à la place la commande CLI exacte.

### Context7

La place de marché Anthropic contient un plugin Context7. L’installer ajoute le MCP distant :

```text
https://mcp.context7.com/mcp
```

Context7 fonctionne anonymement. Pour des limites de débit plus élevées, obtenez une clé API gratuite sur [context7.com/dashboard](https://context7.com/dashboard) et utilisez un en-tête :

```text
CONTEXT7_API_KEY={env:CONTEXT7_API_KEY}
```

ou :

```text
Authorization=Bearer <your-key>
```

## Compatibilité des places de marché

OpenCode n’exécute pas directement les plugins Claude Code. Le gestionnaire installe les parties qu’OpenCode peut utiliser :

| Partie du plugin Claude | Prise en charge OpenCode |
| --- | --- |
| `.mcp.json` / `mcpServers` | Converti en configuration MCP OpenCode |
| `skills/**/SKILL.md` | Installé comme skill OpenCode |
| Dépôt de plugin OpenCode | Ajouté à `plugins` |
| Commandes, agents, hooks, LSP | Non pris en charge ; affiché comme avertissement |

Les skills sans frontmatter YAML valide sont listés séparément pendant l’installation. Activez **Adapter automatiquement** pour ajouter un frontmatter minimal avec le nom du dossier et la première ligne comme description.

## Fichiers de configuration

| Usage | Chemin |
| --- | --- |
| Configuration globale | `~/.config/opencode/opencode.json` ou `opencode.jsonc` |
| Configuration du projet | `.opencode/opencode.json` ou `opencode.jsonc` le plus proche |
| Skills globaux | `~/.config/opencode/skills` |
| Skills du projet | `<project>/.opencode/skills` |
| Skills désactivés | `<skillsDir>/.disabled` |
| Registre du gestionnaire | `~/.config/opencode/extensions-manager.json` |
| Jetons OAuth | `~/.local/share/opencode/mcp-auth.json` |

Si `opencode.json` et `opencode.jsonc` existent tous les deux, le gestionnaire modifie `opencode.jsonc` car OpenCode le charge après.

## Développement

```bash
npm install
npm run typecheck          # Vérifications TypeScript
npm run smoke              # Configuration, MCP, plugins, skills
npm run smoke:marketplace  # Installation/mise à jour/suppression d’une place locale
npm run build              # Paquet GUI de production
npm run dev                # Recompiler la GUI en mode watch
```

Après une modification du code GUI, exécutez `npm run build` et redémarrez OpenCode Desktop. Les changements côté serveur sont rechargés par le watcher d’OpenCode, mais un redémarrage reste plus fiable.

## Limites

- Conçu pour OpenCode 2.2.x et son API GUI expérimentale.
- Les commandes, agents, hooks et serveurs LSP de Claude Code ne sont pas pris en charge par OpenCode.
- Les limites de l’API GitHub s’appliquent lors de la récupération des arbres de plugins. Les arbres sont mis en cache cinq minutes.
- Les skills sont analysés sur un seul niveau : `<skillsDir>/<id>/SKILL.md` et `<skillsDir>/<id>.md`.
- Le flux OAuth navigateur est lancé par la CLI OpenCode, pas par le gestionnaire.
- Les installations depuis les places de marché sont toujours manuelles ; rien du catalogue par défaut n’est installé automatiquement.
- Installer des plugins et serveurs MCP tiers exécute du code tiers. Vérifiez la source avant l’installation.

## Contribution

Les issues et pull requests sont bienvenues. Exécutez `npm run typecheck`, `npm run smoke` et `npm run smoke:marketplace` avant de soumettre une PR.

## Licence

[MIT](LICENSE)

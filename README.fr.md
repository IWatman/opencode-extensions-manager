# OpenCode Extensions Manager

[English](README.md) | [Русский](README.ru.md) | [简体中文](README.zh.md) | [Español](README.es.md) | **Français** | [Deutsch](README.de.md) | [日本語](README.ja.md) | 繁體中文 | 한국어 | Italiano | Polski | Türkçe | Українська

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
  - Interface en anglais, russe, chinois simplifié et traditionnel, espagnol, français, allemand, japonais, coréen, italien, polonais, turc et ukrainien.
  - Les autres langues utilisent l’anglais en secours.
  - Les README traduits existent pour l’anglais, le russe, le chinois simplifié, l’espagnol, le français, l’allemand et le japonais ; les autres langues d’interface ne sont pas encore traduites.
- **Corrections de compatibilité automatiques**
  - Supprime les paramètres `?client=claude-…` propres à Claude des URL MCP distantes.
  - Ignore les documents comme `README.md` lors de l’analyse des skills.
  - Peut ajouter un frontmatter YAML minimal aux skills qui en ont besoin.
- **Importer depuis Claude Code**
  - Analyse le cache de plugins de Claude Code et prévisualise les serveurs MCP, skills, plugins OpenCode et parties non prises en charge.
  - Les dossiers sources sont uniquement lus ; l’import utilise le même chemin d’installation transactionnel et les mêmes empreintes de propriété que les plugins de place de marché.
- **Centre de mises à jour**
  - Vérifie tous les plugins de place de marché installés par rapport à leur source.
  - Met à jour en lot tous les plugins obsolètes ; un échec n’interrompt pas les autres et les résultats sont affichés par plugin.
- **Diagnostic**
  - Vérifie le JSONC invalide et les erreurs d’analyse, les noms MCP en double entre portées, les entrées de plugin en double, les entrées MCP et de plugin invalides ou illisibles, les serveurs MCP en échec ou nécessitant une connexion, les fichiers de configuration manquants et les dossiers de skills manquants ou illisibles.
  - Ne propose que des actions sûres : lancer les vérifications, révéler les chemins, réessayer les serveurs MCP en échec, copier les commandes de connexion et supprimer les entrées de plugin en double avec confirmation.
  - Ne réécrit jamais la configuration de lui-même.

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

### Importer depuis Claude Code

Le gestionnaire peut analyser le cache de plugins de Claude Code (`~/.claude/plugins/cache`, ou `$CLAUDE_CONFIG_DIR/plugins/cache`) et prévisualiser les parties compatibles avant toute installation.

1. Ouvrez **Importer depuis Claude Code**. La section analyse le cache à l’ouverture ; cliquez sur **Analyser à nouveau** pour actualiser.
2. Examinez chaque plugin en cache : serveurs MCP, skills, plugins OpenCode et parties de Claude Code non prises en charge. Le chemin source est affiché pour chaque candidat.
3. Sélectionnez les plugins à importer et confirmez. Les dossiers sources sont uniquement lus.
4. Facultatif : activez **Adapter les skills sans frontmatter** pour ajouter un frontmatter YAML minimal aux skills qui en ont besoin.

Les imports utilisent le même chemin d’installation transactionnel et les mêmes empreintes de propriété que les plugins de place de marché ; la désinstallation et la désactivation ne retirent donc que les artefacts qui correspondent encore à ce qui a été installé.

### Centre de mises à jour

Le **Centre de mises à jour** vérifie tous les plugins de place de marché installés par rapport à leur source.

1. Cliquez sur **Rechercher des mises à jour**.
2. Examinez les plugins obsolètes avec leurs versions ou commits actuels et les plus récents lorsqu’ils sont disponibles.
3. Cliquez sur **Mettre à jour tous les obsolètes** pour lancer un lot. Chaque plugin est mis à jour indépendamment ; un échec n’arrête pas les autres, et les résultats par plugin indiquent les réussites, les échecs et les artefacts conservés parce qu’ils ne correspondent plus à l’empreinte d’installation.

Les mises à jour individuelles depuis la liste des plugins installés fonctionnent toujours de la même manière.

### Diagnostic

**Diagnostic** examine la configuration actuelle et signale les problèmes sans rien modifier :

- JSONC invalide ou erreurs d’analyse, et fichiers de configuration illisibles.
- Fichiers de configuration pas encore créés.
- Noms de serveurs MCP définis à la fois dans la portée globale et dans la portée projet.
- Entrées de plugin en double et entrées de plugin qui ne sont ni une chaîne de paquet ni un objet de paquet.
- Entrées MCP qui ne sont ni une commande locale ni une URL distante, y compris les entrées locales sans commande et les entrées distantes sans URL.
- Serveurs MCP dont le statut d’exécution est en échec ou nécessite une connexion.
- Dossiers de skills manquants ou illisibles.

Actions sûres proposées par Diagnostic :

- **Lancer les vérifications** actualise le diagnostic.
- **Afficher le fichier de configuration**, **Afficher le dossier de configuration**, **Afficher le dossier des skills** et **Afficher le dossier du projet** ouvrent les chemins dans le gestionnaire de fichiers.
- **Réessayer** reconnecte un serveur MCP en échec.
- **Se connecter** copie `opencode mcp auth <server>` pour les serveurs qui nécessitent une authentification.
- **Supprimer #N** supprime une entrée de plugin en double via le RPC existant du gestionnaire, après confirmation et avec une sauvegarde `.bak`.

Diagnostic ne réécrit jamais la configuration de lui-même. Les corrections qui nécessitent de modifier la configuration, comme les noms MCP en double entre portées, les entrées invalides ou les permissions du dossier de skills, sont seulement signalées pour que vous les traitiez manuellement.

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
- Les vérifications de mise à jour utilisent les métadonnées de version ou les SHA de commit GitHub résolus ; une place de marché locale qui modifie des fichiers sans changer ni l’un ni l’autre est signalée comme à jour.
- Le diagnostic ne réécrit pas la configuration de lui-même, sauf pour l’action explicite de suppression d’une entrée de plugin en double.
- Les skills sont analysés sur un seul niveau : `<skillsDir>/<id>/SKILL.md` et `<skillsDir>/<id>.md`.
- Le flux OAuth navigateur est lancé par la CLI OpenCode, pas par le gestionnaire.
- Les installations depuis les places de marché sont toujours manuelles ; rien du catalogue par défaut n’est installé automatiquement.
- Installer des plugins et serveurs MCP tiers exécute du code tiers. Vérifiez la source avant l’installation.

## Contribution

Les issues et pull requests sont bienvenues. Exécutez `npm run typecheck`, `npm run smoke` et `npm run smoke:marketplace` avant de soumettre une PR.

## Licence

[MIT](LICENSE)

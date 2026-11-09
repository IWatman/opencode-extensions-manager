# OpenCode Extensions Manager

[English](README.md) | [Русский](README.ru.md) | [简体中文](README.zh.md) | **Español** | [Français](README.fr.md) | [Deutsch](README.de.md) | [日本語](README.ja.md)

Plugin GUI de escritorio para **OpenCode** que añade una página **Ajustes → Gestor de extensiones** para gestionar servidores MCP, plugins, skills y mercados de plugins sin editar `opencode.json` a mano.

> Estado: experimental. Pensado para OpenCode Desktop **2.2.x** y la API experimental de plugins `./gui-experimental`.

## Funciones

- **Servidores MCP**
  - Servidores locales con comando, directorio de trabajo y variables de entorno.
  - Servidores remotos con URL, cabeceras y configuración OAuth.
  - Activar/desactivar sin borrar la entrada.
  - Estado en tiempo de ejecución: conectado, iniciando, desactivado, fallido, inicio de sesión necesario.
- **Plugins**
  - Paquetes npm.
  - Carpetas de plugins locales.
  - Opciones JSON por plugin.
  - Directivas de eliminación `-package`.
- **Skills**
  - Skills de carpeta: `<skillsDir>/<id>/SKILL.md`.
  - Skills de archivo único: `<skillsDir>/<id>.md`.
  - Editor de texto completo, renombrar, activar/desactivar.
- **Mercados de plugins**
  - Catálogo integrado del mercado de Anthropic: `anthropics/claude-plugins-official`.
  - No se instala nada automáticamente desde él.
  - Añade más mercados por URL de GitHub, `owner/repo` o carpeta local.
  - Busca en el catálogo, instala, actualiza, activa/desactiva y elimina plugins.
  - Extracción automática de compatibilidad para plugins de Claude Code:
    - Servidores MCP desde `.mcp.json` / `mcpServers`.
    - Skills desde `skills/**/SKILL.md`.
    - Plugins de OpenCode cuando el repositorio ya es un plugin de OpenCode.
    - Comandos, agentes, hooks y servidores LSP de Claude se muestran como no compatibles.
- **Ámbitos global y de proyecto**
  - Global: `~/.config/opencode`.
  - Proyecto: el directorio `.opencode` más cercano, con selector de carpeta.
- **Escrituras JSONC seguras**
  - Se conservan los comentarios y el formato.
  - Escrituras atómicas.
  - Copia `.bak` antes de cada cambio.
  - Un JSONC no válido bloquea la escritura en lugar de corromper el archivo.
- **Localización**
  - Interfaz en inglés, ruso, chino simplificado, español, francés, alemán y japonés.
  - Otros idiomas usan inglés como fallback.
- **Correcciones de compatibilidad automáticas**
  - Elimina parámetros `?client=claude-…` específicos de Claude de las URL MCP remotas.
  - Ignora documentos como `README.md` al buscar skills.
  - Puede añadir un frontmatter YAML mínimo a las skills que lo necesiten.

## Requisitos

- **OpenCode Desktop 2.2.x**
- **Node.js 22+** (solo para compilar o ejecutar desde el código fuente)
- Windows, macOS o Linux

## Instalación

### Desde el código fuente

1. Clona el repositorio:

   ```bash
   git clone https://github.com/IWatman/opencode-extensions-manager.git
   cd opencode-extensions-manager
   ```

2. Instala las dependencias y compila el paquete GUI:

   ```bash
   npm install
   npm run build
   ```

3. Añade la ruta absoluta a tu configuración global de OpenCode.

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

4. Reinicia OpenCode Desktop.

5. Abre **Ajustes → Gestor de extensiones**. También puedes abrirlo desde la paleta de comandos.

### Desde GitHub (experimental)

Si tu compilación de OpenCode admite especificaciones de paquetes Git en `plugins`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:IWatman/opencode-extensions-manager"]
}
```

El repositorio incluye el paquete GUI precompilado en `dist/gui-experimental.cjs`. Si la página GUI no aparece, clona el repositorio y compílalo localmente.

## Uso

### Ámbito

Usa el selector de ámbito para elegir dónde se escriben los cambios:

- **Global** — se aplica a todos los proyectos.
- **Proyecto** — solo se aplica a la carpeta seleccionada.

El ámbito de proyecto usa el directorio `.opencode` más cercano, igual que el descubrimiento de configuración de OpenCode. Si no existe, se crea en la primera escritura.

### Servidores MCP

- Añade servidores locales o remotos.
- Edita nombre, tipo, comando/URL, variables de entorno, cabeceras y ajustes OAuth.
- Activa o desactiva un servidor sin borrarlo.
- Si un servidor remoto necesita autenticación, usa **Iniciar sesión** o ejecuta el comando copiado en una terminal.

### Plugins

- Añade paquetes npm o carpetas de plugins locales.
- Pasa opciones JSON a un plugin.
- Usa una entrada `-package` para eliminar un plugin detectado automáticamente.

### Skills

- Crea y edita archivos `SKILL.md`.
- Renombra la carpeta de una skill.
- Desactiva una skill: se mueve a `<skillsDir>/.disabled` y OpenCode la ignora.

### Mercados

1. Abre la sección **Mercados de plugins**.
2. El catálogo oficial de Anthropic ya está en la lista.
3. Pulsa **Catálogo** para explorarlo.
4. Usa la búsqueda para encontrar un plugin.
5. Pulsa **Instalar** y confirma las partes compatibles.

Los metadatos del mercado y los registros de instalación se guardan en:

```text
~/.config/opencode/extensions-manager.json
```

Desinstalar un plugin del mercado solo elimina los servidores MCP, skills y entradas de plugins que añadió el gestor.

## OAuth de MCP

OpenCode realiza el flujo OAuth en el navegador. El gestor prepara la configuración y copia el comando:

```bash
opencode mcp auth <server-name>
```

Comandos útiles:

```bash
opencode mcp list
opencode mcp logout <server-name>
```

Modos OAuth del editor MCP:

- **Automático** — sin campo `oauth`; OpenCode usa registro dinámico de clientes.
- **Cliente OAuth personalizado** — configura `client_id`, `client_secret`, `scope`, `callback_port`, `redirect_uri` y `auth_server_metadata_url`.
- **Desactivado** — escribe `oauth: false`, para servidores que usan una clave API o cabeceras personalizadas.

OpenCode guarda los tokens OAuth en:

```text
~/.local/share/opencode/mcp-auth.json
```

El gestor no puede abrir el navegador por sí mismo porque la API GUI de OpenCode no expone una llamada de autenticación MCP. En su lugar copia el comando CLI exacto.

### Context7

El mercado de Anthropic contiene un plugin Context7. Instalarlo añade el MCP remoto:

```text
https://mcp.context7.com/mcp
```

Context7 funciona de forma anónima. Para obtener límites de uso más altos, consigue una clave API gratuita en [context7.com/dashboard](https://context7.com/dashboard) y usa una cabecera:

```text
CONTEXT7_API_KEY={env:CONTEXT7_API_KEY}
```

o:

```text
Authorization=Bearer <your-key>
```

## Compatibilidad de mercados

OpenCode no ejecuta directamente los plugins de Claude Code. El gestor instala las partes que OpenCode puede usar:

| Parte del plugin Claude | Compatibilidad con OpenCode |
| --- | --- |
| `.mcp.json` / `mcpServers` | Se convierte en configuración MCP de OpenCode |
| `skills/**/SKILL.md` | Se instala como skill de OpenCode |
| Repositorio de plugin OpenCode | Se añade a `plugins` |
| Comandos, agentes, hooks, LSP | No compatible; se muestra como advertencia |

Las skills sin un frontmatter YAML válido se listan por separado durante la instalación. Activa **Adaptar automáticamente** para añadir un frontmatter mínimo con el nombre de la carpeta y la primera línea como descripción.

## Archivos de configuración

| Propósito | Ruta |
| --- | --- |
| Configuración global | `~/.config/opencode/opencode.json` u `opencode.jsonc` |
| Configuración del proyecto | `.opencode/opencode.json` u `opencode.jsonc` más cercano |
| Skills globales | `~/.config/opencode/skills` |
| Skills del proyecto | `<project>/.opencode/skills` |
| Skills desactivadas | `<skillsDir>/.disabled` |
| Registro del gestor | `~/.config/opencode/extensions-manager.json` |
| Tokens OAuth | `~/.local/share/opencode/mcp-auth.json` |

Si existen `opencode.json` y `opencode.jsonc`, el gestor edita `opencode.jsonc` porque OpenCode lo carga después.

## Desarrollo

```bash
npm install
npm run typecheck          # Comprobaciones de TypeScript
npm run smoke              # Configuración, MCP, plugins, skills
npm run smoke:marketplace  # Instalar/actualizar/eliminar mercado local
npm run build              # Paquete GUI de producción
npm run dev                # Recompilar GUI en modo watch
```

Después de cambiar el código GUI, ejecuta `npm run build` y reinicia OpenCode Desktop. Los cambios del servidor se recargan con el watcher de OpenCode, pero reiniciar es lo más fiable.

## Limitaciones

- Pensado para OpenCode 2.2.x y su API GUI experimental.
- OpenCode no admite comandos, agentes, hooks ni servidores LSP de Claude Code.
- Se aplican límites de la API de GitHub al obtener árboles de plugins de mercados. Los árboles se cachean cinco minutos.
- Las skills se escanean un nivel: `<skillsDir>/<id>/SKILL.md` y `<skillsDir>/<id>.md`.
- El flujo OAuth del navegador lo inicia la CLI de OpenCode, no el gestor.
- Las instalaciones desde mercados son siempre manuales; nada del catálogo por defecto se instala automáticamente.
- Instalar plugins y servidores MCP de terceros ejecuta código de terceros. Revisa el origen antes de instalar.

## Contribuir

Las issues y pull requests son bienvenidas. Ejecuta `npm run typecheck`, `npm run smoke` y `npm run smoke:marketplace` antes de enviar un PR.

## Licencia

[MIT](LICENSE)

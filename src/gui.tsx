import { Command, Plugin, SettingsPage, Style } from "@opencode/plugin/gui"
import { catalog } from "./gui/i18n"
import { ExtensionsPage } from "./gui/page"
import { styles } from "./gui/styles"

const pageId = "extensions-manager"

export default Plugin.define({
  i18n: catalog,
  setup(ctx) {
    ctx.add(Style, styles)

    ctx.add(SettingsPage, () => ({
      id: pageId,
      title: ctx.t("page.title"),
      icon: "extensions" as const,
      entries: [
        {
          id: pageId,
          title: ctx.t("page.title"),
          description: ctx.t("page.description"),
        },
        {
          id: "oem-scope-config",
          title: ctx.t("scope.configFile"),
          description: ctx.t("scope.configFileHint"),
          keywords: "config opencode.json opencode.jsonc path mcp plugins skills",
        },
        {
          id: "oem-doctor",
          title: ctx.t("doctor.title"),
          description: ctx.t("doctor.description"),
          keywords:
            "doctor diagnostics warnings errors duplicates mcp plugin jsonc parse skills folder failed needs auth",
        },
        {
          id: "oem-claude-cache",
          title: ctx.t("claude.title"),
          description: ctx.t("claude.description"),
          keywords: "claude code import cache plugins skills mcp preview",
        },
        {
          id: "oem-updates-check",
          title: ctx.t("updates.title"),
          description: ctx.t("updates.description"),
          keywords: "updates outdated marketplace batch versions commits",
        },
      ],
      render: () => <ExtensionsPage ctx={ctx} />,
    }))

    ctx.add(Command, () => ({
      id: "open",
      title: ctx.t("page.title"),
      description: ctx.t("page.description"),
      group: ctx.t("command.group"),
      keywords: "extensions mcp plugins skills config",
      run: () => ctx.layout.settings(pageId),
    }))
  },
})

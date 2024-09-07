import type { Denops } from "jsr:@denops/std@^7.1.1";
import { BaseExtension, type Lspoints } from "jsr:@kuuote/lspoints@^0.1.0";
import { type CopilotSettings, isCopilotContext } from "./copilot/types.ts";
import { clearPreview, drawPreview } from "./copilot/preview.ts";
import { suggest, suggestCycling } from "./copilot/sugget.ts";
import { accpet } from "./copilot/accept.ts";
import { assert } from "jsr:@core/unknownutil@^4.3.0";
import { is } from "jsr:@core/unknownutil@^4.3.0/is";
import { fromFileUrl } from "jsr:@std/path@^1.0.3/from-file-url";
import { Lock } from "jsr:@core/asyncutil@^1.1.1/lock";

export class Extension extends BaseExtension {
  override initialize(denops: Denops, lspoints: Lspoints): Promise<void> {
    const initializationOptions = {
      editorInfo: {
        name: denops.meta.host === "nvim" ? "Neovim" : "Vim",
        version: denops.meta.version,
      },
      editorPluginInfo: {
        name: "lspoints-extension-copilot",
        version: "0.0.1",
      },
    };
    // TODO: Provide a way to configure these settings
    const settings = {
      http: { proxy: null, proxyStrictSSL: null },
      "github-enterprise": { uri: null },
      enableAutoCompletions: true,
      disabledLanguages: [{ languageId: "." }],
    } satisfies CopilotSettings;

    const entrypoint = fromFileUrl(
      import.meta.resolve("../../dist/language-server.js"),
    );
    lspoints.settings.patch({
      startOptions: {
        copilot: {
          cmd: ["node", entrypoint, "--stdio"],
          initializationOptions,
          settings,
        },
      },
    });

    const lock = new Lock(0);

    lspoints.defineCommands("copilot", {
      accept: async (options) => {
        const client = lspoints.getClient("copilot");
        if (!client) {
          return;
        }
        await accpet(denops, client, options);
      },
      suggest: async () => {
        const client = lspoints.getClient("copilot");
        if (!client) {
          return;
        }
        await lock.lock(async () => {
          await suggest(denops, client);
        });
      },
      suggestCycling: async (context) => {
        assert(context, isCopilotContext);
        const client = lspoints.getClient("copilot");
        if (!client) {
          return;
        }
        await lock.lock(async () => {
          await suggestCycling(denops, client, context);
        });
      },
      drawPreview: async (context) => {
        assert(context, isCopilotContext);
        const client = lspoints.getClient("copilot");
        if (!client) {
          return;
        }
        await drawPreview(denops, client, context);
      },
      clearPreview: async () => {
        await clearPreview(denops);
      },
      notifyDidFocus: async (bufnr) => {
        const client = lspoints.getClient("copilot");
        if (!is.Number(bufnr) || !client?.isAttached(bufnr)) {
          return;
        }
        await client.notify("textDocument/didFocus", {
          textDocument: { uri: client.getUriFromBufNr(bufnr) },
        });
      },
    });

    return Promise.resolve();
  }
}

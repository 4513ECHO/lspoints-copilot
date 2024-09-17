import type { Denops } from "jsr:@denops/std@^7.1.1";
import { BaseExtension, type Lspoints } from "jsr:@kuuote/lspoints@^0.1.1";
import { type CopilotSettings, isCopilotContext } from "./copilot/types.ts";
import { clearPreview, drawPreview } from "./copilot/preview.ts";
import { suggest, suggestCycling } from "./copilot/sugget.ts";
import { accpet } from "./copilot/accept.ts";
import { assert } from "jsr:@core/unknownutil@^4.3.0";
import { is } from "jsr:@core/unknownutil@^4.3.0/is";

class ExclusiveSignal {
  #controller = new AbortController();

  acquire(): AbortSignal {
    this.abortActive();
    return this.#controller.signal;
  }

  abortActive(): void {
    this.#controller.abort();
    this.#controller = new AbortController();
  }
}

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

    lspoints.settings.patch({
      startOptions: {
        copilot: {
          cmd: ["npx", "@github/copilot-language-server@1.229.0", "--stdio"],
          initializationOptions,
          settings,
        },
      },
    });

    const signal = new ExclusiveSignal();

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
        await suggest(denops, client, signal.acquire());
      },
      suggestCycling: async (context) => {
        assert(context, isCopilotContext);
        const client = lspoints.getClient("copilot");
        if (!client) {
          return;
        }
        await suggestCycling(denops, client, context, signal.acquire());
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
      abortRequest: () => {
        signal.abortActive();
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

import type { Denops } from "jsr:@denops/std@^7.1.1";
import {
  BaseExtension,
  type Client,
  type Lspoints,
} from "jsr:@kuuote/lspoints@^0.1.0";
import * as LSP from "npm:vscode-languageserver-types@^3.17.5";
import * as u from "jsr:@core/unknownutil@^4.3.0";
import { is } from "jsr:@core/unknownutil@^4.3.0/is";
import * as batch from "jsr:@denops/std@^7.1.1/batch";
import { rawString } from "jsr:@denops/std@^7.1.1/eval";
import { send } from "jsr:@denops/std@^7.1.1/helper/keymap";
import { fromFileUrl } from "jsr:@std/path@^1.0.3/from-file-url";
import { Lock } from "jsr:@core/asyncutil@^1.1.1/lock";

type VimFuncref = unknown;
enum CopilotTriggerKind {
  Invoked = 1,
  Automatic = 2,
}
type Params = {
  context: {
    triggerKind: CopilotTriggerKind;
  };
  formattingOptions: LSP.FormattingOptions;
  position: LSP.Position;
  textDocument: LSP.VersionedTextDocumentIdentifier;
};
type Candidate = {
  command: LSP.Command;
  range: LSP.Range;
  insertText: string;
};
type Agent<T extends string> = {
  agent_id: number;
  id: number;
  method: T;
  params: Params;
  result: {
    completions: Candidate[];
  };
  status: string;
  waiting: unknown;
  Agent: VimFuncref;
  Wait: VimFuncref;
  Await: VimFuncref;
  Cancel: VimFuncref;
};
type OriginalCopilotContext = {
  choice?: number;
  cycling?: Agent<"getCompletionsCycling">;
  cycling_callbacks?: VimFuncref[];
  first: Agent<"getCompletions">;
  shown_choices?: Record<string, true>;
  params: Params;
  suggestions?: Candidate[];
};

type CopilotContext = {
  candidates: Candidate[];
  selected: number;
  params: Params;
};

type ExtmarkData = {
  id: number;
  virt_text: ([string] | [string, string])[];
  virt_text_pos: string;
  hl_mode: string;
  virt_lines?: ([string] | [string, string])[][];
};

const isTriggerKind: u.Predicate<CopilotTriggerKind> = is.LiteralOneOf([
  CopilotTriggerKind.Invoked,
  CopilotTriggerKind.Automatic,
]);
const isCandidate: u.Predicate<Candidate> = is.ObjectOf({
  command: LSP.Command.is,
  range: LSP.Range.is,
  insertText: is.String,
});
const isParams: u.Predicate<Params> = is.ObjectOf({
  context: is.ObjectOf({
    triggerKind: isTriggerKind,
  }),
  formattingOptions: LSP.FormattingOptions.is,
  position: LSP.Position.is,
  textDocument: LSP.VersionedTextDocumentIdentifier.is,
});

async function makeParams(
  denops: Denops,
  client: Client,
): Promise<Params | undefined> {
  const [bufnr, insertSpaces, shiftWidth, line, lnum, col, mode] = await batch
    .collect(
      denops,
      (denops) => [
        denops.call("bufnr"),
        denops.eval("&expandtab"),
        denops.call("shiftwidth"),
        denops.call("getline", "."),
        denops.call("line", "."),
        denops.call("col", "."),
        denops.call("mode"),
      ],
    ) as [number, number, number, string, number, number, string];
  if (!client.isAttached(bufnr)) {
    return;
  }
  return {
    context: { triggerKind: CopilotTriggerKind.Automatic },
    formattingOptions: {
      insertSpaces: !!insertSpaces,
      tabSize: shiftWidth,
    },
    position: {
      line: lnum - 1,
      character: line
        .substring(0, col - (/^[iR]/.test(mode) || !line ? 1 : 0))
        .length,
    },
    textDocument: {
      uri: client.getUriFromBufNr(bufnr),
      version: client.getDocumentVersion(bufnr),
    },
  };
}

async function getCurrentCandidate(denops: Denops): Promise<Candidate | null> {
  const [mode, context, lnum] = await batch.collect(
    denops,
    (denops) => [
      denops.call("mode"),
      denops.call("getbufvar", "", "__copilot", null),
      denops.call("line", "."),
    ],
  ) as [string, CopilotContext | null, number];
  if (!/^[iR]/.test(mode) || !context?.candidates) {
    return null;
  }
  const selected = context.candidates[context.selected];
  if (
    selected?.range.start.line !== lnum - 1 ||
    selected.range.start.character !== 0
  ) {
    return null;
  }
  return selected;
}

async function getDisplayAdjustment(
  denops: Denops,
  candidate: Candidate | null,
): Promise<[text: string, outdent: number, toDelete: number]> {
  if (!candidate) {
    return ["", 0, 0];
  }
  const [line, col] = await batch.collect(
    denops,
    (denops) => [
      denops.call("getline", "."),
      denops.call("col", "."),
    ],
  ) as [string, number];
  const offset = col - 1;
  const selectedText = line.substring(0, candidate.range.start.character) +
    candidate.insertText.replace(/\n*$/, "");
  const typed = line.substring(0, offset);
  const endOffset = Math.min(line.length, candidate.range.end.character);
  const toDelete = line.substring(offset, endOffset);
  if (typed.trim() === "") {
    const leading = selectedText.match(/^\s+/)?.[0] ?? "";
    const unindented = selectedText.trimStart();
    if (
      typed.substring(0, leading.length) === leading && unindented !== toDelete
    ) {
      return [unindented, typed.length - leading.length, toDelete.length];
    }
  } else if (typed === selectedText.substring(0, offset)) {
    return [selectedText.substring(offset), 0, toDelete.length];
  }
  return ["", 0, 0];
}

const hlgroup = "CopilotSuggestion";
const annotHlgroup = "CopilotAnnotation";

async function drawPreview(denops: Denops, client: Client): Promise<void> {
  const candidate = await getCurrentCandidate(denops);
  const text = candidate?.insertText.split("\n");
  await clearPreview(denops);
  if (!candidate || !text) {
    return;
  }
  const annot = "";
  const [col, lnum, colEnd] = await batch.collect(
    denops,
    (denops) => [
      denops.call("col", "."),
      denops.call("line", "."),
      denops.call("col", "$"),
    ],
  ) as [number, number, number];
  const newlinePos = candidate.insertText.indexOf("\n");
  text[0] = candidate.insertText.substring(
    col - 1,
    newlinePos > -1 ? newlinePos : undefined,
  );
  switch (denops.meta.host) {
    case "nvim": {
      const ns = await denops.call(
        "nvim_create_namespace",
        "lspoints-extension-copilot",
      );
      const data: ExtmarkData = {
        id: 1,
        virt_text: [[text[0], hlgroup]],
        virt_text_pos: "overlay",
        hl_mode: "combine",
      };
      if (text.length > 1) {
        data.virt_lines = text.slice(1).map((line) => [[line, hlgroup]]);
        if (annot) {
          data.virt_lines[-1]?.push([" "], [annot, annotHlgroup]);
        }
      } else if (annot) {
        data.virt_text.push([" "], [annot, annotHlgroup]);
      }
      await denops.call("nvim_buf_set_extmark", 0, ns, lnum - 1, col - 1, data);
      break;
    }
    case "vim":
      await batch.batch(denops, async (denops) => {
        await denops.call("prop_add", lnum, col, {
          type: hlgroup,
          text: text[0],
        });
        for (const line of text.slice(1)) {
          await denops.call("prop_add", lnum, 0, {
            type: hlgroup,
            text_align: "below",
            text: line,
          });
        }
        if (annot) {
          await denops.call("prop_add", lnum, colEnd, {
            type: annotHlgroup,
            text: " " + annot,
          });
        }
      });
  }
  await client.notify("textDocument/didShowCompletion", { item: candidate });
}

async function clearPreview(denops: Denops): Promise<void> {
  switch (denops.meta.host) {
    case "nvim": {
      const ns = await denops.call(
        "nvim_create_namespace",
        "lspoints-extension-copilot",
      );
      await denops.call("nvim_buf_del_extmark", 0, ns, 1);
      break;
    }
    case "vim":
      await denops.call("prop_remove", { type: hlgroup, all: true });
      await denops.call("prop_remove", { type: annotHlgroup, all: true });
      break;
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
    };

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
        const { pattern } = options as { pattern?: string };
        const candidate = await getCurrentCandidate(denops);
        const [text, outdent, toDelete] = await getDisplayAdjustment(
          denops,
          candidate,
        );
        if (!candidate || !text) {
          return;
        }
        const client = lspoints.getClient("copilot");
        if (!client) {
          return;
        }
        await denops.cmd("unlet! b:__copilot");
        const newText = pattern
          ? text.match("\n*(?:" + pattern + ")")?.[0].replace(/\n*$/, "") ??
            text
          : text;
        if (text === newText) {
          await client.request("workspace/executeCommand", candidate.command);
        } else {
          const [line, col] = await batch.collect(denops, (denops) => [
            denops.call("getline", "."),
            denops.call("col", "."),
          ]) as [string, number];
          const lineText = line.substring(0, col - 1) + newText;
          await client.notify("textDocument/didPartiallyAcceptCompletion", {
            item: candidate,
            acceptedLength: lineText.length - candidate.range.start.character,
          });
        }
        await clearPreview(denops);
        await send(denops, [
          rawString`${"\\<Left>\\<Del>".repeat(outdent)}`,
          rawString`${"\\<Del>".repeat(toDelete)}`,
          rawString`\<Cmd>set paste\<CR>${newText}\<Cmd>set nopaste\<CR>`,
          ...(pattern ? [] : [rawString`\<End>`]),
        ]);
      },
      suggest: async () => {
        await lock.lock(async () => {
          const client = lspoints.getClient("copilot");
          if (!client) {
            return;
          }
          const params = await makeParams(denops, client);
          if (!params) {
            return;
          }
          try {
            const { items } = u.ensure(
              await client.request("textDocument/inlineCompletion", params),
              is.ObjectOf({ items: is.ArrayOf(isCandidate) }),
            );
            await denops.cmd("let b:__copilot = context", {
              context: {
                candidates: items,
                selected: 0,
                params,
              } satisfies CopilotContext,
            });
          } catch (e) {
            if (is.String(e) && JSON.parse(e).code === -32801) {
              // Ignore "Document Version Mismatch" error
              return;
            }
            throw e;
          }
          await drawPreview(denops, client);
        });
      },
      drawPreview: async () => {
        const client = lspoints.getClient("copilot");
        if (!client) {
          return;
        }
        await drawPreview(denops, client);
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

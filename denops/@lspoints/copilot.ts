import type { Denops } from "https://deno.land/x/lspoints@v0.0.7/deps/denops.ts";
import {
  BaseExtension,
  type Lspoints,
} from "https://deno.land/x/lspoints@v0.0.7/interface.ts";
import { is, u } from "https://deno.land/x/lspoints@v0.0.7/deps/unknownutil.ts";
import * as batch from "https://deno.land/x/denops_std@v6.4.0/batch/mod.ts";
import { fromFileUrl } from "https://deno.land/std@0.223.0/path/from_file_url.ts";

type Position = {
  line: number;
  character: number;
};
type Range = {
  start: Position;
  end: Position;
};
type VimFuncref = unknown;
type Params = {
  doc: {
    indentSize: number;
    insertSpaces: boolean;
    position: Position;
    tabSize: number;
    uri: string | number;
    version: number;
  };
  position: Position;
  textDocument: {
    uri: string | number;
    version: number;
  };
};
type Candidate = {
  displayText: string;
  docVersion: number;
  position: Position;
  range: Range;
  text: string;
  uuid: string;
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
  shownCandidates: Record<string, true>;
  params: Params;
};

type ExtmarkData = {
  id: number;
  virt_text: ([string] | [string, string])[];
  virt_text_pos: string;
  hl_mode: string;
  virt_lines?: ([string] | [string, string])[][];
};

const isPosition: u.Predicate<Position> = is.ObjectOf({
  line: is.Number,
  character: is.Number,
});
const isRange: u.Predicate<Range> = is.ObjectOf({
  start: isPosition,
  end: isPosition,
});
const isCandidate: u.Predicate<Candidate> = is.ObjectOf({
  displayText: is.String,
  docVersion: is.Number,
  position: is.ObjectOf({
    line: is.Number,
    character: is.Number,
  }),
  range: isRange,
  text: is.String,
  uuid: is.String,
});
const isParams: u.Predicate<Params> = is.ObjectOf({
  doc: is.ObjectOf({
    indentSize: is.Number,
    insertSpaces: is.Boolean,
    position: isPosition,
    tabSize: is.Number,
    uri: is.UnionOf([is.String, is.Number]),
    version: is.Number,
  }),
  position: isPosition,
  textDocument: is.ObjectOf({
    uri: is.UnionOf([is.String, is.Number]),
    version: is.Number,
  }),
});

async function makeParams(denops: Denops): Promise<Params> {
  const [uri, version, insertSpaces, shiftWidth, line, lnum, col, mode] =
    await batch.collect(
      denops,
      (denops) => [
        denops.call("bufnr", ""),
        denops.call("getbufvar", "", "changedtick"),
        denops.eval("&expandtab"),
        denops.call("shiftwidth"),
        denops.call("getline", "."),
        denops.call("line", "."),
        denops.call("col", "."),
        denops.call("mode"),
      ],
    ) as [string, number, number, number, string, number, number, string];
  const position: Position = {
    line: lnum - 1,
    character: line
      .substring(0, col - (/^[iR]/.test(mode) || !line ? 1 : 0))
      .length,
  };
  return {
    doc: {
      uri,
      version,
      insertSpaces: !!insertSpaces,
      tabSize: shiftWidth,
      indentSize: shiftWidth,
      position,
    },
    position,
    textDocument: { uri, version },
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
  if (!/^[iR]/.test(mode) || !context || !context.candidates) {
    return null;
  }
  const selected = context.candidates[context.selected];
  if (
    !selected?.range || selected.range.start.line !== lnum - 1 ||
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
    candidate.text.replace(/\n*$/, "");
  const typed = line.substring(0, offset);
  const endOffset = line.length > candidate.range.end.character
    ? line.length
    : candidate.range.end.character;
  const toDelete = line.substring(offset, endOffset + 1);
  if (/^\s*$/.test(typed)) {
    const leading = selectedText.match(/^\s*/)?.[0] ?? "";
    const unindented = selectedText.substring(leading.length);
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

async function drawPreview(denops: Denops): Promise<string | undefined> {
  const candidate = await getCurrentCandidate(denops);
  const text = candidate?.displayText.split("\n");
  await clearPreview(denops);
  if (!candidate || !text) {
    return;
  }
  const annot = "";
  const [col, lnum, colEnd, context] = await batch.collect(
    denops,
    (denops) => [
      denops.call("col", "."),
      denops.call("line", "."),
      denops.call("col", "$"),
      denops.call("getbufvar", "", "__copilot", null),
    ],
  ) as [number, number, number, CopilotContext | null];
  const newlinePos = candidate.text.indexOf("\n");
  text[0] = candidate.text.substring(
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
  if (context && !context.shownCandidates[candidate.uuid]) {
    return candidate.uuid;
  }
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

    const entrypoint = fromFileUrl(import.meta.resolve("../../dist/agent.js"));
    lspoints.settings.patch({
      startOptions: {
        copilot: {
          cmd: ["node", entrypoint],
          initializationOptions,
          settings,
        },
      },
    });

    lspoints.defineCommands("copilot", {
      suggest: async () => {
        const params = await makeParams(denops);
        const client = lspoints.getClient("copilot");
        if (!client) {
          return;
        }
        // Sync textDocument
        for (const doc of [params.doc, params.textDocument]) {
          if (is.Number(doc.uri)) {
            const bufnr = doc.uri;
            if (!client.isAttached(bufnr)) {
              return;
            }
            doc.uri = client.getUriFromBufNr(bufnr);
            doc.version = client.getDocumentVersion(bufnr);
          }
        }
        lspoints.request("copilot", "getCompletions", params)
          .then((result) =>
            u.ensure(
              result,
              is.ObjectOf({ completions: is.ArrayOf(isCandidate) }),
            )
          )
          .then(({ completions }) =>
            denops.cmd("let b:__copilot = context", {
              context: {
                candidates: completions,
                selected: 0,
                shownCandidates: {},
                params,
              } satisfies CopilotContext,
            })
          )
          .then(() => drawPreview(denops))
          .then((uuid) => {
            if (uuid) {
              denops.cmd(
                "let b:__copilot.shownCandidates[uuid] = v:true",
                { uuid },
              );
              lspoints.request("copilot", "notifyShown", { uuid });
            }
          });
      },
      notifyDidFocus: async (bufnr) => {
        const client = lspoints.getClient("copilot");
        if (!client || !is.Number(bufnr) || !client.isAttached(bufnr)) {
          return;
        }
        await lspoints.notify("copilot", "textDocument/didFocus", {
          textDocument: { uri: client.getUriFromBufNr(bufnr) },
        });
      },
    });

    return Promise.resolve();
  }
}

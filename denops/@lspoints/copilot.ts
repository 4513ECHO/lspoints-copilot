import type { Denops } from "https://deno.land/x/lspoints@v0.0.6/deps/denops.ts";
import {
  BaseExtension,
  type Lspoints,
} from "https://deno.land/x/lspoints@v0.0.6/interface.ts";
import { is, u } from "https://deno.land/x/lspoints@v0.0.6/deps/unknownutil.ts";
import { collect } from "https://deno.land/x/denops_std@v6.2.0/batch/collect.ts";
import { fromFileUrl } from "https://deno.land/std@0.218.0/path/from_file_url.ts";

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
  shown_choices?: Record<string, true | undefined>;
  params: Params;
  suggestions?: Candidate[];
};

type CopilotContext = {
  candidates: Candidate[];
  selected: number;
  shownCandidates: Record<string, true | undefined>;
  params: Params;
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
    await collect(
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
      .substring(0, col - (/^[iR]/.test(mode) || line.length === 0 ? 1 : 0))
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
  const [mode, context, lnum] = await collect(
    denops,
    (denops) => [
      denops.call("mode"),
      denops.call("getbufvar", "", "__copilot", null),
      denops.call("line", "."),
    ],
  ) as [string, CopilotContext | null, number];
  if (mode !== "i" || !context || context.candidates.length === 0) {
    return null;
  }
  const selected = context.candidates[context.selected] ?? {};
  if (
    !selected.range || selected.range.start.line !== lnum - 1 ||
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
  const [line, col] = await collect(
    denops,
    (denops) => [
      denops.call("getline", "."),
      denops.call("col", "."),
    ],
  ) as [string, number];
  if (!candidate) {
    return ["", 0, 0];
  }
  const offset = col - 1;
  const selectedText = line.substring(0, candidate.range.start.character) +
    candidate.text.replace(/\n*$/, "");
  const typed = line.substring(0, offset);
  const endOffset = line.length > candidate.range.end.character
    ? line.length
    : candidate.range.end.character;
  const toDelete = line.substring(offset, endOffset);
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
        },
      },
    });

    lspoints.subscribeAttach((client) => {
      if (client !== "copilot") {
        return;
      }
      lspoints.notify(client, "workspace/didChangeConfiguration", settings);
    });

    lspoints.defineCommands("copilot", {
      suggest: async () => {
        const params = await makeParams(denops);
        const client = lspoints.getClient("copilot");
        if (!client) {
          return;
        }
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
          .then(() => denops.call("lspoints#extension#copilot#draw_preview"));
      },
    });

    return Promise.resolve();
  }
}

import type { Denops } from "jsr:@denops/std@^7.1.1";
import type { Client } from "jsr:@kuuote/lspoints@^0.1.1";
import type { CopilotContext } from "./types.ts";
import * as batch from "jsr:@denops/std@^7.1.1/batch";
import * as fn from "jsr:@denops/std@^7.1.1/function";
import * as vimFn from "jsr:@denops/std@^7.1.1/function/vim";
import * as nvimFn from "jsr:@denops/std@^7.1.1/function/nvim";
import { getCurrentCandidate } from "./util.ts";

type ExtmarkData = {
  id: number;
  virt_text: ([string] | [string, string])[];
  virt_text_pos: string;
  hl_mode: string;
  virt_lines?: ([string] | [string, string])[][];
};

const hlgroup = "CopilotSuggestion";
const annotHlgroup = "CopilotAnnotation";
let ns: number;

async function getNamespace(denops: Denops): Promise<number> {
  if (ns) {
    return ns;
  }
  ns = await nvimFn
    .nvim_create_namespace(denops, "lspoints-extension-copilot") as number;
  return ns;
}

export async function drawPreview(
  denops: Denops,
  client: Client,
  context: CopilotContext,
): Promise<void> {
  const candidate = await getCurrentCandidate(denops);
  const text = candidate?.insertText.split("\n");
  await clearPreview(denops);
  if (!candidate || !text) {
    return;
  }
  const annot = context.cyclingDeltas?.length
    ? "(1/…)"
    : context.cyclingDeltas?.length === 0
    ? `(${context.selected + 1}/${context.candidates.length})`
    : "";
  const [col, lnum, colEnd] = await batch.collect(denops, (denops) => [
    fn.col(denops, "."),
    fn.line(denops, "."),
    fn.col(denops, "$"),
  ]);
  const newlinePos = candidate.insertText.indexOf("\n");
  text[0] = candidate.insertText.substring(
    col - 1,
    newlinePos > -1 ? newlinePos : undefined,
  );
  switch (denops.meta.host) {
    case "nvim": {
      await nvimDrawPreview(denops, text, annot, lnum - 1, col - 1);
      break;
    }
    case "vim":
      await vimDrawPreview(denops, text, annot, lnum, col, colEnd);
      break;
  }
  await client.notify("textDocument/didShowCompletion", { item: candidate });
}

async function nvimDrawPreview(
  denops: Denops,
  text: string[],
  annot: string,
  lnum: number,
  col: number,
): Promise<void> {
  const ns = await getNamespace(denops);
  const data: ExtmarkData = {
    id: 1,
    virt_text: [[text[0]!, hlgroup]],
    virt_text_pos: "overlay",
    hl_mode: "combine",
  };
  if (text.length > 1) {
    data.virt_lines = text.slice(1).map((line) => [[line, hlgroup]]);
    if (annot) {
      data.virt_lines.at(-1)?.push([" "], [annot, annotHlgroup]);
    }
  } else if (annot) {
    data.virt_text.push([" "], [annot, annotHlgroup]);
  }
  await nvimFn.nvim_buf_set_extmark(denops, 0, ns, lnum, col, data);
}

async function vimDrawPreview(
  denops: Denops,
  text: string[],
  annot: string,
  lnum: number,
  col: number,
  colEnd: number,
): Promise<void> {
  await batch.batch(denops, async (denops) => {
    await vimFn.prop_add(denops, lnum, col, { type: hlgroup, text: text[0] });
    for (const line of text.slice(1)) {
      await vimFn.prop_add(denops, lnum, 0, {
        type: hlgroup,
        text_align: "below",
        text: line,
      });
    }
    if (annot) {
      await vimFn.prop_add(denops, lnum, colEnd, {
        type: annotHlgroup,
        text: " " + annot,
      });
    }
  });
}

export async function clearPreview(denops: Denops): Promise<void> {
  switch (denops.meta.host) {
    case "nvim": {
      const ns = await getNamespace(denops);
      await nvimFn.nvim_buf_del_extmark(denops, 0, ns, 1);
      break;
    }
    case "vim":
      await vimFn.prop_remove(denops, { type: hlgroup, all: true });
      await vimFn.prop_remove(denops, { type: annotHlgroup, all: true });
      break;
  }
}

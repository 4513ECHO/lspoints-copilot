import type { Denops } from "jsr:@denops/std@^7.1.1";
import type { Client } from "jsr:@kuuote/lspoints@^0.1.0";
import type { CopilotContext } from "./types.ts";
import * as batch from "jsr:@denops/std@^7.1.1/batch";
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
  const ns = await denops.call(
    "nvim_create_namespace",
    "lspoints-extension-copilot",
  );
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
  await denops.call("nvim_buf_set_extmark", 0, ns, lnum, col, data);
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
    await denops.call("prop_add", lnum, col, { type: hlgroup, text: text[0] });
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

export async function clearPreview(denops: Denops): Promise<void> {
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

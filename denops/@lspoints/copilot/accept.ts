import type { Denops } from "jsr:@denops/std@^7.1.1";
import type { Client } from "jsr:@kuuote/lspoints@^0.1.0";
import type { Candidate } from "./types.ts";
import { clearPreview } from "./preview.ts";
import { getCurrentCandidate, setContext } from "./util.ts";
import * as batch from "jsr:@denops/std@^7.1.1/batch";
import { rawString } from "jsr:@denops/std@^7.1.1/eval/string";
import { send } from "jsr:@denops/std@^7.1.1/helper/keymap";

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

export async function accpet(
  denops: Denops,
  client: Client,
  options: unknown,
): Promise<void> {
  const { pattern } = options as { pattern?: string };
  const candidate = await getCurrentCandidate(denops);
  const [text, outdent, toDelete] = await getDisplayAdjustment(
    denops,
    candidate,
  );
  if (!candidate || !text) {
    return;
  }
  await setContext(denops, null);
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
}

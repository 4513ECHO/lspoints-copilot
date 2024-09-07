import type { Denops } from "jsr:@denops/std@^7.1.1";
import type { Candidate, CopilotContext } from "./types.ts";
import { collect } from "jsr:@denops/std@^7.1.1/batch";

export async function setContext(
  denops: Denops,
  context: CopilotContext | null,
): Promise<void> {
  if (context) {
    await denops.call("setbufvar", "", "__copilot", context);
  } else {
    await denops.cmd("unlet! b:__copilot");
  }
}

export async function getContext(
  denops: Denops,
): Promise<CopilotContext | null> {
  return await denops.call("getbufvar", "", "__copilot", null) as
    | CopilotContext
    | null;
}

export async function getCurrentCandidate(
  denops: Denops,
): Promise<Candidate | null> {
  const [mode, context, lnum] = await collect(denops, (denops) => [
    denops.call("mode") as Promise<string>,
    // @ts-expect-error: batch.collect does not support compilerOptions.exactOptionalPropertyTypes
    getContext(denops),
    denops.call("line", ".") as Promise<number>,
  ]);
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

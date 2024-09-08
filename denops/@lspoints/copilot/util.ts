import type { Denops } from "jsr:@denops/std@^7.1.1";
import type { Candidate, CopilotContext } from "./types.ts";
import { collect } from "jsr:@denops/std@^7.1.1/batch";
import * as fn from "jsr:@denops/std@^7.1.1/function";
import * as vars from "jsr:@denops/std@^7.1.1/variable";

export async function setContext(
  denops: Denops,
  context: CopilotContext | null,
): Promise<void> {
  if (context) {
    await vars.b.set(denops, "__copilot", context);
  } else {
    await denops.cmd("unlet! b:__copilot");
  }
}

export async function getContext(
  denops: Denops,
): Promise<CopilotContext | null> {
  return await vars.b.get<CopilotContext>(denops, "__copilot");
}

export async function getCurrentCandidate(
  denops: Denops,
): Promise<Candidate | null> {
  const [mode, context, lnum] = await collect(denops, (denops) => [
    fn.mode(denops),
    getContext(denops),
    fn.line(denops, "."),
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

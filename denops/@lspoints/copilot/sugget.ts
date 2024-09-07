import type { Denops } from "jsr:@denops/std@^7.1.1";
import type { Client } from "jsr:@kuuote/lspoints@^0.1.0";
import {
  type CopilotContext,
  type InlineCompletionParams,
  InlineCompletionTriggerKind,
  isCandidate,
} from "./types.ts";
import { drawPreview } from "./preview.ts";
import { getContext, setContext } from "./util.ts";
import * as batch from "jsr:@denops/std@^7.1.1/batch";
import { ensure } from "jsr:@core/unknownutil@^4.3.0";
import { is } from "jsr:@core/unknownutil@^4.3.0/is";

async function makeParams(
  denops: Denops,
  client: Client,
): Promise<InlineCompletionParams | undefined> {
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
    context: { triggerKind: InlineCompletionTriggerKind.Automatic },
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

export async function suggest(denops: Denops, client: Client): Promise<void> {
  const params = await makeParams(denops, client);
  if (!params) {
    // Not attached
    return;
  }
  try {
    const { items } = ensure(
      await client.request("textDocument/inlineCompletion", params),
      is.ObjectOf({ items: is.ArrayOf(isCandidate) }),
    );
    const context: CopilotContext = {
      candidates: items,
      selected: 0,
      params,
    };
    await setContext(denops, context);
    await drawPreview(denops, client, context);
  } catch (e) {
    if (is.String(e) && JSON.parse(e).code === -32801) {
      // Ignore "Document Version Mismatch" error
      return;
    }
    throw e;
  }
}

export async function suggestCycling(
  denops: Denops,
  client: Client,
  context: CopilotContext,
): Promise<void> {
  if (!context?.cyclingDeltas) {
    return;
  }
  await drawPreview(denops, client, context);
  context.params.context.triggerKind = InlineCompletionTriggerKind.Invoked;
  const { items } = ensure(
    await client.request("textDocument/inlineCompletion", context.params),
    is.ObjectOf({ items: is.ArrayOf(isCandidate) }),
  );
  const mod = (n: number, m: number) => ((n % m) + m) % m;
  // Update the deltas
  const { cyclingDeltas } = await getContext(denops) ?? {};
  const newContext: CopilotContext = {
    candidates: items,
    selected: mod(
      context.selected +
        (cyclingDeltas?.reduce((a, b) => a + b, 0) ?? 0),
      items.length,
    ),
    params: context.params,
    cyclingDeltas: [],
  };
  await setContext(denops, newContext);
  await drawPreview(denops, client, newContext);
}

import type { Denops } from "jsr:@denops/std@^7.1.1";
import type { Client } from "jsr:@kuuote/lspoints@^0.1.1";
import {
  type Candidate,
  type CopilotContext,
  type InlineCompletionParams,
  InlineCompletionTriggerKind,
  isCandidate,
} from "./types.ts";
import { drawPreview } from "./preview.ts";
import { getContext, setContext } from "./util.ts";
import * as batch from "jsr:@denops/std@^7.1.1/batch";
import * as fn from "jsr:@denops/std@^7.1.1/function";
import * as op from "jsr:@denops/std@^7.1.1/option";
import { ensure } from "jsr:@core/unknownutil@^4.3.0/ensure";
import { is } from "jsr:@core/unknownutil@^4.3.0/is";

async function makeParams(
  denops: Denops,
  client: Client,
): Promise<InlineCompletionParams | undefined> {
  const [bufnr, insertSpaces, shiftWidth, line, lnum, col, mode] = await batch
    .collect(denops, (denops) => [
      fn.bufnr(denops),
      op.expandtab.getLocal(denops),
      fn.shiftwidth(denops),
      fn.getline(denops, "."),
      fn.line(denops, "."),
      fn.col(denops, "."),
      fn.mode(denops),
    ]);
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

async function requestInlineCompletion(
  client: Client,
  params: InlineCompletionParams,
  signal: AbortSignal,
): Promise<Candidate[] | undefined> {
  try {
    return ensure(
      await client.request("textDocument/inlineCompletion", params, { signal }),
      is.ObjectOf({ items: is.ArrayOf(isCandidate) }),
    ).items;
  } catch (e) {
    if (is.String(e)) {
      const { code } = ensure(JSON.parse(e), is.ObjectOf({ code: is.Number }));
      switch (code) {
        case -32801: // "Document Version Mismatch"
        case -32800: // "Request was cancelled"
          return;
      }
    }
    throw e;
  }
}

export async function suggest(
  denops: Denops,
  client: Client,
  signal: AbortSignal,
): Promise<void> {
  const params = await makeParams(denops, client);
  if (!params) {
    // Not attached
    return;
  }
  const signalWithDenops = denops.interrupted
    ? AbortSignal.any([signal, denops.interrupted])
    : signal;
  const items =
    await requestInlineCompletion(client, params, signalWithDenops) ?? [];
  if (!items.length) {
    return;
  }
  const context: CopilotContext = {
    candidates: items,
    selected: 0,
    params,
  };
  await setContext(denops, context);
  await drawPreview(denops, client, context);
}

export async function suggestCycling(
  denops: Denops,
  client: Client,
  context: CopilotContext,
  signal: AbortSignal,
): Promise<void> {
  if (!context?.cyclingDeltas) {
    return;
  }
  // Redraw to notify the request is started
  await drawPreview(denops, client, context);
  context.params.context.triggerKind = InlineCompletionTriggerKind.Invoked;
  const items = await requestInlineCompletion(
    client,
    context.params,
    denops.interrupted ? AbortSignal.any([signal, denops.interrupted]) : signal,
  ) ?? [];
  if (!items.length) {
    return;
  }
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

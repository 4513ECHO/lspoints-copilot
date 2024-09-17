import * as LSP from "npm:vscode-languageserver-types@^3.17.5";
import type { Predicate } from "jsr:@core/unknownutil@^4.3.0/type";
import { is } from "jsr:@core/unknownutil@^4.3.0/is";
import { asOptional } from "jsr:@core/unknownutil@^4.3.0/as/optional";

export const InlineCompletionTriggerKind = {
  Invoked: 1,
  Automatic: 2,
} as const;
export type InlineCompletionTriggerKind = 1 | 2;

export interface InlineCompletionParams {
  context: {
    triggerKind: InlineCompletionTriggerKind;
  };
  formattingOptions: LSP.FormattingOptions;
  position: LSP.Position;
  textDocument: LSP.VersionedTextDocumentIdentifier;
}

export interface CopilotSettings {
  http: {
    proxy: string | null;
    proxyStrictSSL: boolean | null;
  };
  "github-enterprise": {
    uri: string | null;
  };
  enableAutoCompletions: boolean;
  disabledLanguages: { languageId: string }[];
}

export interface Candidate {
  command: LSP.Command;
  range: LSP.Range;
  insertText: string;
}

export interface CopilotContext {
  candidates: Candidate[];
  selected: number;
  params: InlineCompletionParams;
  cyclingDeltas?: (1 | -1)[];
}

export const isInlineCompletionTriggerKind: Predicate<
  InlineCompletionTriggerKind
> = is.LiteralOneOf([
  InlineCompletionTriggerKind.Invoked,
  InlineCompletionTriggerKind.Automatic,
]);

export const isCandidate: Predicate<Candidate> = is.ObjectOf({
  command: LSP.Command.is,
  range: LSP.Range.is,
  insertText: is.String,
});

export const isInlineCompletionParams: Predicate<
  InlineCompletionParams
> = is.ObjectOf({
  context: is.ObjectOf({
    triggerKind: isInlineCompletionTriggerKind,
  }),
  formattingOptions: LSP.FormattingOptions.is,
  position: LSP.Position.is,
  textDocument: LSP.VersionedTextDocumentIdentifier.is,
});

export const isCopilotContext: Predicate<CopilotContext> = is.ObjectOf({
  candidates: is.ArrayOf(isCandidate),
  selected: is.Number,
  params: isInlineCompletionParams,
  cyclingDeltas: asOptional(is.ArrayOf(is.LiteralOneOf([1, -1] as const))),
});

import type { Denops } from "jsr:@denops/std@^7.2.0";
import * as batch from "jsr:@denops/std@^7.2.0/batch";
import * as lambda from "jsr:@denops/std@^7.2.0/lambda";
import * as options from "jsr:@denops/std@^7.2.0/option";
import * as popup from "jsr:@denops/std@^7.2.0/popup";
import type { Client } from "jsr:@kuuote/lspoints@^0.1.1";
import { isCheckStatusResult, isSignInInitiateResult } from "./types.ts";
import { ensure } from "jsr:@core/unknownutil@^4.3.0/ensure";
import { systemopen } from "jsr:@lambdalisue/systemopen@^1.0.0";

export async function signIn(denops: Denops, client: Client): Promise<string> {
  {
    const { user } = ensure(
      await client.request("checkStatus", {}),
      isCheckStatusResult,
    );
    if (user) {
      return user;
    }
  }
  const { verificationUri, userCode } = ensure(
    await client.request("signInInitiate", {}),
    isSignInInitiateResult,
  );

  // Open popup
  using openUri = lambda.add(denops, () => systemopen(verificationUri));
  const [lines, columns] = await batch.collect(denops, (denops) => [
    options.lines.get(denops),
    options.columns.get(denops),
  ]);
  const width = Math.max(Math.floor(columns / 3), 60);
  await using popupWindow = await popup.open(denops, {
    relative: "editor",
    width,
    height: 4,
    col: width > 60 ? width : Math.floor((columns - 60) / 2),
    row: Math.floor(lines / 2),
    border: "single",
    title: "GitHub Copilot Authentication",
  });
  await denops.call(
    "lspoints#copilot#popup_user_code",
    [userCode, openUri.id, popupWindow.bufnr, popupWindow.winid],
  );

  const { user } = ensure(
    await client.request("signInConfirm", { userCode }),
    isCheckStatusResult,
  );
  if (!user) {
    throw new Error("Failed to sign in");
  }
  return user;
}

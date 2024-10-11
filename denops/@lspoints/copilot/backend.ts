import type { Denops } from "jsr:@denops/std@^7.2.0";
import * as vars from "jsr:@denops/std@^7.2.0/variable";
import { isLiteralOneOf } from "jsr:@core/unknownutil@^4.3.0/is/literal-one-of";
import { ensure } from "jsr:@core/unknownutil@^4.3.0/ensure";

type Backend = "deno" | "node" | "bun";
const isBackend = isLiteralOneOf(["deno", "node", "bun"] as const);

const cmds = {
  node: ["npx", "@github/copilot-language-server@1.235.0", "--stdio"],
  deno: [
    "run",
    "--allow-all",
    "--no-config",
    "--no-lock",
    "--node-modules-dir=none",
    "npm:copilot-language-server-extracted@0.1.6",
    "--stdio",
  ],
  bun: [
    "bun",
    "x",
    // "--bun" flag does not work well at v1.1.27
    "@github/copilot-language-server@1.235.0",
    "--stdio",
  ],
} as const satisfies Record<Backend, string[]>;

export async function getBackend(denops: Denops): Promise<string[]> {
  const backend = ensure(
    await vars.g.get(denops, "copilot_client_backend"),
    isBackend,
  );
  if (backend === "deno") {
    return [Deno.execPath(), ...cmds[backend]];
  } else {
    return cmds[backend];
  }
}

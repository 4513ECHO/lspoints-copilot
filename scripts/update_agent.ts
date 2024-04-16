await Deno.remove("dist", { recursive: true }).catch(() => {});
await Deno.remove("copilot.vim", { recursive: true }).catch(() => {});
await new Deno.Command("git", {
  args: [
    "-c",
    "advice.detachedHead=false",
    "clone",
    "--depth=1",
    "--filter=blob:none",
    "--branch",
    Deno.args[0] ?? "main",
    "--single-branch",
    "https://github.com/github/copilot.vim",
  ],
  stdout: "inherit",
  stderr: "inherit",
}).output();
await Deno.rename("copilot.vim/dist", "dist");
await Deno.remove("copilot.vim", { recursive: true });

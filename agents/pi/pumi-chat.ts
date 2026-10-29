// installed by pumi's Agents plugin; reinstalling overwrites this file.
// pumi-chat v1
//
// What pumi's chat over a pi session asks of pi that pi's TUI has no key for: going back to
// before one of the user's messages, to edit it or take it back. `/pumi-rewind <entry id>` moves
// the session there as `/tree` does (the branch left stays in `/tree`), leaves the editor empty
// (the chat holds the text being edited), and appends an entry so whoever reads the session file
// sees where the session went.
export default function (pi: any) {
  if (!process.env.PUMI_TAB) return;
  pi.registerCommand("pumi-rewind", {
    description: "Go back to before one of your messages (pumi's chat uses it)",
    handler: async (args: string, ctx: any) => {
      const id = String(args ?? "").trim().split(/\s+/)[0];
      if (!id) return ctx?.ui?.notify?.("pumi-rewind: which message?", "warning");
      try {
        await ctx.waitForIdle?.();
        const done = await ctx.navigateTree(id, { summarize: false });
        if (done?.cancelled) return;
        ctx.ui?.setEditorText?.("");
        pi.appendEntry("pumi-rewind", { to: id });
      } catch (err: any) {
        ctx?.ui?.notify?.(`pumi-rewind: ${err?.message ?? err}`, "error");
      }
    },
  });
}

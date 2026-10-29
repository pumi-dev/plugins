// The names this plugin's own things go by: its prefix, its functions an agent's hook and other
// plugins call, its trait and the trait's fields. One place, so a rename of the plugin is one
// change; the manifest test checks it against `package.json`. No `import … from "pumi"` here.

/** The plugin's prefix (`owner.name.`), which its functions, events, options and trait go under. */
export const PREFIX = "pumi_dev.chat_ui.";

/** The function an agent's hook calls (`pumi call`), from the agent's terminal. */
export const HOOK_FN = `${PREFIX}hook`;

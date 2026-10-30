// The names this plugin's own things go by: its prefix, its functions an agent's hook and other
// plugins call, its trait and the trait's fields. One place, so a rename of the plugin is one
// change; the manifest test checks it against `package.json`. No `import … from "pumi"` here.

/** The plugin's prefix (`owner.name.`), which its functions, events, options and trait go under. */
export const PREFIX = "pumi_dev.agents.";

/** The function an agent's hook calls (`pumi call`), from the agent's terminal. */
export const HOOK_FN = `${PREFIX}hook`;

/** The event an agent tab's conversation moves by (`emit("conversation.changed")`, prefixed). */
export const CONVERSATION_CHANGED = `${PREFIX}conversation.changed`;

/**
 * The plugin's trait (`agent` in the manifest): a tab is an agent's while it names the agent
 * (`claude`), as its hook sets it. Its fields are the options below.
 */
export const AGENT = `@${PREFIX}agent`;
/** The agent's own session id. */
export const AGENT_SESSION = `${AGENT}.session`;
export const AGENT_MODEL = `${AGENT}.model`;
/** The session file's absolute path. */
export const AGENT_TRANSCRIPT = `${AGENT}.transcript`;
/** What it takes besides typing: `["queue"]`, a queued prompt at its stop hook. */
export const AGENT_ACCEPTS = `${AGENT}.accepts`;
/** The plugin serving the tab's conversation (`conversation.read`, `.send`, `.changed`): this one, for an agent the chat reads. */
export const AGENT_CONVERSATION = `${AGENT}.conversation`;

/** A session tab's own options (`sessions.ts`), beside the trait's: its directory, how its first session begins (`new` or `pick`), and its engine (`session/wire.ts` `Engine`). */
export const SESSION_CWD = "@agents.cwd";
export const SESSION_START = "@agents.start";
export const SESSION_ENGINE = "@agents.engine";

/** What an agent tab's chat keeps across the app starting again: the draft not sent yet, and the prompts sent (Up brings them back). */
export const KEPT_DRAFT = "@agents.draft";
export const KEPT_PROMPTS = "@agents.prompts";

/** A tab's status, any block's (`working`, `blocked`, `error`, `done`, `idle`, `unknown`): pumi-host's, from what its program reports. */
export const STATUS = "@status";

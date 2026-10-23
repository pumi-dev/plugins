// The agents a clicked node can be sent to, and the note that goes to one.
//
// An agent's hook marks its pane with the option `@agent`; a pane whose program is a shell is not
// an agent (its `pane_current_command` says one), whatever marked it. The note goes to the agents'
// core plugin's `@agent_inbox`, a list of attachments it hands its agent with the next message.
import { option, pane } from "pumi";
import type { Node } from "./nodes.ts";

/** The agents' inbox (the agents core plugin's `@agent_inbox`) and how much it keeps. */
const INBOX = "@agent_inbox";
const INBOX_LIMIT = 20;
/** How much of the source goes to an agent with a node. */
const SOURCE_LIMIT = 4000;
/** A program a pane marked `@agent` is running that is not an agent. */
const SHELLS = ["zsh", "bash", "fish", "sh", "nu", "dash", "tcsh"];

/** One agent that can be asked: the pane it runs in, and what to call it by. */
export interface Agent {
  pane: number;
  label: string;
}

/** What a note says the diagram is. */
export interface About {
  /** The diagram's pane. */
  pane: number;
  /** Mermaid's name for the kind of diagram. */
  kind: string;
  /** The diagram's source, as it is. */
  source: string;
  /** The node the user clicked. */
  node: Node;
  /** What the user typed about it. */
  note: string;
}

/** The agents `here` can be sent to: those in its tab first, then the others. */
export async function agents(here: number): Promise<Agent[]> {
  const tabOf = async (id: number): Promise<number | null> => {
    try {
      const { place } = await pane.get(id);
      const tab = (place as { kind?: string; tab?: number } | null)?.tab;
      return typeof tab === "number" ? tab : null;
    } catch {
      return null;
    }
  };
  let ids: number[];
  try {
    ids = ((await pane.list()) ?? []).filter((id): id is number => typeof id === "number");
  } catch {
    return [];
  }
  const mine = await tabOf(here);
  const found: { elsewhere: boolean; agent: Agent }[] = [];
  for (const id of ids) {
    const mark = await read("@agent", id);
    if (mark === "") continue;
    if (SHELLS.includes(await read("pane_current_command", id))) continue;
    found.push({ elsewhere: (await tabOf(id)) !== mine, agent: { pane: id, label: `${mark} %${id}` } });
  }
  found.sort((a, b) => Number(a.elsewhere) - Number(b.elsewhere));
  return found.map((found) => found.agent);
}

/** What a pane's option says, as text, or nothing. */
async function read(name: string, id: number): Promise<string> {
  try {
    const value = await option.get(name, { pane: id });
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

/** The note about `about` put in `agent`'s inbox, and what to tell the user it did. */
export async function attach(agent: Agent, about: About): Promise<string> {
  const source = about.source.length > SOURCE_LIMIT ? `${about.source.slice(0, SOURCE_LIMIT)}…` : about.source;
  const what = `node \`${about.node.id}\` (“${about.node.label}”) of this ${about.kind} diagram:\n\`\`\`mermaid\n${source}\n\`\`\``;
  const attachment = { from: "marmaide", pane: `%${about.pane}`, what, note: about.note };
  const target = { pane: agent.pane };
  let inbox: unknown[] = [];
  try {
    const kept = await option.get(INBOX, target);
    if (Array.isArray(kept)) inbox = kept;
  } catch {
    // An inbox it cannot read is an inbox it starts: the note is what matters.
  }
  inbox.push(attachment);
  inbox.splice(0, Math.max(0, inbox.length - INBOX_LIMIT));
  await option.set(INBOX, inbox, target);
  return `sent to ${agent.label}: it sees it with your next message`;
}

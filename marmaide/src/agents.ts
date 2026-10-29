// The agents a clicked node can be sent to, and the note that goes to one.
//
// An agent's hook marks its tab with the Agents plugin's trait (`@pumi_dev.agents.agent`); a tab
// whose program is a shell is not an agent (its `tab_current_command` says one), whatever marked it.
// The note is sent to the agent through the Agents plugin
// (`pumi_dev.agents.conversation.send`), which types it into the agent, or queues it there while its
// turn is still running. Nothing is typed into it from here.
import { call, option, workspace, type PaneId } from "pumi";
import type { Node } from "./nodes.ts";
/** How much of the source goes to an agent with a node. */
const SOURCE_LIMIT = 4000;
/** A program a tab marked with the agent trait is running that is not an agent. */
const SHELLS = ["zsh", "bash", "fish", "sh", "nu", "dash", "tcsh"];

/** One agent that can be asked: the pane it runs in, and what to call it by. */
export interface Agent {
  pane: PaneId;
  label: string;
}

/** What a note says the diagram is. */
export interface About {
  /** The diagram's pane. */
  pane: PaneId;
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
export async function agents(here: PaneId): Promise<Agent[]> {
  const tabOf = async (id: PaneId): Promise<string | null> => {
    try {
      await workspace.ready;
      const tab = workspace.getPane(id)?.tab;
      return tab === null || tab === undefined ? null : tab.id;
    } catch {
      return null;
    }
  };
  let ids: PaneId[];
  try {
    ids = (await workspace.panes()).map((pane) => pane.id);
  } catch {
    return [];
  }
  const mine = await tabOf(here);
  const found: { elsewhere: boolean; agent: Agent }[] = [];
  for (const id of ids) {
    const mark = await read("@pumi_dev.agents.agent", id);
    if (mark === "") continue;
    if (SHELLS.includes(await read("tab_current_command", id))) continue;
    found.push({ elsewhere: (await tabOf(id)) !== mine, agent: { pane: id, label: `${mark} ${id}` } });
  }
  found.sort((a, b) => Number(a.elsewhere) - Number(b.elsewhere));
  return found.map((found) => found.agent);
}

/** What a pane's option says, as text, or nothing. */
async function read(name: string, id: PaneId): Promise<string> {
  try {
    const value = await option.get(name, { scope: "pane", id });
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

/** The note about `about`, sent to `agent`: typed into it, or queued while its turn runs. */
export async function attach(agent: Agent, about: About): Promise<string> {
  const source = about.source.length > SOURCE_LIMIT ? `${about.source.slice(0, SOURCE_LIMIT)}…` : about.source;
  const what = `node \`${about.node.id}\` (“${about.node.label}”) of this ${about.kind} diagram:\n\`\`\`mermaid\n${source}\n\`\`\``;
  const said = `${about.note.trim()}\n\n${what}`.trim();
  const ack = (await call("pumi_dev.agents.conversation.send", agent.pane, { type: "prompt", id: crypto.randomUUID(), text: said })) as
    | { id?: string; rejected?: string }
    | null;
  if (ack?.rejected) return `${agent.label} did not take it: ${ack.rejected}`;
  return `sent to ${agent.label}`;
}

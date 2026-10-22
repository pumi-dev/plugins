// The agents a clicked node can be sent to, and the note that goes to one.
//
// An agent's hook marks its pane with the option `@agent`; a pane whose program is a shell is not
// an agent (its `pane_current_command` says one), whatever marked it. The note is a message for the
// agent, queued in the core (`agent.queue`): it waits until the agent's turn ends, then goes to it
// as the next message, through the agent's own hook. Nothing is typed into it.
import { agent as agentsOf, option, workspace, type PaneId } from "pumi";
import type { Node } from "./nodes.ts";
/** How much of the source goes to an agent with a node. */
const SOURCE_LIMIT = 4000;
/** A program a pane marked `@agent` is running that is not an agent. */
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
    const mark = await read("@agent", id);
    if (mark === "") continue;
    if (SHELLS.includes(await read("pane_current_command", id))) continue;
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

/** The note about `about`, queued for `agent`: it is its next message, once its turn ends. */
export async function attach(agent: Agent, about: About): Promise<string> {
  const source = about.source.length > SOURCE_LIMIT ? `${about.source.slice(0, SOURCE_LIMIT)}…` : about.source;
  const what = `node \`${about.node.id}\` (“${about.node.label}”) of this ${about.kind} diagram:\n\`\`\`mermaid\n${source}\n\`\`\``;
  const said = `${about.note.trim()}\n\n${what}`.trim();
  const id = await agentsOf.queue(agent.pane, said, { from: "marmaide" });
  return `queued for ${agent.label} (#${id}): it goes once its turn ends`;
}

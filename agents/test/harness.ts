// Runs a parser over synthetic session lines as the bridge does: records into changes, applied by a
// producer that publishes nowhere, so a test reads the transcript that results.
import { Producer } from "../src/conversation/change.ts";
import { emptyTranscript, type Transcript } from "../src/conversation/model.ts";
import { records, type Parser, type Rec } from "../src/parse/common.ts";

export function run(parser: Parser, lines: (Rec | string)[], session = { id: "s-1", agent: "Test" }): Transcript {
  const producer = new Producer({ transcript: emptyTranscript("epoch-0000", session), publish: () => {} });
  let all = records(lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))));
  if (parser.select) all = parser.select(all);
  for (const record of all) producer.push(...parser.record(record, producer.transcript, producer));
  producer.flush();
  producer.dispose();
  return producer.transcript;
}

/** The entries as `kind: text` (a tool as `tool: title status`), for comparing. */
export function rows(t: Transcript): string[] {
  return t.entries.map((entry) => {
    if (entry.tool) return `tool: ${entry.tool.title} ${entry.tool.status}`;
    if (entry.turn) return `turn: ${entry.turn.stop}`;
    if (entry.image) return `image: ${entry.from}`;
    return `${entry.kind}: ${entry.text}`;
  });
}

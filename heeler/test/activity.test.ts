// Heeler's Live Activity details as this package sends them: the canonical plaintext and its
// envelope must be the bytes the app opens, so the vectors are Heeler's own
// (`plugin/test-vectors/live-activity-content-v1.json`, Apache-2.0), shared with its Node hook and
// its Swift app.
import { expect, test } from "bun:test";
import {
  ACTIVITY_AAD,
  buildActivityState,
  canonicalActivity,
  deliverActivity,
  parseLayout,
  parsePins,
  plaintextAtStep,
  relayBody,
  renderRows,
  sealActivity,
  shortHostName,
  type ActivityDevice,
  type Plaintext,
} from "../src/activity.ts";
import { open } from "../src/seal.ts";
import type { AgentInfo } from "../src/types.ts";

interface Vector {
  name: string;
  key: string;
  envelope: string;
  payload: Plaintext;
  decodeOnly?: boolean;
  counts?: { working: number; blocked: number; done: number };
  pinned_pane_ids?: string[];
  inventory?: AgentInfo[];
}

const vectors = (await Bun.file(`${import.meta.dir}/vectors/live-activity-content-v1.json`).json()) as { valid: Vector[] };

test("every canonical vector is the activity envelope this package seals", () => {
  let canonical = 0;
  for (const vector of vectors.valid) {
    if (vector.decodeOnly) continue;
    const key = Buffer.from(vector.key, "base64url");
    const nonce = Buffer.from((JSON.parse(vector.envelope) as { n: string }).n, "base64url");
    expect(sealActivity(vector.payload, key, nonce)).toBe(vector.envelope);
    expect(canonicalActivity(vector.payload)).toBe(JSON.stringify(vector.payload));
    canonical += 1;
  }
  expect(canonical).toBe(7);
});

test("the counts, the pin order and the cap are the vector's", () => {
  let sorted = 0;
  for (const vector of vectors.valid) {
    if (vector.inventory === undefined || vector.counts === undefined) continue;
    const state = buildActivityState({
      agents: vector.inventory,
      host: vector.payload.host,
      pins: vector.pinned_pane_ids,
    });
    expect(state.counts).toEqual(vector.counts);
    expect(state.plaintext).toEqual(vector.payload);
    sorted += 1;
  }
  expect(sorted).toBe(2);
});

test("ineligible agents are hidden from the rows but never from the counts", () => {
  const agents = [
    { pane_id: "w1:p1", agent_status: "idle", agent: "pi" },
    { pane_id: "w1:p2", agent_status: "working", agent: "pi" },
    { pane_id: "w1:p3", agent_status: "both" },
  ] as unknown as AgentInfo[];
  const state = buildActivityState({ agents, host: "mbp" });
  expect(state.counts).toEqual({ working: 1, blocked: 0, done: 0 });
  expect(state.plaintext.agents.map((agent) => agent.pane)).toEqual(["w1:p2"]);
});

test("the size degradation drops titles and names, then rows, then every agent", () => {
  const plaintext: Plaintext = {
    agents: [
      {
        kind: "claude",
        name: "reviewer",
        pane: "w1:p1",
        rows: [[{ text: "Heeler" }]],
        status: "working",
        title: "t",
        workspace: "Heeler",
      },
    ],
    host: "mbp",
    v: 1,
  };
  expect(plaintextAtStep(plaintext, 0)).toEqual(plaintext);
  expect(plaintextAtStep(plaintext, 1).agents[0]).toEqual({
    kind: "claude",
    pane: "w1:p1",
    rows: [[{ text: "Heeler" }]],
    status: "working",
    workspace: "Heeler",
  });
  expect(plaintextAtStep(plaintext, 2).agents[0]).toEqual({ kind: "claude", pane: "w1:p1", status: "working", workspace: "Heeler" });
  expect(plaintextAtStep(plaintext, 3)).toEqual({ agents: [], host: "mbp", v: 1 });
});

test("a Device's layout renders its fields, styles and separators", () => {
  const layout = parseLayout({
    rows: [
      [{ token: "workspace", bold: true, fg: "#AbC" }, { token: "agent" }],
      [{ token: "directory", dim: true }],
    ],
  });
  expect(layout).not.toBeNull();
  const agent = {
    pane_id: "w1:p1",
    workspace_id: "w1",
    tab_id: "w1:t1",
    agent: "claude",
    name: "reviewer",
    agent_status: "working",
    cwd: "/work/Heeler",
  } as unknown as AgentInfo;
  const rows = renderRows(layout, agent, {
    hostName: "mbp",
    labels: new Map([["w1", "Heeler"]]),
    tabs: new Map(),
    panes: new Map(),
  });
  expect(rows).toEqual([
    [{ text: "Heeler", fg: "#AbC", bold: true }, { text: " · " }, { text: "reviewer" }],
    [{ text: "/work/Heeler", dim: true }],
  ]);
  // A layout the app could not use whole draws nothing; the app then keeps its legacy identity.
  expect(parseLayout({ rows: [[{ token: "nope" }]] })).toBeNull();
});

test("pins and host names are read leniently", () => {
  expect(parsePins(["w1:p2", "w1:p1"])).toEqual(["w1:p2", "w1:p1"]);
  expect(parsePins(["w1:p1", 7])).toEqual([]);
  expect(parsePins(undefined)).toEqual([]);
  expect(shortHostName("My-Mac.local")).toBe("My-Mac");
});


const key = Buffer.alloc(32, 7);
const device: ActivityDevice = { token: "ab".repeat(20), env: "production", key, pinned: [], layout: null };
const plaintext: Plaintext = {
  agents: [{ kind: "claude", name: "reviewer", pane: "w1:p1", status: "working", title: "t" }],
  host: "mbp",
  v: 1,
};
const request = {
  event: "update" as const,
  priority: 5 as const,
  timestamp: 1_700_000_000,
  counts: { working: 1, blocked: 0, done: 0 },
};

test("a Live Activity push is the relay body Heeler expects, sealed for its domain", async () => {
  let received: Record<string, unknown> | undefined;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      received = (await req.json()) as Record<string, unknown>;
      return new Response("ok");
    },
  });
  try {
    expect(await deliverActivity(`http://127.0.0.1:${server.port}`, 1, device, plaintext, request)).toBe("ok");
  } finally {
    server.stop(true);
  }
  const got = received;
  if (got === undefined) throw new Error("the relay got nothing");
  expect(got.kind).toBe("liveactivity");
  expect(got.event).toBe("update");
  expect(got.priority).toBe(5);
  expect(got.counts).toEqual(request.counts);
  expect(got.stale_date).toBe(request.timestamp + 900);
  expect(got.dismissal_date).toBeUndefined();
  // The app opens it with the activity AAD, and never as a notification.
  expect(JSON.parse(open(String(got.envelope), key, ACTIVITY_AAD))).toEqual(plaintext);
  expect(() => open(String(got.envelope), key, Buffer.from("HERDR-NOTIFY:1"))).toThrow();
});

test("a relay that says too large gets a degraded envelope, once per step", async () => {
  const bodies: Record<string, unknown>[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as Record<string, unknown>;
      bodies.push(body);
      if (bodies.length === 1) return new Response('{"error":"payload too large"}', { status: 413 });
      return new Response("ok");
    },
  });
  try {
    expect(await deliverActivity(`http://127.0.0.1:${server.port}`, 1, device, plaintext, request)).toBe("ok");
  } finally {
    server.stop(true);
  }
  expect(bodies).toHaveLength(2);
  expect(JSON.parse(open(String(bodies[1]?.envelope), key, ACTIVITY_AAD))).toEqual(
    plaintextAtStep(plaintext, 1),
  );
});

test("an end push says when to dismiss the activity", () => {
  const body = relayBody(device, "{}", { ...request, event: "end", priority: 10, counts: { working: 0, blocked: 0, done: 0 } });
  expect(body.dismissal_date).toBe(request.timestamp);
  expect(body.stale_date).toBeUndefined();
});

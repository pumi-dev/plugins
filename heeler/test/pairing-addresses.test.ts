// The address list a Pairing Code offers: what is routable, what is pre-checked, and where the
// tailnet's own addresses land.
import { describe, expect, test } from "bun:test";
import { candidateAddresses } from "../src/pairing/addresses.ts";

type Interfaces = Parameters<typeof candidateAddresses>[0];

function iface(address: string, family: "IPv4" | "IPv6", internal = false) {
  return { address, family, internal, netmask: "", cidr: `${address}/24`, mac: "00:00:00:00:00:00", scopeid: 0 };
}

function interfaces(spec: Record<string, [string, "IPv4" | "IPv6", boolean?][]>): Interfaces {
  return Object.fromEntries(
    Object.entries(spec).map(([name, entries]) => [name, entries.map(([address, family, internal]) => iface(address, family, internal))]),
  ) as Interfaces;
}

describe("candidateAddresses", () => {
  test("skips loopback and link-local, keeps routable addresses", () => {
    const candidates = candidateAddresses(
      interfaces({
        lo0: [
          ["127.0.0.1", "IPv4", true],
          ["::1", "IPv6", true],
        ],
        en0: [
          ["192.168.1.42", "IPv4"],
          ["169.254.10.20", "IPv4"],
          ["fe80::1c2d:3e4f:5a6b:7c8d", "IPv6"],
          ["2001:db8:85a3::8a2e:370:7334", "IPv6"],
        ],
      }),
      "darwin",
    );
    expect(candidates.map((candidate) => candidate.address)).toEqual([
      "192.168.1.42",
      "2001:db8:85a3::8a2e:370:7334",
    ]);
  });

  test("pre-checks only en0's likely address on macOS, listed first", () => {
    const candidates = candidateAddresses(
      interfaces({
        en1: [["10.0.0.7", "IPv4"]],
        en0: [
          ["192.168.1.42", "IPv4"],
          ["2001:db8::7", "IPv6"],
        ],
        utun3: [
          ["100.101.102.103", "IPv4"],
          ["fd7a:115c:a1e0::1", "IPv6"],
        ],
        en2: [["203.0.113.9", "IPv4"]],
      }),
      "darwin",
    );
    expect(Object.fromEntries(candidates.map((candidate) => [candidate.address, candidate.preChecked]))).toEqual({
      "192.168.1.42": true,
      "10.0.0.7": false,
      "100.101.102.103": false,
      "fd7a:115c:a1e0::1": false,
      "2001:db8::7": false,
      "203.0.113.9": false,
    });
    expect(candidates[0]?.address).toBe("192.168.1.42");
  });

  test("pre-checks only eth0's likely address on Linux, from either family", () => {
    const candidates = candidateAddresses(
      interfaces({
        docker0: [["172.17.0.1", "IPv4"]],
        wlan0: [["192.168.0.5", "IPv4"]],
        eth0: [["10.1.2.3", "IPv4"]],
      }),
      "linux",
    );
    expect(Object.fromEntries(candidates.map((candidate) => [candidate.address, candidate.preChecked]))).toEqual({
      "10.1.2.3": true,
      "192.168.0.5": false,
      "172.17.0.1": false,
    });
  });

  test("never pre-checks a public address, even on the primary interface", () => {
    const candidates = candidateAddresses(
      interfaces({
        en0: [["203.0.113.9", "IPv4"]],
        en1: [["192.168.1.42", "IPv4"]],
      }),
      "darwin",
    );
    expect(Object.fromEntries(candidates.map((candidate) => [candidate.address, candidate.preChecked]))).toEqual({
      "192.168.1.42": true,
      "203.0.113.9": false,
    });
  });

  test("Docker addresses are offered last and never pre-checked", () => {
    const candidates = candidateAddresses(
      interfaces({
        docker0: [["172.18.0.1", "IPv4"]],
        "br-1a2b3c4d5e6f": [["172.19.0.1", "IPv4"]],
        veth1234: [["10.0.0.2", "IPv4"]],
        en5: [["192.168.1.42", "IPv4"]],
      }),
      "darwin",
    );
    expect(candidates[0]?.address).toBe("192.168.1.42");
    expect(candidates[0]?.preChecked).toBe(true);
    expect(candidates.slice(1).map((candidate) => candidate.address)).toEqual([
      "172.18.0.1",
      "172.19.0.1",
      "10.0.0.2",
    ]);
    for (const candidate of candidates.slice(1)) {
      expect(candidate.preChecked).toBe(false);
    }
  });
});

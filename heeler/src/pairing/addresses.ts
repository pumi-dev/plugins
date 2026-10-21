// The addresses a Pairing Code offers, in the order the app should try them.
//
// The phone reaches this machine over the LAN or over whatever VPN the machine is on (a tailnet
// shows up as an ordinary interface), so every routable address is offered. One is pre-checked: the
// platform's primary interface when it carries a likely private address, else the best-ranked likely
// candidate. Docker/container addresses stay available, at the end, never pre-checked.
//
// PROVENANCE: Heeler `plugin/src/addresses.js` @ plugin 0.6.2 (Apache-2.0).

import os from "node:os";

export type Family = "IPv4" | "IPv6";

export interface Candidate {
  address: string;
  family: Family;
  interfaceName: string;
  preChecked: boolean;
}

const PRIMARY_INTERFACE_BY_PLATFORM: Record<string, string> = { darwin: "en0", linux: "eth0" };

/** Container bridges are offered last and never pre-checked. */
const DOCKER_INTERFACE_PATTERNS = [/^docker\d*$/i, /^br-[0-9a-f]+$/i, /^veth/i];

function isDockerInterface(name: string): boolean {
  return DOCKER_INTERFACE_PATTERNS.some((pattern) => pattern.test(name));
}

function octets(address: string): number[] {
  return address.split(".").map(Number);
}

function isIpv4LinkLocal(address: string): boolean {
  const [a, b] = octets(address);
  return a === 169 && b === 254;
}

function isIpv4Likely(address: string): boolean {
  const [a, b] = octets(address);
  if (a === 10) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true; // 100.64/10: CGNAT, Tailscale
  return false;
}

function isIpv6LinkLocal(address: string): boolean {
  return /^fe[89ab]/i.test(address);
}

function isIpv6Likely(address: string): boolean {
  return /^f[cd]/i.test(address); // fc00::/7: ULA, including Tailscale's fd7a:…
}

/**
 * Candidate addresses: the interfaces' routable ones, deduplicated, with one pre-checked. Loopback
 * and link-local are skipped; a zone id is dropped, since it means nothing off the machine.
 */
export function candidateAddresses(
  interfaces: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces(),
  platform: NodeJS.Platform = process.platform,
): Candidate[] {
  const found: { address: string; family: Family; interfaceName: string; likely: boolean; docker: boolean }[] = [];

  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    const docker = isDockerInterface(interfaceName);
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      const family = entry.family as Family;
      const address = entry.address.split("%")[0] ?? "";
      let likely: boolean;
      if (family === "IPv4") {
        if (isIpv4LinkLocal(address)) continue;
        likely = isIpv4Likely(address);
      } else if (family === "IPv6") {
        if (isIpv6LinkLocal(address)) continue;
        likely = isIpv6Likely(address);
      } else {
        continue;
      }
      found.push({ address, family, interfaceName, likely, docker });
    }
  }

  const rank = (candidate: (typeof found)[number]): number =>
    (candidate.docker ? 4 : 0) + (candidate.likely ? 0 : 2) + (candidate.family === "IPv4" ? 0 : 1);
  const seen = new Set<string>();
  const ordered = found.sort((a, b) => rank(a) - rank(b)).flatMap((candidate) => {
    if (seen.has(candidate.address)) return [];
    seen.add(candidate.address);
    return [candidate];
  });

  const primary = PRIMARY_INTERFACE_BY_PLATFORM[platform];
  const preferred =
    ordered.find((candidate) => !candidate.docker && candidate.likely && candidate.interfaceName === primary) ??
    ordered.find((candidate) => !candidate.docker && candidate.likely);

  return ordered
    .map(({ address, family, interfaceName }) => ({
      address,
      family,
      interfaceName,
      preChecked: preferred !== undefined && address === preferred.address,
    }))
    .sort((a, b) => Number(b.preChecked) - Number(a.preChecked));
}

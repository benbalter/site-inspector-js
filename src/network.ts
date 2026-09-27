// Which addresses the inspector may connect to. Checks that open raw TLS or
// TCP sockets to hosts discovered in DNS (MX hosts, CNAME targets) must only
// connect to public addresses, or a hostile DNS answer could point them at
// loopback, private-network, or cloud-metadata addresses (SSRF).

import dns from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
// IPv4
blocked.addSubnet("0.0.0.0", 8, "ipv4"); // "this" network
blocked.addSubnet("10.0.0.0", 8, "ipv4"); // private
blocked.addSubnet("100.64.0.0", 10, "ipv4"); // CGNAT
blocked.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
blocked.addSubnet("169.254.0.0", 16, "ipv4"); // link-local, incl. cloud metadata
blocked.addSubnet("172.16.0.0", 12, "ipv4"); // private
blocked.addSubnet("192.0.0.0", 24, "ipv4"); // IETF protocol assignments
blocked.addSubnet("192.168.0.0", 16, "ipv4"); // private
blocked.addSubnet("198.18.0.0", 15, "ipv4"); // benchmarking
blocked.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
blocked.addSubnet("240.0.0.0", 4, "ipv4"); // reserved + broadcast
// IPv6
blocked.addAddress("::", "ipv6"); // unspecified
blocked.addAddress("::1", "ipv6"); // loopback
blocked.addSubnet("fc00::", 7, "ipv6"); // unique local
blocked.addSubnet("fe80::", 10, "ipv6"); // link-local
blocked.addSubnet("ff00::", 8, "ipv6"); // multicast

/** True if `address` is a literal IP that is safe for the server to connect to. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6) {
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — judge the embedded IPv4 address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublicAddress(mapped[1]);
    return !blocked.check(address, "ipv6");
  }
  return !blocked.check(address, "ipv4");
}

/**
 * Resolve `host` and return its addresses if every one is public, or `null`
 * if any is not (or it doesn't resolve). Connect to a returned address
 * (with `servername: host` for TLS) rather than the name, so a second lookup
 * can't be rebound to a private address.
 */
export async function resolvePublic(host: string): Promise<string[] | null> {
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (addrs.length === 0 || !addrs.every((a) => isPublicAddress(a.address))) return null;
    return addrs.map((a) => a.address);
  } catch {
    return null;
  }
}

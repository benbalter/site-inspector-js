// Server-side network safety for the web API. The inspector fetches whatever
// domain it's given, so without these guards a request could make the server
// reach loopback, private-network, or cloud-metadata addresses (SSRF).

import dns from "node:dns";
import { isPublicAddress } from "site-inspector";
import { Agent, setGlobalDispatcher } from "undici";

// The address policy lives in the library so checks that open raw sockets to
// hosts found in DNS (MX, CNAME targets) apply the same rules.
export { isPublicAddress };

const HOSTNAME_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/i;

/** True if `host` is a syntactically valid public DNS name (not an IP literal). */
export function isValidHostname(host: string): boolean {
  return HOSTNAME_RE.test(host);
}

/**
 * Resolve `host` and confirm every address is public. Used as an up-front
 * check that also covers non-HTTP probes (TLS sockets, DNS, whois) that the
 * connect-time guard below doesn't see.
 */
export async function resolvesToPublicAddresses(host: string): Promise<boolean> {
  try {
    const addrs = await dns.promises.lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => isPublicAddress(a.address));
  } catch {
    // Unresolvable hosts are harmless — the inspector will report them as down.
    return true;
  }
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/** A `dns.lookup` replacement that refuses to hand back non-public addresses. */
export function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: LookupCallback,
): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad) {
      const e: NodeJS.ErrnoException = new Error(
        `Refusing to connect to non-public address ${bad.address} for ${hostname}`,
      );
      e.code = "ERR_NON_PUBLIC_ADDRESS";
      return callback(e, []);
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

let installed = false;

/**
 * Route every `fetch()` in this process through a dispatcher that checks the
 * resolved address at connect time. This covers redirect hops and is immune
 * to DNS rebinding between the up-front check and the actual connection.
 */
export function installFetchGuard(): void {
  if (installed) return;
  installed = true;
  setGlobalDispatcher(new Agent({ connect: { lookup: guardedLookup } }));
}

/** Whether the server should accept requests from non-loopback clients. */
export function publicMode(): boolean {
  return process.env.SITE_INSPECTOR_PUBLIC === "1";
}

/** True if `address` (as reported by the adapter) is a loopback client. */
export function isLoopbackClient(address: string | undefined): boolean {
  if (!address) return false;
  return address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");
}

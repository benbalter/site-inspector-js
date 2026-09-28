import tls from "node:tls";
import type { Check, CheckContext } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { resolvePublic } from "../network.js";
import { isIP, isIPv4 } from "node:net";

/** One alternative service from an `Alt-Svc` header (RFC 7838). */
export interface AltSvcEntry {
  protocol: string;
  authority: string;
  maxAge: number | null;
}

const H3_PROTOCOLS = /^h3(-\d+)?$/i;

/** Parse an `Alt-Svc` header value into its entries; `clear` yields none. */
export function parseAltSvc(value: string): AltSvcEntry[] {
  const entries: AltSvcEntry[] = [];
  for (const part of value.split(",")) {
    const [service, ...params] = part.split(";").map((s) => s.trim());
    const match = /^([^=\s]+)\s*=\s*"?([^"]*)"?$/.exec(service);
    if (!match) continue;
    const maParam = params.find((p) => /^ma\s*=/i.test(p));
    const ma = maParam ? Number(maParam.split("=")[1].trim()) : NaN;
    entries.push({
      protocol: match[1],
      authority: match[2],
      maxAge: Number.isFinite(ma) ? ma : null,
    });
  }
  return entries;
}

/**
 * Negotiate ALPN with the server. Resolves to the negotiated protocol, `""`
 * if the handshake worked but no protocol was agreed, or null if the
 * handshake failed (so we can't say either way).
 */
function negotiateAlpn(
  address: string,
  host: string,
  port: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null);
      return;
    }
    const socket = tls.connect(
      {
        host: address,
        port,
        // SNI can't carry an IP literal.
        ...(isIP(host) ? {} : { servername: host }),
        ALPNProtocols: ["h2", "http/1.1"],
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      () => {
        const proto = socket.alpnProtocol;
        finish(typeof proto === "string" ? proto : "");
      },
    );
    const onAbort = () => finish(null);
    function finish(value: string | null) {
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      resolve(value);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.on("error", () => finish(null));
    socket.on("timeout", () => finish(null));
  });
}

/**
 * Reports HTTP/2 support (negotiated via TLS ALPN against the requested
 * endpoint) and HTTP/3 advertisement (via the final response's `Alt-Svc`
 * header). HTTP/3 itself isn't probed, since Node has no stable QUIC client.
 */
export class HttpVersionsCheck implements Check {
  name = "http-versions";

  async run(endpoint: EndpointData, _domain: string, ctx?: CheckContext): Promise<CheckResult> {
    const url = new URL(endpoint.url);
    let alpnProtocol: string | null = null;
    let http2: boolean | null = null;
    let skipped: string | null = null;

    if (url.protocol !== "https:") {
      skipped = "not https";
    } else {
      // The endpoint may have redirected off the validated input domain, so
      // only connect to a public address.
      const host = url.hostname.replace(/^\[|\]$/g, "");
      const addrs = await resolvePublic(host);
      if (!addrs) {
        skipped = "non-public address or unresolvable";
      } else {
        const address = addrs.find((a) => isIPv4(a)) ?? addrs[0];
        const port = url.port ? Number(url.port) : 443;
        const timeoutMs = Math.min(ctx?.timeoutMs ?? 10_000, 10_000);
        const negotiated = await negotiateAlpn(address, host, port, timeoutMs, ctx?.signal);
        if (negotiated !== null) {
          alpnProtocol = negotiated || null;
          http2 = negotiated === "h2";
        }
      }
    }

    const altSvc = endpoint.headers["alt-svc"] ?? null;
    const entries = altSvc ? parseAltSvc(altSvc) : [];
    const h3 = entries.filter((e) => H3_PROTOCOLS.test(e.protocol));

    return {
      name: this.name,
      data: {
        http2,
        alpnProtocol,
        http3Advertised: h3.length > 0,
        http3Protocols: h3.map((e) => e.protocol),
        http3MaxAge: h3.length > 0 ? (h3[0].maxAge ?? 86400) : null,
        altSvc,
        skipped,
      },
    };
  }
}

import tls from "node:tls";
import { isIP, isIPv4 } from "node:net";
import type { Check, CheckContext } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { resolvePublic } from "../network.js";

// DER encoding of OID 1.3.6.1.5.5.7.1.24 (id-pe-tlsfeature, RFC 7633), the
// extension that marks a certificate "must staple".
const TLS_FEATURE_OID = Buffer.from("06082b06010505070118", "hex");

interface StapleProbe {
  /** Stapled OCSP response size in bytes (0 if none), or null if not reported. */
  responseBytes: number | null;
  mustStaple: boolean | null;
}

function probeStaple(
  address: string,
  host: string,
  port: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<StapleProbe | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null);
      return;
    }
    // Node emits OCSPResponse during the handshake: with the response, or
    // with null if the server stapled nothing.
    let responseBytes: number | null = null;
    const socket = tls.connect(
      {
        host: address,
        port,
        ...(isIP(host) ? {} : { servername: host }),
        requestOCSP: true,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      () => {
        const raw = socket.getPeerCertificate().raw as Buffer | undefined;
        finish({
          responseBytes,
          mustStaple: raw ? raw.includes(TLS_FEATURE_OID) : null,
        });
      },
    );
    const onAbort = () => finish(null);
    function finish(value: StapleProbe | null) {
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      resolve(value);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.on("OCSPResponse", (response: Buffer | null) => {
      responseBytes = response?.length ?? 0;
    });
    socket.on("error", () => finish(null));
    socket.on("timeout", () => finish(null));
  });
}

/**
 * Checks whether the server staples an OCSP response to its TLS handshake,
 * and whether its certificate demands stapling (the TLS Feature "must
 * staple" extension). Some CAs no longer run OCSP responders, so an
 * unstapled handshake is common and not necessarily a problem.
 */
export class OcspStaplingCheck implements Check {
  name = "ocsp-stapling";

  async run(endpoint: EndpointData, _domain: string, ctx?: CheckContext): Promise<CheckResult> {
    const url = new URL(endpoint.url);
    let probe: StapleProbe | null = null;
    let skipped: string | null = null;

    if (url.protocol !== "https:") {
      skipped = "not https";
    } else {
      const host = url.hostname.replace(/^\[|\]$/g, "");
      const addrs = await resolvePublic(host);
      if (!addrs) {
        skipped = "non-public address or unresolvable";
      } else {
        const address = addrs.find((a) => isIPv4(a)) ?? addrs[0];
        const port = url.port ? Number(url.port) : 443;
        const timeoutMs = Math.min(ctx?.timeoutMs ?? 10_000, 10_000);
        probe = await probeStaple(address, host, port, timeoutMs, ctx?.signal);
      }
    }

    const responseBytes = probe?.responseBytes ?? null;
    return {
      name: this.name,
      data: {
        stapled: responseBytes === null ? null : responseBytes > 0,
        responseBytes,
        mustStaple: probe?.mustStaple ?? null,
        skipped,
      },
    };
  }
}

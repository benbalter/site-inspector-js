import tls from "node:tls";
import { isIP, isIPv4 } from "node:net";
import { resolvePublic } from "../network.js";
import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

const TLS_VERSIONS = [
  {
    name: "TLSv1",
    minVersion: "TLSv1" as tls.SecureVersion,
    maxVersion: "TLSv1" as tls.SecureVersion,
  },
  {
    name: "TLSv1.1",
    minVersion: "TLSv1.1" as tls.SecureVersion,
    maxVersion: "TLSv1.1" as tls.SecureVersion,
  },
  {
    name: "TLSv1.2",
    minVersion: "TLSv1.2" as tls.SecureVersion,
    maxVersion: "TLSv1.2" as tls.SecureVersion,
  },
  {
    name: "TLSv1.3",
    minVersion: "TLSv1.3" as tls.SecureVersion,
    maxVersion: "TLSv1.3" as tls.SecureVersion,
  },
];

function testTlsVersion(
  address: string,
  host: string,
  port: number,
  minVersion: tls.SecureVersion,
  maxVersion: tls.SecureVersion,
): Promise<boolean> {
  return new Promise((resolve) => {
    // OpenSSL 3's default security level refuses TLS 1.0/1.1 handshakes
    // outright, so lower it for those probes or they'd always "fail".
    const legacy = maxVersion === "TLSv1" || maxVersion === "TLSv1.1";
    const socket = tls.connect(
      {
        host: address,
        // SNI can't be an IP literal.
        ...(isIP(host) === 0 && { servername: host }),
        port,
        minVersion,
        maxVersion,
        rejectUnauthorized: false,
        timeout: 5000,
        ...(legacy && { ciphers: "DEFAULT@SECLEVEL=0" }),
      },
      () => {
        socket.destroy();
        resolve(true);
      },
    );
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export class TlsVersionsCheck implements Check {
  name = "tls-versions";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const url = new URL(endpoint.url);
    const host = url.hostname;
    const port = url.port ? Number(url.port) : 443;

    // The endpoint may have redirected to a host other than the vetted input
    // domain, so only connect to a public address (SSRF).
    const addrs = await resolvePublic(host);
    if (!addrs) {
      return {
        name: this.name,
        data: {
          supported: null,
          deprecated: [],
          hasDeprecated: null,
          tls13: null,
          minimumVersion: null,
          skipped: "non-public address or unresolvable",
        },
      };
    }
    const address = addrs.find((a) => isIPv4(a)) ?? addrs[0];

    const results = await Promise.all(
      TLS_VERSIONS.map(async (v) => ({
        version: v.name,
        supported: await testTlsVersion(address, host, port, v.minVersion, v.maxVersion),
      })),
    );

    const supported: Record<string, boolean> = {};
    for (const r of results) {
      supported[r.version] = r.supported;
    }

    const deprecated = Object.entries(supported)
      .filter(([v, s]) => s && (v === "TLSv1" || v === "TLSv1.1"))
      .map(([v]) => v);

    const latestSupported = supported["TLSv1.3"];

    return {
      name: this.name,
      data: {
        supported,
        deprecated,
        hasDeprecated: deprecated.length > 0,
        tls13: latestSupported,
        minimumVersion: results.find((r) => r.supported)?.version ?? null,
        skipped: null,
      },
    };
  }
}

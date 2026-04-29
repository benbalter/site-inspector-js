import tls from "node:tls";
import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

const TLS_VERSIONS = [
  { name: "TLSv1", minVersion: "TLSv1" as tls.SecureVersion, maxVersion: "TLSv1" as tls.SecureVersion },
  { name: "TLSv1.1", minVersion: "TLSv1.1" as tls.SecureVersion, maxVersion: "TLSv1.1" as tls.SecureVersion },
  { name: "TLSv1.2", minVersion: "TLSv1.2" as tls.SecureVersion, maxVersion: "TLSv1.2" as tls.SecureVersion },
  { name: "TLSv1.3", minVersion: "TLSv1.3" as tls.SecureVersion, maxVersion: "TLSv1.3" as tls.SecureVersion },
];

function testTlsVersion(host: string, port: number, minVersion: tls.SecureVersion, maxVersion: tls.SecureVersion): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port, minVersion, maxVersion, rejectUnauthorized: false, timeout: 5000 },
      () => { socket.destroy(); resolve(true); }
    );
    socket.on("error", () => { socket.destroy(); resolve(false); });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
  });
}

export class TlsVersionsCheck implements Check {
  name = "tls-versions";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const url = new URL(endpoint.url);
    const host = url.hostname;
    const port = url.port ? Number(url.port) : 443;

    const results = await Promise.all(
      TLS_VERSIONS.map(async (v) => ({
        version: v.name,
        supported: await testTlsVersion(host, port, v.minVersion, v.maxVersion),
      }))
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
        minimumVersion: results.find(r => r.supported)?.version ?? null,
      },
    };
  }
}

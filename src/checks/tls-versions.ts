import net from "node:net";
import tls from "node:tls";
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
        host,
        port,
        // Without SNI, CDNs like Cloudflare abort the handshake for every
        // version. RFC 6066 forbids IP addresses as server names.
        ...(!net.isIP(host) && { servername: host }),
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

/** What a default handshake negotiates beyond the protocol version. */
interface Extensions {
  /** The ALPN protocol the server picked, or null if it picked none. */
  alpnProtocol: string | null;
  /** Whether the server stapled an OCSP response. */
  ocspStapling: boolean;
}

/** Handshake once, offering HTTP/2 over ALPN and asking for a stapled OCSP response. */
function probeExtensions(host: string, port: number): Promise<Extensions | null> {
  return new Promise((resolve) => {
    let ocspStapling = false;
    const socket = tls.connect(
      {
        host,
        port,
        ...(!net.isIP(host) && { servername: host }),
        ALPNProtocols: ["h2", "http/1.1"],
        requestOCSP: true,
        rejectUnauthorized: false,
        timeout: 5000,
      },
      () => {
        const alpnProtocol = socket.alpnProtocol || null;
        socket.destroy();
        resolve({ alpnProtocol, ocspStapling });
      },
    );
    // Emitted before the handshake completes, with null if nothing was stapled.
    socket.on("OCSPResponse", (response: Buffer | null) => {
      ocspStapling = (response?.length ?? 0) > 0;
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(null);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

/** Whether an Alt-Svc header advertises HTTP/3 (`h3`, or a draft like `h3-29`). */
function advertisesHttp3(altSvc: string | undefined): boolean {
  return /(?:^|,)\s*h3(?:-\d+)?=/.test(altSvc ?? "");
}

export class TlsVersionsCheck implements Check {
  name = "tls-versions";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    const url = new URL(endpoint.url);
    const host = url.hostname;
    const port = url.port ? Number(url.port) : 443;

    const [extensions, ...results] = await Promise.all([
      probeExtensions(host, port),
      ...TLS_VERSIONS.map(async (v) => ({
        version: v.name,
        supported: await testTlsVersion(host, port, v.minVersion, v.maxVersion),
      })),
    ]);

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
        alpnProtocol: extensions?.alpnProtocol ?? null,
        http2: extensions ? extensions.alpnProtocol === "h2" : null,
        http3: advertisesHttp3(endpoint.headers["alt-svc"]),
        ocspStapling: extensions?.ocspStapling ?? null,
      },
    };
  }
}

import tls from "node:tls";
import { isIP, isIPv4 } from "node:net";
import type { Check, CheckContext } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { resolvePublic } from "../network.js";

/** TLS 1.2 suites with static RSA key exchange (no forward secrecy). */
export const STATIC_RSA_SUITES = [
  "AES128-GCM-SHA256",
  "AES256-GCM-SHA384",
  "AES128-SHA",
  "AES256-SHA",
  "AES128-SHA256",
  "AES256-SHA256",
];

/** TLS 1.2 CBC-mode suites, for both RSA and ECDSA certificates. */
export const CBC_SUITES = [
  "ECDHE-ECDSA-AES128-SHA",
  "ECDHE-ECDSA-AES256-SHA",
  "ECDHE-ECDSA-AES128-SHA256",
  "ECDHE-ECDSA-AES256-SHA384",
  "ECDHE-RSA-AES128-SHA",
  "ECDHE-RSA-AES256-SHA",
  "ECDHE-RSA-AES128-SHA256",
  "ECDHE-RSA-AES256-SHA384",
  "DHE-RSA-AES128-SHA",
  "DHE-RSA-AES256-SHA",
  "AES128-SHA",
  "AES256-SHA",
  "AES128-SHA256",
  "AES256-SHA256",
];

export const TRIPLE_DES_SUITES = ["DES-CBC3-SHA", "ECDHE-RSA-DES-CBC3-SHA"];

/** Legacy families we'd want to test but modern OpenSSL builds can't offer. */
const LEGACY_FAMILIES: Record<string, string[]> = {
  "3DES": TRIPLE_DES_SUITES,
  RC4: ["RC4-SHA", "RC4-MD5", "ECDHE-RSA-RC4-SHA"],
  EXPORT: ["EXP-RC4-MD5", "EXP-DES-CBC-SHA"],
};

// Lower OpenSSL's security level so local policy never refuses a suite.
const seclevel0 = (suites: string[]) => `${suites.join(":")}:@SECLEVEL=0`;

/** The subset of `suites` this Node's OpenSSL can actually offer. */
export function offerable(suites: string[]): string[] {
  return suites.filter((suite) => {
    try {
      tls.createSecureContext({ ciphers: seclevel0([suite]) });
      return true;
    } catch {
      return false;
    }
  });
}

// Errors that mean the server actually refused what we offered. Anything
// else (resets, timeouts) proves nothing, so it's reported as unknown.
const REFUSED =
  /ALERT_HANDSHAKE_FAILURE|NO_SHARED_CIPHER|ALERT_PROTOCOL_VERSION|ALERT_INSUFFICIENT_SECURITY/;

interface Handshake {
  cipher: string;
  version: string | null;
}

type ProbeResult = Handshake | "refused" | null;

function handshake(
  address: string,
  host: string,
  port: number,
  timeoutMs: number,
  options: tls.ConnectionOptions,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null);
      return;
    }
    let socket: tls.TLSSocket;
    try {
      socket = tls.connect(
        {
          host: address,
          port,
          ...(isIP(host) ? {} : { servername: host }),
          rejectUnauthorized: false,
          timeout: timeoutMs,
          ...options,
        },
        () => finish({ cipher: socket.getCipher().name, version: socket.getProtocol() }),
      );
    } catch {
      resolve(null);
      return;
    }
    const onAbort = () => finish(null);
    function finish(value: ProbeResult) {
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      resolve(value);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.on("error", (err: NodeJS.ErrnoException) =>
      finish(REFUSED.test(`${err.code ?? ""} ${err.message}`) ? "refused" : null),
    );
    socket.on("timeout", () => finish(null));
  });
}

const accepted = (r: ProbeResult): boolean | null =>
  r === null ? null : r === "refused" ? false : true;

/**
 * Probes which weak TLS 1.2 cipher suites the server accepts: static-RSA key
 * exchange (no forward secrecy), CBC mode, and 3DES. It can only offer what
 * the local OpenSSL supports; OpenSSL 3 can't offer RC4 or export suites
 * (and often not 3DES), so those are listed in `untestable` and their
 * absence is never claimed.
 */
export class TlsCiphersCheck implements Check {
  name = "tls-ciphers";

  async run(endpoint: EndpointData, _domain: string, ctx?: CheckContext): Promise<CheckResult> {
    const untestable = Object.entries(LEGACY_FAMILIES)
      .filter(([, suites]) => offerable(suites).length === 0)
      .map(([family]) => family);
    const tripleDes = offerable(TRIPLE_DES_SUITES);

    const data = {
      negotiatedCipher: null as string | null,
      negotiatedVersion: null as string | null,
      staticRsaAccepted: null as boolean | null,
      cbcAccepted: null as boolean | null,
      tripleDesAccepted: null as boolean | null,
      forwardSecrecyOnly: null as boolean | null,
      untestable,
      skipped: null as string | null,
    };

    const url = new URL(endpoint.url);
    if (url.protocol !== "https:") {
      data.skipped = "not https";
      return { name: this.name, data };
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addrs = await resolvePublic(host);
    if (!addrs) {
      data.skipped = "non-public address or unresolvable";
      return { name: this.name, data };
    }
    const address = addrs.find((a) => isIPv4(a)) ?? addrs[0];
    const port = url.port ? Number(url.port) : 443;
    const timeoutMs = Math.min(ctx?.timeoutMs ?? 10_000, 10_000);
    const probe = (options: tls.ConnectionOptions) =>
      handshake(address, host, port, timeoutMs, options, ctx?.signal);

    const baseline = await probe({});
    if (baseline === null || baseline === "refused") return { name: this.name, data };
    data.negotiatedCipher = baseline.cipher;
    data.negotiatedVersion = baseline.version;

    const tls12 = { minVersion: "TLSv1.2", maxVersion: "TLSv1.2" } as const;
    // Offering nothing would fall back to defaults, so skip empty sets.
    const probeSuites = (suites: string[]) =>
      suites.length > 0 ? probe({ ...tls12, ciphers: seclevel0(suites) }) : Promise.resolve(null);
    const [staticRsa, cbc, des] = await Promise.all([
      probeSuites(offerable(STATIC_RSA_SUITES)),
      probeSuites(offerable(CBC_SUITES)),
      probeSuites(tripleDes),
    ]);

    data.staticRsaAccepted = accepted(staticRsa);
    data.cbcAccepted = accepted(cbc);
    data.tripleDesAccepted = accepted(des);
    data.forwardSecrecyOnly = data.staticRsaAccepted === null ? null : !data.staticRsaAccepted;
    return { name: this.name, data };
  }
}

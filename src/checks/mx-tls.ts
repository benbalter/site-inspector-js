import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import type { Check, CheckContext } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { resolvePublic } from "../network.js";

const DNS_ABSENT = new Set(["ENODATA", "ENOTFOUND"]);
const MAX_HOSTS = 5;
const PER_HOST_TIMEOUT_MS = 10_000;
const EHLO_NAME = "site-inspector.local";

/** What we learned about one MX host. */
export interface MxHostResult {
  host: string;
  priority: number;
  /** A TCP connection to port 25 succeeded. */
  reachable: boolean;
  /** STARTTLS was advertised in the EHLO reply; null if we couldn't get that far. */
  starttls: boolean | null;
  tlsVersion: string | null;
  /** The certificate chains to a trusted root and matches the host name. */
  certValid: boolean | null;
  certError: string | null;
  /** ISO timestamp the certificate expires. */
  certExpires: string | null;
  /** Why the host wasn't probed at all, or null if it was. */
  skipped: string | null;
  /** Where the SMTP conversation failed, or null if it didn't. */
  error: string | null;
}

type SmtpOutcome = Omit<MxHostResult, "host" | "priority" | "skipped">;

interface Reply {
  code: number;
  lines: string[];
}

/**
 * Talk SMTP to `address` just far enough to see whether it offers STARTTLS,
 * then upgrade and look at the certificate. Every step is bounded by one
 * deadline, and any failure leaves unknowns as null.
 */
function probeSmtp(
  address: string,
  host: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<SmtpOutcome> {
  const out: SmtpOutcome = {
    reachable: false,
    starttls: null,
    tlsVersion: null,
    certValid: null,
    certError: null,
    certExpires: null,
    error: null,
  };

  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ...out, error: "aborted" });
      return;
    }
    let rejectFailed: (err: Error) => void = () => undefined;
    const failed = new Promise<never>((_, reject) => (rejectFailed = reject));
    failed.catch(() => undefined);
    const race = <T>(p: Promise<T>) => Promise.race([p, failed]);

    const socket = net.connect({ host: address, port: 25 });
    let secure: tls.TLSSocket | null = null;

    let buffer = "";
    let wake: (() => void) | null = null;
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("latin1");
      wake?.();
    };
    socket.on("data", onData);
    socket.on("error", (err) => rejectFailed(err));
    socket.on("close", () => rejectFailed(new Error("connection closed")));

    const timer = setTimeout(() => rejectFailed(new Error("timed out")), timeoutMs);
    const onAbort = () => rejectFailed(new Error("aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });

    async function readReply(): Promise<Reply> {
      const lines: string[] = [];
      for (;;) {
        const nl = buffer.indexOf("\n");
        if (nl === -1) {
          await race(new Promise<void>((r) => (wake = r)));
          continue;
        }
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        lines.push(line);
        // Multi-line replies use "250-"; the last line uses "250 " (RFC 5321 §4.2.1).
        const final = /^(\d{3})(?: |$)/.exec(line);
        if (final) return { code: Number(final[1]), lines };
      }
    }

    async function converse(): Promise<void> {
      await race(new Promise<void>((r) => socket.once("connect", () => r())));
      out.reachable = true;

      const banner = await readReply();
      if (banner.code !== 220) throw new Error(`greeting was ${banner.code}`);

      socket.write(`EHLO ${EHLO_NAME}\r\n`);
      const ehlo = await readReply();
      if (ehlo.code !== 250) throw new Error(`EHLO was ${ehlo.code}`);
      out.starttls = ehlo.lines.some((l) => /^250[ -]STARTTLS\b/i.test(l));
      if (!out.starttls) {
        socket.end("QUIT\r\n");
        return;
      }

      socket.write("STARTTLS\r\n");
      const ready = await readReply();
      if (ready.code !== 220) throw new Error(`STARTTLS was ${ready.code}`);

      socket.removeListener("data", onData);
      const upgraded = tls.connect({
        socket,
        ...(net.isIP(host) ? {} : { servername: host }),
        // Accept any certificate so we can report why it's invalid.
        rejectUnauthorized: false,
      });
      secure = upgraded;
      upgraded.on("error", (err) => rejectFailed(err));
      await race(new Promise<void>((r) => upgraded.once("secureConnect", () => r())));

      out.tlsVersion = upgraded.getProtocol();
      out.certValid = upgraded.authorized;
      out.certError = upgraded.authorizationError ? String(upgraded.authorizationError) : null;
      const validTo = upgraded.getPeerCertificate().valid_to;
      const expires = validTo ? new Date(validTo) : null;
      out.certExpires = expires && !Number.isNaN(expires.getTime()) ? expires.toISOString() : null;
      upgraded.end("QUIT\r\n");
    }

    converse().then(
      () => done(false),
      (err: unknown) => {
        out.error = err instanceof Error ? err.message : String(err);
        done(true);
      },
    );

    function done(failure: boolean) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const sockets = [secure, socket].filter((s) => s !== null);
      if (failure) {
        for (const s of sockets) s.destroy();
      } else {
        // Give QUIT a moment to flush, then make sure nothing lingers.
        setTimeout(() => sockets.forEach((s) => s.destroy()), 1000).unref();
      }
      resolve(out);
    }
  });
}

async function probeHost(
  host: string,
  priority: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<MxHostResult> {
  const base = { host, priority };
  const addrs = await resolvePublic(host);
  if (!addrs) {
    return {
      ...base,
      reachable: false,
      starttls: null,
      tlsVersion: null,
      certValid: null,
      certError: null,
      certExpires: null,
      skipped: "non-public address or unresolvable",
      error: null,
    };
  }
  // Many networks have no IPv6 route; trying v6 first would look like an outage.
  const address = addrs.find((a) => net.isIPv4(a)) ?? addrs[0];
  return { ...base, skipped: null, ...(await probeSmtp(address, host, timeoutMs, signal)) };
}

/**
 * Checks whether the domain's mail servers accept mail over TLS (STARTTLS
 * on port 25) and whether their certificates are valid. Outbound port 25 is
 * blocked on many residential and cloud networks, so an unreachable host is
 * reported as unknown (`starttls: null`), never as lacking STARTTLS.
 */
export class MxTlsCheck implements Check {
  name = "mx-tls";

  async run(_endpoint: EndpointData, domain: string, ctx?: CheckContext): Promise<CheckResult> {
    let records: { exchange: string; priority: number }[] = [];
    let error: string | null = null;
    try {
      records = await dns.resolveMx(domain);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!code || !DNS_ABSENT.has(code)) {
        error = code ?? (err instanceof Error ? err.message : String(err));
      }
    }

    // A "null MX" (RFC 7505) has an empty exchange and means "no mail here".
    const mailHosts = records
      .filter((r) => r.exchange !== "" && r.exchange !== ".")
      .sort((a, b) => a.priority - b.priority);
    const nullMx = records.length > 0 && mailHosts.length === 0;

    const timeoutMs = Math.min(ctx?.timeoutMs ?? PER_HOST_TIMEOUT_MS, PER_HOST_TIMEOUT_MS);
    const hosts = await Promise.all(
      mailHosts
        .slice(0, MAX_HOSTS)
        .map((r) => probeHost(r.exchange.replace(/\.$/, ""), r.priority, timeoutMs, ctx?.signal)),
    );

    const reachable = hosts.filter((h) => h.reachable);
    const known = reachable.map((h) => h.starttls);
    const allStarttls = known.includes(false)
      ? false
      : known.length > 0 && known.every((s) => s === true)
        ? true
        : null;

    // Aggregates over hosts whose TLS handshake completed (array items aren't graded).
    const certs = hosts.map((h) => h.certValid).filter((v) => v !== null);
    const allCertsValid = certs.length > 0 ? certs.every(Boolean) : null;
    const expiries = hosts.flatMap((h) => (h.certExpires ? [h.certExpires] : []));

    return {
      name: this.name,
      data: {
        hasMx: error ? null : mailHosts.length > 0,
        nullMx,
        hosts,
        allStarttls,
        allCertsValid,
        earliestCertExpiry: expiries.length > 0 ? expiries.sort()[0] : null,
        anyReachable: hosts.length > 0 ? reachable.length > 0 : null,
        error,
      },
    };
  }
}

import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import type { Check, CheckContext } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

/** Most MX hosts to connect to, lowest preference first. */
const MAX_MX_HOSTS = 2;
const SMTP_PORT = 25;
const DEFAULT_TIMEOUT_MS = 10_000;

/** What one mail server said about TLS. */
export interface SmtpProbe {
  host: string;
  /** Whether we got an SMTP greeting at all. Many networks block port 25. */
  connected: boolean;
  /** Whether the server offered STARTTLS; null if we never got that far. */
  starttls: boolean | null;
  /** The negotiated TLS version after STARTTLS, e.g. "TLSv1.3". */
  tlsVersion: string | null;
  /** Whether the server's certificate validated for its hostname. */
  certificateValid: boolean | null;
  /** Why the certificate didn't validate, or why the probe stopped. */
  error: string | null;
}

/**
 * Read SMTP replies off a socket. A reply is one or more lines: `250-…`
 * continues it, `250 …` ends it (RFC 5321 §4.2.1).
 */
function replyReader(socket: net.Socket) {
  let buffer = "";
  let lines: string[] = [];
  let pending: { resolve: (r: { code: number; lines: string[] }) => void } | null = null;
  const queue: { code: number; lines: string[] }[] = [];

  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("latin1");
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      lines.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), lines };
        lines = [];
        if (pending) {
          pending.resolve(reply);
          pending = null;
        } else {
          queue.push(reply);
        }
      }
    }
  });

  return (): Promise<{ code: number; lines: string[] }> => {
    const queued = queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => {
      pending = { resolve };
    });
  };
}

/**
 * Connect to a mail server, check that it offers STARTTLS, and upgrade the
 * connection to see what TLS it negotiates. Sends nothing beyond EHLO,
 * STARTTLS, and QUIT: no mail is ever sent.
 */
export function probeSmtp(
  host: string,
  port: number = SMTP_PORT,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<SmtpProbe> {
  const result: SmtpProbe = {
    host,
    connected: false,
    starttls: null,
    tlsVersion: null,
    certificateValid: null,
    error: null,
  };

  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let tlsSocket: tls.TLSSocket | null = null;
    let settled = false;
    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error && !result.error) result.error = error;
      tlsSocket?.destroy();
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish("Timed out"), timeoutMs);
    const onAbort = () => finish("Aborted");
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.on("error", (err: NodeJS.ErrnoException) => finish(err.code ?? err.message));

    const nextReply = replyReader(socket);
    const send = (command: string) => socket.write(`${command}\r\n`);

    void (async () => {
      const greeting = await nextReply();
      if (greeting.code !== 220) return finish(`Unexpected greeting: ${greeting.lines[0]}`);
      result.connected = true;

      send("EHLO site-inspector.invalid");
      const ehlo = await nextReply();
      if (ehlo.code !== 250) return finish(`EHLO refused: ${ehlo.lines[0]}`);
      result.starttls = ehlo.lines.some((l) => /^250[ -]STARTTLS\b/i.test(l));
      if (!result.starttls) {
        // Destroying the socket right after write() would drop the QUIT.
        socket.end("QUIT\r\n", () => finish());
        return;
      }

      send("STARTTLS");
      const ready = await nextReply();
      if (ready.code !== 220) return finish(`STARTTLS refused: ${ready.lines[0]}`);

      socket.removeAllListeners("data");
      tlsSocket = tls.connect(
        {
          socket,
          ...(!net.isIP(host) && { servername: host }),
          // Validity is reported, not enforced: plenty of mail servers use
          // certificates that wouldn't pass, and the TLS still protects mail.
          rejectUnauthorized: false,
        },
        () => {
          if (!tlsSocket) return;
          result.tlsVersion = tlsSocket.getProtocol();
          result.certificateValid = tlsSocket.authorized;
          if (!tlsSocket.authorized) result.error = String(tlsSocket.authorizationError);
          tlsSocket.end("QUIT\r\n", () => finish());
        },
      );
      tlsSocket.on("error", (err: NodeJS.ErrnoException) =>
        finish(`TLS handshake failed: ${err.code ?? err.message}`),
      );
    })();
  });
}

/**
 * Whether the domain's mail servers offer STARTTLS, and the TLS version and
 * certificate they use, like internet.nl's and MXToolbox's SMTP tests.
 *
 * Marked heavy, though it doesn't launch a browser, because it opens raw
 * sockets to hosts other than the inspected domain (whatever its MX records
 * name), outside the web UI's fetch guard. Heavy checks don't run in public
 * mode. Many networks also block outbound port 25, which shows up as
 * `connected: false` rather than as a missing STARTTLS.
 */
export class SmtpTlsCheck implements Check {
  name = "smtp-tls";
  heavy = true;

  async run(_endpoint: EndpointData, domain: string, ctx?: CheckContext): Promise<CheckResult> {
    let mxHosts: string[] = [];
    try {
      mxHosts = (await dns.resolveMx(domain))
        .filter((r) => r.exchange !== "")
        .sort((a, b) => a.priority - b.priority)
        .map((r) => r.exchange.toLowerCase())
        .slice(0, MAX_MX_HOSTS);
    } catch {
      // No MX records: nothing to probe.
    }

    const servers = await Promise.all(
      mxHosts.map((host) => probeSmtp(host, SMTP_PORT, DEFAULT_TIMEOUT_MS, ctx?.signal)),
    );
    const reached = servers.filter((s) => s.connected);

    return {
      name: this.name,
      data: {
        mxHosts,
        connected: mxHosts.length === 0 ? null : reached.length > 0,
        // Judged on the servers we reached; null if we reached none.
        starttls: reached.length === 0 ? null : reached.every((s) => s.starttls),
        validCertificates:
          reached.length === 0 || reached.some((s) => s.certificateValid === null)
            ? null
            : reached.every((s) => s.certificateValid),
        servers,
      },
    };
  }
}

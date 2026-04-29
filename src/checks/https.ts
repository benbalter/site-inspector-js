import tls from "node:tls";
import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

const DEFAULT_TIMEOUT_MS = 10_000;

interface CertInfo {
  valid: boolean;
  cert: tls.PeerCertificate;
  protocol: string | null;
}

function getCertInfo(
  domain: string,
  timeoutMs: number,
): Promise<CertInfo> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      443,
      domain,
      { servername: domain, timeout: timeoutMs },
      () => {
        const cert = socket.getPeerCertificate();
        const protocol = socket.getProtocol();
        socket.end();
        resolve({ valid: socket.authorized, cert, protocol });
      },
    );
    socket.on("error", (err) => {
      socket.destroy();
      reject(err);
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("TLS connection timed out"));
    });
  });
}

function extractIssuer(cert: tls.PeerCertificate): string {
  const cn = cert.issuer?.CN;
  const o = cert.issuer?.O;
  const val = cn || o || "Unknown";
  return Array.isArray(val) ? val[0] : val;
}

function daysUntil(dateStr: string): number {
  const expiry = new Date(dateStr);
  const now = new Date();
  return Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export class HttpsCheck implements Check {
  name = "https";

  async run(_endpoint: EndpointData, domain: string): Promise<CheckResult> {
    try {
      const { valid, cert, protocol } = await getCertInfo(
        domain,
        DEFAULT_TIMEOUT_MS,
      );
      const certExpiry = new Date(cert.valid_to).toISOString();
      return {
        name: this.name,
        data: {
          valid,
          certIssuer: extractIssuer(cert),
          certExpiry,
          certDaysRemaining: daysUntil(cert.valid_to),
          protocol: protocol ?? "unknown",
          error: null,
        },
      };
    } catch (err) {
      return {
        name: this.name,
        data: {
          valid: false,
          certIssuer: null,
          certExpiry: null,
          certDaysRemaining: null,
          protocol: null,
          error: (err as Error).message,
        },
      };
    }
  }
}

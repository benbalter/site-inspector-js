import type { EndpointData, CheckResult } from "../types.js";
import type { Check } from "./check.js";

interface ServerTimingEntry {
  name: string;
  duration: number | null;
  description: string | null;
}

function parseServerTiming(header: string): ServerTimingEntry[] {
  return header.split(",").map((entry) => {
    const parts = entry.trim().split(";").map((p) => p.trim());
    const name = parts[0];
    let duration: number | null = null;
    let description: string | null = null;

    for (const part of parts.slice(1)) {
      const eqIndex = part.indexOf("=");
      if (eqIndex === -1) continue;
      const key = part.slice(0, eqIndex).trim().toLowerCase();
      let value = part.slice(eqIndex + 1).trim();
      if (key === "dur") {
        duration = parseFloat(value);
        if (isNaN(duration)) duration = null;
      } else if (key === "desc") {
        // Strip surrounding quotes
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        description = value;
      }
    }

    return { name, duration, description };
  });
}

function categorizeSize(bytes: number): string {
  if (bytes < 10_000) return "tiny";
  if (bytes < 100_000) return "small";
  if (bytes < 500_000) return "medium";
  if (bytes < 1_000_000) return "large";
  return "huge";
}

export class PerformanceCheck implements Check {
  name = "performance";

  async run(endpoint: EndpointData, _domain: string): Promise<CheckResult> {
    let responseTimeMs: number;
    try {
      const start = Date.now();
      const response = await fetch(endpoint.url, {
        signal: AbortSignal.timeout(10000),
      });
      await response.text();
      responseTimeMs = Date.now() - start;
    } catch {
      responseTimeMs = -1;
    }

    const contentLengthHeader = endpoint.headers["content-length"];
    const contentLengthBytes = contentLengthHeader
      ? parseInt(contentLengthHeader, 10)
      : endpoint.body.length;

    const contentEncoding = endpoint.headers["content-encoding"] ?? null;
    const compressed = contentEncoding !== null;

    const sizeCategory = categorizeSize(contentLengthBytes);
    const redirectCount = endpoint.redirectChain.length;

    const serverTimingHeader = endpoint.headers["server-timing"];
    const serverTiming: ServerTimingEntry[] = serverTimingHeader
      ? parseServerTiming(serverTimingHeader)
      : [];

    return {
      name: this.name,
      data: {
        responseTimeMs,
        contentLengthBytes,
        contentEncoding,
        compressed,
        sizeCategory,
        redirectCount,
        serverTiming,
      },
    };
  }
}

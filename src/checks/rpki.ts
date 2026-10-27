import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { fetchJson, resolveIp } from "../utils.js";

const LOOKUP_TIMEOUT_MS = 8_000;

interface RipestatResponse<T> {
  data?: T;
}

/**
 * Route origin validation for the site's address: whether the network
 * announcing it is authorized to, per the RPKI. A valid route is protected
 * from accidental or malicious hijacks by networks that filter invalid ones.
 * Uses RIPEstat, which covers every regional registry.
 */
export class RpkiCheck implements Check {
  name = "rpki";

  async run(_endpoint: EndpointData, domain: string): Promise<CheckResult> {
    const ip = await resolveIp(domain);
    const result = (fields: Record<string, unknown>): CheckResult => ({
      name: this.name,
      data: {
        ip,
        asn: null,
        prefix: null,
        status: null,
        valid: null,
        invalid: null,
        lookupFailed: false,
        ...fields,
      },
    });
    if (!ip) return result({});

    const ripestat = (path: string, params: Record<string, string>) =>
      fetchJson(
        `https://stat.ripe.net/data/${path}/data.json?${new URLSearchParams({ ...params, sourceapp: "site-inspector" })}`,
        LOOKUP_TIMEOUT_MS,
      );

    const info = (await ripestat("network-info", { resource: ip })) as RipestatResponse<{
      asns?: string[];
      prefix?: string;
    }> | null;
    const asn = info?.data?.asns?.[0];
    const prefix = info?.data?.prefix;
    if (!asn || !prefix) return result({ lookupFailed: true });

    const validation = (await ripestat("rpki-validation", {
      resource: asn,
      prefix,
    })) as RipestatResponse<{ status?: string }> | null;
    const status = validation?.data?.status;
    if (!status) return result({ asn: Number(asn), prefix, lookupFailed: true });

    return result({
      asn: Number(asn),
      prefix,
      status,
      valid: status === "valid",
      // "invalid_asn" or "invalid_length"; "unknown" means no ROA covers it.
      invalid: status.startsWith("invalid"),
    });
  }
}

import dns from "node:dns/promises";
import { createRequire } from "node:module";
import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

const require = createRequire(import.meta.url);

interface GeoIp {
  lookup(ip: string): {
    country: string;
    region: string;
    city: string;
    ll: [number, number];
    timezone: string;
  } | null;
}

// geoip-lite loads its ~100 MB database when required, so defer that until
// the check actually runs.
let geoip: GeoIp | undefined;
function loadGeoip(): GeoIp {
  geoip ??= require("geoip-lite") as GeoIp;
  return geoip;
}

export class GeoCheck implements Check {
  name = "geo";

  async run(endpoint: EndpointData, domain: string): Promise<CheckResult> {
    let ip: string | null = null;

    try {
      const addresses = await dns.resolve4(domain);
      ip = addresses[0] ?? null;
    } catch {
      /* no A record */
    }

    if (!ip) {
      return {
        name: this.name,
        data: {
          ip: null,
          country: null,
          region: null,
          city: null,
          ll: null,
          timezone: null,
        },
      };
    }

    const geo = loadGeoip().lookup(ip);

    return {
      name: this.name,
      data: {
        ip,
        country: geo?.country ?? null,
        region: geo?.region ?? null,
        city: geo?.city ?? null,
        ll: geo?.ll ?? null,
        timezone: geo?.timezone ?? null,
      },
    };
  }
}

import { configure, entity as lookupEntity, ip as lookupIp } from "node-rdap";
import type { RdapEntityObjectClass, RdapIpResponse } from "node-rdap";
import type { Check, CheckContext } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";
import { resolveIp } from "../utils.js";

type Entity = RdapEntityObjectClass;

interface Cidr0 {
  v4prefix?: string;
  v6prefix?: string;
  length: number;
}

function vcardValues(entity: Entity, property: string): string[] {
  return (entity.vcardArray?.[1] ?? [])
    .filter((p) => p[0] === property && typeof p[3] === "string")
    .map((p) => p[3] as string);
}

function walkEntities(entities: Entity[] | undefined): Entity[] {
  return (entities ?? []).flatMap((e) => [e, ...walkEntities(e.entities)]);
}

// A RIPE-style organization handle, given in place of a name.
const ORG_HANDLE = /^ORG-[\w-]+$/;

/**
 * The organization holding the network. Registries differ: RIPE lists its
 * maintainer objects (kind "individual") as registrants too, sometimes names
 * the holder only by org handle, and some networks name the holder only as the
 * administrative contact.
 */
async function holder(network: RdapIpResponse): Promise<string | null> {
  const entities = network.entities ?? [];
  const isOrg = (e: Entity) => vcardValues(e, "kind").some((k) => k === "org" || k === "group");
  const registrant = entities.find((e) => e.roles?.includes("registrant") && isOrg(e));
  if (registrant) return vcardValues(registrant, "fn")[0] ?? null;

  const handle = entities.flatMap((e) => vcardValues(e, "org")).find((o) => ORG_HANDLE.test(o));
  const self = network.links?.find((l) => l.rel === "self")?.href;
  if (handle && self) {
    try {
      const org = await lookupEntity(self.replace(/\/ip\/.*$/, `/entity/${handle}`));
      return vcardValues(org, "fn")[0] ?? null;
    } catch {
      return null;
    }
  }

  const admin = entities.find((e) => e.roles?.includes("administrative") && isOrg(e));
  return admin ? (vcardValues(admin, "fn")[0] ?? null) : null;
}

function abuseEmail(entities: Entity[]): string | null {
  const abuse = walkEntities(entities).find((e) => e.roles?.includes("abuse"));
  return abuse ? (vcardValues(abuse, "email")[0] ?? null) : null;
}

function cidrs(network: RdapIpResponse): string[] {
  const list = (network as { cidr0_cidrs?: Cidr0[] }).cidr0_cidrs ?? [];
  return list.flatMap((c) => {
    const prefix = c.v4prefix ?? c.v6prefix;
    return prefix ? [`${prefix}/${c.length}`] : [];
  });
}

function emptyData(ip: string | null, error: string | null): Record<string, unknown> {
  return {
    ip,
    name: null,
    handle: null,
    cidr: [],
    type: null,
    organization: null,
    country: null,
    abuseEmail: null,
    error,
  };
}

/**
 * Who holds the network the site's IP address sits in, from the regional
 * internet registry's RDAP service (ARIN, RIPE NCC, APNIC, LACNIC, AFRINIC).
 */
export class NetworkCheck implements Check {
  name = "network";

  async run(_endpoint: EndpointData, domain: string, ctx?: CheckContext): Promise<CheckResult> {
    const ip = await resolveIp(domain);
    if (!ip) return { name: this.name, data: emptyData(null, null) };

    try {
      // node-rdap takes no AbortSignal and its timeout is process-wide, so
      // the per-request timeout is the best bound available here.
      configure({ timeoutMs: ctx?.timeoutMs ?? 10_000 });
      const network = await lookupIp(ip);
      const entities = network.entities ?? [];
      return {
        name: this.name,
        data: {
          ip,
          name: network.name ?? null,
          handle: network.handle ?? null,
          cidr: cidrs(network),
          type: network.type ?? null,
          organization: await holder(network),
          country: network.country?.toUpperCase() ?? null,
          abuseEmail: abuseEmail(entities),
          error: null,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { name: this.name, data: emptyData(ip, message) };
    }
  }
}

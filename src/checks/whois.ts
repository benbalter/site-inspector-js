// @ts-expect-error — whois-json has no type declarations
import whois from "whois-json";
import type { Check } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

function parseNameServers(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n\r\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export class WhoisCheck implements Check {
  name = "whois";

  async run(_endpoint: EndpointData, domain: string): Promise<CheckResult> {
    try {
      const raw = await whois(domain);
      const result = Array.isArray(raw) ? raw[0] : raw;

      const registrar: string | null = result?.registrar ?? null;
      const creationDate: string | null = result?.creationDate ?? null;
      const expirationDate: string | null = result?.expirationDate ?? null;
      const updatedDate: string | null = result?.updatedDate ?? null;
      const nameServers = parseNameServers(result?.nameServer);
      const registrantOrganization: string | null =
        result?.registrantOrganization ?? null;

      const now = new Date();
      let domainAge: number | null = null;
      if (creationDate) {
        const created = new Date(creationDate);
        if (!isNaN(created.getTime())) {
          domainAge = daysBetween(created, now);
        }
      }

      let expiresIn: number | null = null;
      if (expirationDate) {
        const expires = new Date(expirationDate);
        if (!isNaN(expires.getTime())) {
          expiresIn = daysBetween(now, expires);
        }
      }

      return {
        name: this.name,
        data: {
          registrar,
          creationDate,
          expirationDate,
          updatedDate,
          nameServers,
          registrantOrganization,
          domainAge,
          expiresIn,
          error: null,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        name: this.name,
        data: {
          registrar: null,
          creationDate: null,
          expirationDate: null,
          updatedDate: null,
          nameServers: [],
          registrantOrganization: null,
          domainAge: null,
          expiresIn: null,
          error: message,
        },
      };
    }
  }
}

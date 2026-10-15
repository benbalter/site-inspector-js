import { lookup, toRegistrableDomain, type DomainRecord } from "rdapper";
import type { Check, CheckContext } from "./check.js";
import type { EndpointData, CheckResult } from "../types.js";

// RFC 5731 domain statuses, plus the RFC 3915 grace periods.
const EPP_STATUS = /^(ok|inactive|(client|server|pending)[A-Z]\w*|\w+Period)$/;

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

function daysFrom(iso: string | undefined, compute: (date: Date) => number): number | null {
  if (!iso) return null;
  const date = new Date(iso);
  return isNaN(date.getTime()) ? null : compute(date);
}

function emptyData(error: string | null): Record<string, unknown> {
  return {
    source: null,
    registered: null,
    registrar: null,
    creationDate: null,
    expirationDate: null,
    updatedDate: null,
    nameServers: [],
    registrantOrganization: null,
    domainAge: null,
    expiresIn: null,
    statuses: [],
    transferLock: null,
    dnssecSigned: null,
    privacyEnabled: null,
    registrarEmail: null,
    error,
  };
}

function toData(record: DomainRecord): Record<string, unknown> {
  const now = new Date();
  const statuses = (record.statuses ?? []).map((s) => s.status);
  const registrant = record.contacts?.find((c) => c.type === "registrant");
  return {
    source: record.source,
    registered: record.isRegistered,
    registrar: record.registrar?.name ?? null,
    creationDate: record.creationDate ?? null,
    expirationDate: record.expirationDate ?? null,
    updatedDate: record.updatedDate ?? null,
    nameServers: (record.nameservers ?? []).map((ns) => ns.host),
    registrantOrganization: registrant?.privacyService ? null : (registrant?.organization ?? null),
    domainAge: daysFrom(record.creationDate, (d) => daysBetween(d, now)),
    expiresIn: daysFrom(record.expirationDate, (d) => daysBetween(now, d)),
    statuses,
    // Registries outside EPP (DENIC's "connect", or none at all) have no
    // transfer-lock status to set, so leave it unknown rather than false.
    transferLock: statuses.some((s) => EPP_STATUS.test(s)) ? (record.transferLock ?? false) : null,
    dnssecSigned: record.dnssec?.enabled ?? null,
    privacyEnabled: record.privacyEnabled ?? null,
    // rdapper falls back to the registrar's abuse contact when it lists no other.
    registrarEmail: record.registrar?.email ?? null,
    error: null,
  };
}

/**
 * Domain registration data, from RDAP where the registry offers it and port-43
 * WHOIS otherwise. The check keeps the `whois` name so existing `--checks` and
 * field keys keep working.
 */
export class WhoisCheck implements Check {
  name = "whois";

  async run(_endpoint: EndpointData, domain: string, ctx?: CheckContext): Promise<CheckResult> {
    // Registries only know the registrable name, not www.example.com.
    const registrable = toRegistrableDomain(domain);
    if (!registrable) {
      return { name: this.name, data: emptyData(`Not a registrable domain: ${domain}`) };
    }

    try {
      const timeoutMs = ctx?.timeoutMs ?? 10_000;
      const result = await lookup(registrable, {
        timeoutMs,
        // A WHOIS fallback chains several requests; bound the whole lookup too.
        deadlineMs: timeoutMs * 2,
        signal: ctx?.signal,
      });
      if (!result.ok || !result.record) {
        return { name: this.name, data: emptyData(result.error ?? "Lookup failed") };
      }
      return { name: this.name, data: toData(result.record) };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { name: this.name, data: emptyData(message) };
    }
  }
}

// Tailwind class recipes shared by the page and the renderer. Written as full
// literals so Tailwind's scanner sees every class; combine them with `cx`.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Severity } from "site-inspector/assess";

/** Join classes, letting later Tailwind utilities override earlier ones. */
export function cx(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}

/** Eyebrow label: monospaced, tracked, technical. */
export const kicker = "font-mono text-xs font-medium tracking-[0.12em] text-ink-muted uppercase";

/** Label for a value row: quieter than a kicker. */
export const fieldLabel = "text-xs font-medium text-ink-muted";

/** A machine value (IPs, hashes, headers, dates). */
export const val = "font-mono text-[0.8125rem] text-ink [overflow-wrap:anywhere]";

/** Small technical tag (technology categories, short list items). */
export const tag =
  "rounded-[3px] border border-hairline px-1.5 py-px font-mono text-xs tracking-wide text-ink-muted";

/** A text button that reveals more ("+ 3 more", "Show all"). */
export const moreButton =
  "mt-1 text-xs font-medium text-accent underline-offset-2 hover:text-accent-strong hover:underline";

/** Section anchor pill in the summary bar. */
export const navPill =
  "inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-2.5 py-1 font-mono text-xs text-ink-muted transition-colors hover:border-accent hover:text-accent";

export function chipClass(severity: Severity, ...extra: ClassValue[]): string {
  return cx("chip", `chip-${severity}`, extra);
}

/** Left stripe on a check card, colored by the card's overall status. */
export const cardStripe: Record<CardStatus, string> = {
  attention: "border-l-4 border-l-attention",
  pass: "border-l-4 border-l-pass",
  error: "border-l-4 border-l-ink-faint",
  neutral: "",
};

export type CardStatus = "attention" | "pass" | "error" | "neutral";

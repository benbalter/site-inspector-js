// Client-side renderer: turns an InspectionResult (JSON from /api/inspect) into
// DOM. Framework-free to keep the front end lightweight.
//
// The good/bad opinion is NOT decided here — it comes from the library's
// assess() / assessField() (single source of truth, shared with the CLI). This
// renderer only *exposes* those verdicts (green pass · red attention · neutral)
// and *filters* to them via the "just show me what's wrong" toggle.
import { assess, assessField } from "site-inspector/assess";
import type { Severity } from "site-inspector/assess";
import type { InspectionResult, CheckResult, DomainProperties } from "site-inspector";
import { CHECK_GROUPS, PROPERTY_LABELS, checkLabel, titleCase } from "./checkGroups";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** A severity chip: glyph + label, colored by verdict, tagged for filtering. */
function chip(label: string, severity: Severity, value: boolean): HTMLElement {
  const span = el("span", `chip chip-${severity}`);
  span.dataset.sev = severity;
  const glyph = severity === "pass" ? "✓" : severity === "attention" ? "✗" : value ? "✓" : "✗";
  span.append(el("span", "glyph", glyph), document.createTextNode(label));
  return span;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Humanize a scalar value; ISO timestamps become readable dates. */
function formatScalar(value: string | number): string {
  if (typeof value === "string" && ISO_DATE.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    }
  }
  return String(value);
}

function labelValueRow(
  label: string,
  valueNode: Node,
  severity: Severity = "neutral",
  empty = false,
): HTMLElement {
  const row = el("div", "flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-0.5");
  row.dataset.sev = severity;
  if (empty) row.classList.add("empty-field"); // collapsed per card until "show all"
  row.append(el("span", "field-label shrink-0", label), valueNode);
  return row;
}

function renderValue(check: string, keys: string[], value: unknown): HTMLElement {
  const label = titleCase(keys[keys.length - 1]);

  if (value === null || value === undefined || value === "") {
    return labelValueRow(label, el("span", "val text-ink-faint", "—"), "neutral", true);
  }

  if (typeof value === "boolean") {
    const severity = assessField(check, keys.join("."), value);
    const wrap = el("div", "py-0.5");
    wrap.dataset.sev = severity;
    wrap.append(chip(label, severity, value));
    return wrap;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return labelValueRow(label, el("span", "val text-ink-faint", "(none)"), "neutral", true);
    }
    const wrap = el("div", "py-0.5");
    wrap.dataset.sev = "neutral";
    wrap.append(el("div", "field-label mb-1", label));
    const list = el("ul", "space-y-1 border-l border-hairline pl-3");
    for (const item of value) {
      const li = el("li");
      if (item && typeof item === "object") {
        li.append(renderObject(check, keys, item as Record<string, unknown>));
      } else {
        li.className = "val";
        li.textContent = formatScalar(item as string | number);
      }
      list.append(li);
    }
    wrap.append(list);
    return wrap;
  }

  if (typeof value === "object") {
    // Nested object: no data-sev on the wrapper, so children keep their own
    // verdicts (a nested attention field must survive the "issues" filter).
    const wrap = el("div", "py-0.5");
    wrap.append(el("div", "field-label mb-1", label));
    const nested = renderObject(check, keys, value as Record<string, unknown>);
    nested.className = "border-l border-hairline pl-3";
    wrap.append(nested);
    return wrap;
  }

  // Long strings (raw CSP, fingerprints) get a scrollable readout box.
  if (typeof value === "string" && value.length > 120) {
    const wrap = el("div", "py-0.5");
    wrap.dataset.sev = "neutral";
    wrap.append(el("div", "field-label mb-1", label));
    const box = el(
      "div",
      "val max-h-32 overflow-auto rounded border border-hairline bg-paper/60 p-2 whitespace-pre-wrap",
    );
    box.textContent = value;
    wrap.append(box);
    return wrap;
  }

  // Graded scalars (letter grades, severity counts) show a colored chip.
  const severity = assessField(check, keys.join("."), value);
  const text = formatScalar(value as string | number);
  if (severity !== "neutral") {
    const c = el("span", `chip chip-${severity}`, text);
    return labelValueRow(label, c, severity);
  }
  return labelValueRow(label, el("span", "val", text));
}

function renderObject(
  check: string,
  parentKeys: string[],
  data: Record<string, unknown>,
): HTMLElement {
  const wrap = el("div", "space-y-1");
  const entries = Object.entries(data);
  if (entries.length === 0) {
    wrap.append(el("span", "val text-ink-faint", "(no data)"));
    return wrap;
  }
  for (const [key, value] of entries) {
    wrap.append(renderValue(check, [...parentKeys, key], value));
  }
  return wrap;
}

function countBadge(count: number): HTMLElement {
  const badge = el(
    "span",
    "chip chip-attention text-[0.6875rem]",
    `${count}`,
  );
  return badge;
}

interface Technology {
  name: string;
  categories?: string[];
  version?: string;
  confidence?: number;
  website?: string | null;
}

function faviconUrl(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    return `https://icons.duckduckgo.com/ip3/${new URL(website).hostname}.ico`;
  } catch {
    return null;
  }
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

// A colored monogram fallback for when no favicon is available (offline, misses).
function monogram(name: string): HTMLElement {
  const d = el("div", "tech-logo tech-monogram");
  d.textContent = (name || "?").trim().charAt(0).toUpperCase();
  const hue = hashHue(name || "?");
  d.style.backgroundColor = `hsl(${hue} 55% 93%)`;
  d.style.color = `hsl(${hue} 45% 32%)`;
  d.style.borderColor = `hsl(${hue} 40% 82%)`;
  return d;
}

function techLogo(t: Technology): HTMLElement {
  const url = faviconUrl(t.website);
  if (!url) return monogram(t.name);
  const img = el("img", "tech-logo") as HTMLImageElement;
  img.src = url;
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  // Fall back to a monogram if the favicon fails (offline / no favicon).
  img.addEventListener("error", () => img.replaceWith(monogram(t.name)), { once: true });
  return img;
}

function techRow(t: Technology): HTMLElement {
  const row = el(t.website ? "a" : "div", "tech");
  if (t.website) {
    const a = row as HTMLAnchorElement;
    a.href = t.website;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  row.append(techLogo(t));

  const main = el("div", "min-w-0 flex-1");
  const nameLine = el("div", "flex items-baseline gap-2");
  nameLine.append(el("span", "truncate text-sm font-medium text-ink", t.name));
  if (t.version) nameLine.append(el("span", "val text-ink-faint", t.version));
  main.append(nameLine);

  const cats = (t.categories ?? []).filter(Boolean);
  if (cats.length) {
    const catWrap = el("div", "mt-1 flex flex-wrap gap-1");
    for (const c of cats) catWrap.append(el("span", "tag", c));
    main.append(catWrap);
  }

  if (typeof t.confidence === "number" && t.confidence < 100) {
    const track = el("div", "conf-track mt-1.5");
    const fill = el("div", "conf-fill");
    fill.style.width = `${Math.max(0, Math.min(100, t.confidence))}%`;
    track.append(fill);
    main.append(track);
  }
  row.append(main);

  // Confidence is noise when it's 100% (the common case) — only show below full.
  if (typeof t.confidence === "number" && t.confidence < 100) {
    row.append(el("span", "val shrink-0 self-start text-ink-faint", `${t.confidence}%`));
  }
  return row;
}

function renderTechnologies(data: Record<string, unknown>): HTMLElement {
  const techs = (Array.isArray(data.technologies) ? data.technologies : []) as Technology[];
  if (!techs.length) {
    const p = el("p", "val text-ink-faint", "No technologies detected.");
    p.dataset.sev = "neutral";
    return p;
  }
  const wrap = el("div", "-mx-1 space-y-0.5");
  wrap.dataset.sev = "neutral"; // detected tech is informational
  for (const t of techs) wrap.append(techRow(t));
  return wrap;
}

// Empty (—/none) rows are hidden by default; add a per-card toggle to reveal
// them so healthy cards stay scannable without losing the full readout.
function addShowEmptyToggle(card: HTMLElement): void {
  const count = card.querySelectorAll(".empty-field").length;
  if (count === 0) return;
  const btn = el("button", "show-empty-btn mt-2 field-label hover:text-accent");
  btn.type = "button";
  const collapsed = () => `+ ${count} empty field${count > 1 ? "s" : ""}`;
  btn.textContent = collapsed();
  btn.addEventListener("click", () => {
    const showing = card.classList.toggle("show-empty");
    btn.textContent = showing ? "− Hide empty fields" : collapsed();
  });
  card.append(btn);
}

function checkCard(check: CheckResult, attention: number, index: number): HTMLElement {
  const card = el("div", "card reveal mb-4 break-inside-avoid p-4");
  card.dataset.attention = String(attention);
  card.style.animationDelay = `${Math.min(index * 40, 320)}ms`;

  const head = el("div", "mb-2 flex items-center justify-between gap-2");
  head.append(el("h3", "text-sm font-semibold text-ink", checkLabel(check.name)));
  if (attention > 0) head.append(countBadge(attention));
  card.append(head);

  const data = check.data as Record<string, unknown>;
  if (data && typeof data.error === "string") {
    const err = el("p", "val text-[#bd2f26]", `Error: ${data.error}`);
    card.append(err);
  } else if (check.name === "sniffer") {
    card.append(renderTechnologies(data));
  } else {
    card.append(renderObject(check.name, [], data));
    addShowEmptyToggle(card);
  }
  return card;
}

function propertiesCard(props: DomainProperties, attention: number): HTMLElement {
  const card = el("div", "card reveal p-5");
  card.dataset.attention = String(attention);

  const head = el("div", "mb-3 flex items-center justify-between");
  head.append(el("h2", "kicker", "Domain Properties"));
  if (attention > 0) head.append(countBadge(attention));
  card.append(head);

  const strip = el("div", "flex flex-wrap gap-2");
  for (const [key, label] of Object.entries(PROPERTY_LABELS)) {
    const value = (props as unknown as Record<string, unknown>)[key];
    if (typeof value !== "boolean") continue;
    const severity = assessField("properties", key, value);
    const c = chip(label, severity, value);
    const holder = el("span", "");
    holder.dataset.sev = severity;
    holder.append(c);
    strip.append(holder);
  }
  card.append(strip);

  if (props.redirectTarget) {
    const t = labelValueRow("Redirect Target", el("span", "val", props.redirectTarget));
    t.classList.add("mt-3");
    card.append(t);
  }
  return card;
}

function summaryBar(
  attentionCount: number,
  navItems: { title: string; id: string; attention: number }[],
  container: HTMLElement,
): HTMLElement {
  const bar = el(
    "div",
    "card sticky top-3 z-10 mb-6 p-4 backdrop-blur supports-[backdrop-filter]:bg-white/85",
  );

  const top = el("div", "flex flex-wrap items-center justify-between gap-3");

  // Status readout
  const status = el("div", "flex items-baseline gap-2");
  if (attentionCount === 0) {
    status.append(
      el("span", "chip chip-pass", "✓ All clear"),
      el("span", "kicker", "no items need attention"),
    );
  } else {
    status.append(
      el("span", "text-2xl font-bold text-[#bd2f26] leading-none", String(attentionCount)),
      el("span", "kicker", attentionCount === 1 ? "item needs attention" : "items need attention"),
    );
  }
  top.append(status);

  // "Just show me what's wrong" toggle
  const toggle = el("label", "flex cursor-pointer select-none items-center gap-2");
  const input = el("input", "peer sr-only");
  input.type = "checkbox";
  const track = el(
    "span",
    "relative h-5 w-9 rounded-full bg-hairline-strong transition-colors peer-checked:bg-accent after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4",
  );
  toggle.append(input, track, el("span", "kicker", "Only issues"));
  input.addEventListener("change", () => {
    container.classList.toggle("filter-issues", input.checked);
  });
  top.append(toggle);
  bar.append(top);

  // Section nav
  if (navItems.length) {
    const nav = el("nav", "mt-3 flex flex-wrap gap-1.5 border-t border-hairline pt-3");
    for (const item of navItems) {
      const a = el("a", "navpill flex items-center gap-1.5");
      a.href = `#${item.id}`;
      a.dataset.attention = String(item.attention);
      a.append(document.createTextNode(item.title));
      if (item.attention > 0) {
        a.append(el("span", "font-semibold text-[#bd2f26]", String(item.attention)));
      }
      nav.append(a);
    }
    bar.append(nav);
  }

  return bar;
}

function section(title: string, id: string, cards: HTMLElement[], attention: number): HTMLElement {
  const sec = el("section", "mb-8");
  sec.id = id;
  sec.dataset.attention = String(attention);

  const head = el("div", "mb-3 flex items-center gap-2");
  head.append(el("h2", "text-base font-bold tracking-tight text-ink", title));
  if (attention > 0) head.append(countBadge(attention));
  sec.append(head);

  const grid = el("div", "columns-1 gap-4 sm:columns-2 lg:columns-3");
  for (const c of cards) grid.append(c);
  sec.append(grid);
  return sec;
}

export function renderResult(result: InspectionResult, container: HTMLElement): void {
  container.replaceChildren();
  container.classList.remove("filter-issues", "no-issues");

  const assessment = assess(result);
  const byCheck = assessment.attentionByCheck;

  // Header
  const header = el("div", "mb-5");
  header.append(el("div", "kicker mb-1", "Site Inspector"));
  header.append(el("h1", "text-3xl font-bold tracking-tight text-ink", result.domain));
  const meta = el("p", "val mt-1 text-ink-muted");
  meta.textContent = result.canonicalUrl
    ? `${result.canonicalUrl} · inspected ${new Date(result.inspectedAt).toLocaleString()}`
    : `inspected ${new Date(result.inspectedAt).toLocaleString()}`;
  header.append(meta);
  container.append(header);

  // Down state
  if (!result.properties.up || Object.keys(result.checks).length === 0) {
    container.append(propertiesCard(result.properties, byCheck["properties"] ?? 0));
    const down = el("div", "card reveal mt-6 border-dashed p-8 text-center");
    down.append(
      el("div", "kicker mb-2 text-[#bd2f26]", "No signal"),
      el("p", "text-lg font-semibold text-ink", "This site appears to be down"),
      el(
        "p",
        "val mx-auto mt-2 max-w-md text-ink-muted",
        "The domain didn't respond, so no checks were run. Double-check the domain and try again.",
      ),
    );
    container.append(down);
    return;
  }

  // Build grouped sections
  const remaining = new Map(Object.entries(result.checks));
  const sections: HTMLElement[] = [];
  const navItems: { title: string; id: string; attention: number }[] = [];

  // Properties first (as its own nav target)
  navItems.push({ title: "Properties", id: "properties", attention: byCheck["properties"] ?? 0 });

  let cardIndex = 0;
  for (const group of CHECK_GROUPS) {
    const cards: HTMLElement[] = [];
    let secAttention = 0;
    for (const name of group.checks) {
      const c = remaining.get(name);
      if (!c) continue;
      remaining.delete(name);
      const a = byCheck[name] ?? 0;
      secAttention += a;
      cards.push(checkCard(c, a, cardIndex++));
    }
    if (cards.length) {
      const id = slug(group.title);
      sections.push(section(group.title, id, cards, secAttention));
      navItems.push({ title: group.title, id, attention: secAttention });
    }
  }
  if (remaining.size) {
    const cards: HTMLElement[] = [];
    let secAttention = 0;
    for (const c of remaining.values()) {
      const a = byCheck[c.name] ?? 0;
      secAttention += a;
      cards.push(checkCard(c, a, cardIndex++));
    }
    sections.push(section("Other", "other", cards, secAttention));
    navItems.push({ title: "Other", id: "other", attention: secAttention });
  }

  // Summary bar (with toggle wired to this container)
  container.append(summaryBar(assessment.attentionCount, navItems, container));

  // Properties card
  const propsWrap = el("div", "mb-8");
  propsWrap.id = "properties";
  propsWrap.dataset.attention = String(byCheck["properties"] ?? 0);
  propsWrap.append(propertiesCard(result.properties, byCheck["properties"] ?? 0));
  container.append(propsWrap);

  for (const s of sections) container.append(s);

  // "All clear" banner shown only when the issues filter is on and nothing flagged.
  if (assessment.attentionCount === 0) container.classList.add("no-issues");
  const clear = el(
    "div",
    "issues-clear card reveal hidden p-8 text-center",
  );
  clear.append(
    el("div", "kicker mb-2 text-[#0a7c46]", "All clear"),
    el("p", "text-lg font-semibold text-ink", "Nothing needs attention"),
    el("p", "val mt-1 text-ink-muted", "Every graded check passed. Toggle off to see the full report."),
  );
  container.append(clear);
}

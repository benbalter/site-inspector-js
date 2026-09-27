// Client-side renderer: turns an InspectionResult (JSON from /api/inspect) into
// DOM. Framework-free to keep the front end lightweight.
//
// The good/bad opinion is NOT decided here — it comes from the library's
// assess() / severityOf() (single source of truth, shared with the CLI). This
// renderer only *exposes* those verdicts (green pass · red attention · neutral)
// and *filters* to them via the "just show me what's wrong" toggle.
import {
  CHECK_CATEGORIES,
  PROPERTY_LABELS,
  assess,
  booleanText,
  checkLabel,
  fieldLabel as labelFor,
  formatFieldValue,
  scoreCategories,
  severityOf,
  verdictGlyph,
} from "site-inspector/assess";
import type { Assessment, CategoryScore, Insight, Severity } from "site-inspector/assess";
import type { InspectionResult, CheckResult, DomainProperties } from "site-inspector";
import {
  cardStripe,
  chipClass,
  cx,
  fieldLabel,
  kicker,
  moreButton,
  navPill,
  tag,
  val,
  type CardStatus,
} from "./ui";

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
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Text for screen readers only. */
function srOnly(text: string): HTMLElement {
  return el("span", "sr-only", text);
}

const VERDICT_TEXT: Record<Severity, string> = {
  pass: "good",
  attention: "needs attention",
  neutral: "",
  "not-applicable": "not applicable",
};

/** The anchor id of a check's card (or the properties card). */
function cardId(check: string): string {
  return check === "properties" ? "properties" : `check-${check}`;
}

/**
 * A verdict chip. The glyph shows the verdict (✓ good, ✗ needs attention,
 * · neutral, – not applicable) and the text shows the value, as in the CLI.
 */
function chip(text: string, severity: Severity, note?: string): HTMLElement {
  const span = el("span", chipClass(severity));
  span.dataset.sev = severity;
  const glyph = el("span", "glyph", verdictGlyph(severity));
  glyph.setAttribute("aria-hidden", "true");
  span.append(glyph, document.createTextNode(text));
  const verdict = VERDICT_TEXT[severity];
  if (verdict) span.append(srOnly(` (${verdict})`));
  if (note) {
    span.title = note;
    span.append(srOnly(` — ${note}`));
  }
  return span;
}

/** A finding's note (e.g. why it doesn't apply), if assess() recorded one. */
function noteFor(a: Assessment, check: string, path: string): string | undefined {
  return a.findings.find((f) => f.check === check && f.path === path)?.note;
}

/** Lists longer than this show the first few and a "+ N more" toggle. */
const LIST_LIMIT = 8;
/** Strings longer than this are clamped with a "Show all" toggle. */
const LONG_TEXT = 160;

function toggleButton(text: string): HTMLButtonElement {
  const btn = el("button", moreButton, text);
  btn.type = "button";
  btn.setAttribute("aria-expanded", "false");
  return btn;
}

/** Append `items` to `list`, hiding those past `limit` behind a toggle button. */
function appendCollapsible(
  list: HTMLElement,
  items: HTMLElement[],
  limit = LIST_LIMIT,
): HTMLElement[] {
  items.forEach((item, i) => {
    if (i >= limit) item.classList.add("overflow-item", "hidden");
    list.append(item);
  });
  const extra = items.length - limit;
  if (extra <= 0) return [];
  const btn = toggleButton(`+ ${extra} more`);
  btn.addEventListener("click", () => {
    const hidden = list.querySelectorAll(":scope > .overflow-item.hidden").length > 0;
    for (const item of list.querySelectorAll(":scope > .overflow-item")) {
      item.classList.toggle("hidden", !hidden);
    }
    btn.textContent = hidden ? "Show fewer" : `+ ${extra} more`;
    btn.setAttribute("aria-expanded", String(hidden));
  });
  return [btn];
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
  row.append(el("span", cx(fieldLabel, "shrink-0"), label), valueNode);
  return row;
}

function renderValue(a: Assessment, check: string, keys: string[], value: unknown): HTMLElement {
  const label = labelFor(keys[keys.length - 1]);
  const path = keys.join(".");

  if (value === null || value === undefined || value === "") {
    // Some absences are the finding (e.g. no X-Content-Type-Options).
    const severity = severityOf(a, check, path, null);
    if (severity !== "neutral") {
      return labelValueRow(label, chip("Missing", severity, noteFor(a, check, path)), severity);
    }
    return labelValueRow(label, el("span", cx(val, "text-ink-faint"), "—"), "neutral", true);
  }

  if (typeof value === "boolean") {
    const severity = severityOf(a, check, path, value);
    const wrap = el("div", "py-0.5");
    wrap.dataset.sev = severity;
    wrap.append(chip(booleanText(label, value), severity, noteFor(a, check, path)));
    return wrap;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return labelValueRow(label, el("span", cx(val, "text-ink-faint"), "(none)"), "neutral", true);
    }
    const wrap = el("div", "py-0.5");
    wrap.dataset.sev = "neutral";
    wrap.append(el("div", cx(fieldLabel, "mb-1"), label));

    // Short scalars (heading levels, header names, versions) read best inline.
    const inline = value.every(
      (v) => (typeof v === "string" && v.length <= 32) || typeof v === "number",
    );
    if (inline) {
      const list = el("div", "flex flex-wrap gap-1");
      const items = value.map((v) => el("span", tag, formatScalar(v as string | number)));
      wrap.append(list, ...appendCollapsible(list, items, LIST_LIMIT * 2));
      return wrap;
    }

    const list = el("ul", "space-y-1 border-l border-hairline pl-3");
    const items = value.map((item) => {
      const li = el("li");
      if (item && typeof item === "object") {
        li.append(renderObject(a, check, keys, item as Record<string, unknown>));
      } else {
        li.className = cx(val, "break-all");
        li.textContent = formatScalar(item as string | number);
      }
      return li;
    });
    wrap.append(list, ...appendCollapsible(list, items));
    return wrap;
  }

  if (typeof value === "object") {
    // Nested object: no data-sev on the wrapper, so children keep their own
    // verdicts; `.nested` hides it in "only issues" mode if nothing inside is
    // flagged.
    const wrap = el("div", "nested py-0.5");
    wrap.append(el("div", cx(fieldLabel, "mb-1"), label));
    const nested = renderObject(a, check, keys, value as Record<string, unknown>);
    nested.className = "space-y-1 border-l border-hairline pl-3";
    wrap.append(nested);
    return wrap;
  }

  // Long strings (raw CSP, SPF records) are clamped to a few lines.
  if (typeof value === "string" && value.length > LONG_TEXT) {
    const wrap = el("div", "py-0.5");
    wrap.dataset.sev = "neutral";
    wrap.append(el("div", cx(fieldLabel, "mb-1"), label));
    const box = el("div", "rounded border border-hairline bg-paper/60 p-2");
    const text = el("div", cx(val, "line-clamp-3 break-all whitespace-pre-wrap"), value);
    box.append(text);
    const btn = toggleButton("Show all");
    btn.addEventListener("click", () => {
      const clamped = text.classList.toggle("line-clamp-3");
      btn.textContent = clamped ? "Show all" : "Show less";
      btn.setAttribute("aria-expanded", String(!clamped));
    });
    wrap.append(box, btn);
    return wrap;
  }

  // Graded scalars (letter grades, severity counts) show a verdict chip.
  const severity = severityOf(a, check, path, value);
  // Numbers with a known unit read as "1 year" or "562.8 KB"; hover for the raw value.
  const formatted = formatFieldValue(check, path, value);
  const text = formatted ?? formatScalar(value as string | number);
  const valueEl =
    severity !== "neutral" ? chip(text, severity, noteFor(a, check, path)) : el("span", val, text);
  if (formatted) valueEl.title = String(value);
  return labelValueRow(label, valueEl, severity);
}

function renderObject(
  a: Assessment,
  check: string,
  parentKeys: string[],
  data: Record<string, unknown>,
): HTMLElement {
  const wrap = el("div", "space-y-1");
  const entries = Object.entries(data);
  if (entries.length === 0) {
    wrap.append(el("span", cx(val, "text-ink-faint"), "(no data)"));
    return wrap;
  }
  for (const [key, value] of entries) {
    wrap.append(renderValue(a, check, [...parentKeys, key], value));
  }
  return wrap;
}

/** A count of items needing attention, readable without color. */
function countBadge(count: number, extra = ""): HTMLElement {
  const badge = el("span", chipClass("attention", "px-1.5 text-[0.6875rem]", extra));
  badge.append(document.createTextNode(String(count)), srOnly(" need attention"));
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

const logoClass = "h-[30px] w-[30px] shrink-0 rounded-md border border-hairline object-contain";

// A neutral monogram fallback for when no favicon is available (offline, misses).
function monogram(name: string): HTMLElement {
  const d = el(
    "div",
    cx(
      logoClass,
      "flex items-center justify-center bg-paper font-mono text-sm font-semibold text-ink-muted",
    ),
    (name || "?").trim().charAt(0).toUpperCase(),
  );
  d.setAttribute("aria-hidden", "true");
  return d;
}

function techLogo(t: Technology): HTMLElement {
  const url = faviconUrl(t.website);
  if (!url) return monogram(t.name);
  // Favicons are drawn for light backgrounds, so they keep a white tile.
  const img = el("img", cx(logoClass, "bg-white")) as HTMLImageElement;
  img.src = url;
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.addEventListener("error", () => img.replaceWith(monogram(t.name)), { once: true });
  return img;
}

function techRow(t: Technology): HTMLElement {
  const row = el(
    t.website ? "a" : "div",
    "flex items-center gap-3 rounded-md border border-transparent p-2 transition-colors",
  );
  if (t.website) {
    const a = row as HTMLAnchorElement;
    a.href = t.website;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.classList.add("hover:border-hairline", "hover:bg-paper");
  }
  row.append(techLogo(t));

  const main = el("div", "min-w-0 flex-1");
  const nameLine = el("div", "flex items-baseline gap-2");
  nameLine.append(el("span", "truncate text-sm font-medium text-ink", t.name));
  if (t.version) nameLine.append(el("span", cx(val, "text-ink-faint"), t.version));
  main.append(nameLine);

  const cats = (t.categories ?? []).filter(Boolean);
  if (cats.length) {
    const catWrap = el("div", "mt-1 flex flex-wrap gap-1");
    for (const c of cats) catWrap.append(el("span", cx(tag, "uppercase"), c));
    main.append(catWrap);
  }

  // Confidence is noise when it's 100% (the common case) — only show below full.
  if (typeof t.confidence === "number" && t.confidence < 100) {
    const track = el("div", "mt-1.5 h-[3px] overflow-hidden rounded-full bg-hairline");
    const fill = el("div", "h-full bg-accent");
    fill.style.width = `${Math.max(0, Math.min(100, t.confidence))}%`;
    track.append(fill);
    main.append(track);
  }
  row.append(main);

  if (typeof t.confidence === "number" && t.confidence < 100) {
    row.append(
      el("span", cx(val, "shrink-0 self-start text-ink-faint"), `${t.confidence}% confidence`),
    );
  }
  return row;
}

function renderTechnologies(data: Record<string, unknown>): HTMLElement {
  const techs = (Array.isArray(data.technologies) ? data.technologies : []) as Technology[];
  if (!techs.length) {
    const p = el("p", cx(val, "text-ink-faint"), "No technologies detected.");
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
  const collapsed = `+ ${count} empty field${count > 1 ? "s" : ""}`;
  const btn = toggleButton(collapsed);
  btn.classList.add("show-empty-btn", "mt-2");
  btn.addEventListener("click", () => {
    const showing = card.classList.toggle("show-empty");
    btn.textContent = showing ? "Hide empty fields" : collapsed;
    btn.setAttribute("aria-expanded", String(showing));
  });
  card.append(btn);
}

function checksOf(keys: string[]): string[] {
  return [...new Set(keys.map((k) => k.split(".")[0]))];
}

function cardLink(check: string, text = checkLabel(check)): HTMLAnchorElement {
  const link = el("a", "text-accent underline-offset-2 hover:underline", text);
  link.href = `#${cardId(check)}`;
  return link;
}

/** "<prefix> A, B" with each item a link. */
function linkList(prefix: string, links: HTMLElement[]): HTMLElement {
  const p = el("p", cx(fieldLabel, "mt-1 font-normal"));
  p.append(document.createTextNode(`${prefix} `));
  links.forEach((link, i) => {
    if (i) p.append(document.createTextNode(", "));
    p.append(link);
  });
  return p;
}

/** A cross-check conclusion, shown at the top of the card it belongs to. */
function insightRow(insight: Insight): HTMLElement {
  const row = el("div", "py-0.5");
  row.dataset.sev = insight.severity;
  row.append(
    chip(insight.title, insight.severity),
    el("p", cx(fieldLabel, "mt-1 font-normal"), insight.detail),
  );
  const others = checksOf(insight.because).filter((c) => c !== insight.check);
  if (others.length)
    row.append(
      linkList(
        "Also based on",
        others.map((c) => cardLink(c)),
      ),
    );
  return row;
}

function cardStatus(a: Assessment, check: CheckResult, attention: number): CardStatus {
  const data = check.data as Record<string, unknown>;
  if (data && typeof data.error === "string") return "error";
  if (attention > 0) return "attention";
  const passes = [...a.findings, ...a.insights].some(
    (f) => f.check === check.name && f.severity === "pass",
  );
  return passes ? "pass" : "neutral";
}

function checkCard(
  a: Assessment,
  check: CheckResult,
  attention: number,
  index: number,
): HTMLElement {
  const status = cardStatus(a, check, attention);
  const card = el("article", cx("card reveal p-4", cardStripe[status]));
  card.id = cardId(check.name);
  card.dataset.flagged = String(attention > 0 || status === "error");
  card.style.animationDelay = `${Math.min(index * 30, 300)}ms`;

  const head = el("div", "mb-2 flex items-center justify-between gap-2");
  const title = el("h4", "text-sm font-semibold text-ink", checkLabel(check.name));
  title.id = `${card.id}-title`;
  card.setAttribute("aria-labelledby", title.id);
  head.append(title);
  if (attention > 0) head.append(countBadge(attention));
  else if (status === "pass") head.append(el("span", cx(kicker, "text-pass"), "✓ Passing"));
  else if (status === "error") head.append(el("span", kicker, "Couldn't run"));
  card.append(head);

  const data = check.data as Record<string, unknown>;
  if (status === "error") {
    card.append(el("p", cx(val, "text-ink-muted"), `This check failed: ${String(data.error)}`));
    return card;
  }

  const insights = a.insights.filter((i) => i.check === check.name);
  if (insights.length) {
    const list = el("div", "mb-2 space-y-2 border-b border-hairline pb-2");
    list.append(...insights.map(insightRow));
    card.append(list);
  }

  if (check.name === "sniffer") {
    card.append(renderTechnologies(data));
  } else {
    card.append(renderObject(a, check.name, [], data));
    addShowEmptyToggle(card);
  }

  // Conclusions shown on other cards that rest on this check's fields.
  const usedBy = a.insights.filter(
    (i) => i.check !== check.name && checksOf(i.because).includes(check.name),
  );
  if (usedBy.length) {
    const note = linkList(
      "Feeds into:",
      usedBy.map((i) => cardLink(i.check, i.title)),
    );
    note.classList.add("mt-2", "border-t", "border-hairline", "pt-2");
    note.dataset.sev = "neutral";
    card.append(note);
  }
  return card;
}

function propertiesCard(a: Assessment, props: DomainProperties, attention: number): HTMLElement {
  const card = el(
    "section",
    cx("card reveal p-4", cardStripe[attention > 0 ? "attention" : "neutral"]),
  );
  card.id = "properties";
  card.dataset.flagged = String(attention > 0);
  card.setAttribute("aria-labelledby", "properties-title");

  const head = el("div", "mb-3 flex items-center justify-between");
  const title = el("h3", "text-base font-bold tracking-tight text-ink", "Domain Properties");
  title.id = "properties-title";
  head.append(title);
  if (attention > 0) head.append(countBadge(attention));
  card.append(head);

  const strip = el("div", "flex flex-wrap gap-2");
  for (const [key, label] of Object.entries(PROPERTY_LABELS)) {
    const value = (props as unknown as Record<string, unknown>)[key];
    if (typeof value !== "boolean") continue;
    const severity = severityOf(a, "properties", key, value);
    const holder = el("span", "");
    holder.dataset.sev = severity;
    holder.append(chip(booleanText(label, value), severity, noteFor(a, "properties", key)));
    strip.append(holder);
  }
  card.append(strip);

  if (props.redirectTarget) {
    const t = labelValueRow("Redirect Target", el("span", val, props.redirectTarget));
    t.classList.add("mt-3");
    card.append(t);
  }
  return card;
}

/** Everything that needs attention, in one list linking to each card. */
function topIssues(a: Assessment): HTMLElement | null {
  const items = [
    ...a.insights
      .filter((i) => i.severity === "attention")
      .map((i) => ({ check: i.check, title: i.title, detail: i.detail })),
    ...a.attention.map((f) => {
      const what =
        typeof f.value === "boolean"
          ? booleanText(f.label, f.value)
          : `${f.label}: ${f.value === null ? "missing" : (formatFieldValue(f.check, f.path, f.value) ?? f.value)}`;
      return {
        check: f.check,
        title: f.check === "properties" ? what : `${checkLabel(f.check)} · ${what}`,
        detail: f.note ?? "",
      };
    }),
  ];
  if (!items.length) return null;

  const card = el("section", "card reveal mb-8 border-l-4 border-l-attention p-4");
  card.setAttribute("aria-labelledby", "top-issues-title");
  const title = el("h3", "mb-2 text-base font-bold tracking-tight text-ink", "Needs attention");
  title.id = "top-issues-title";
  card.append(title);

  const list = el("ol", "space-y-1.5");
  for (const item of items) {
    const li = el("li", "flex gap-2 text-sm");
    const glyph = el("span", "font-bold text-attention", verdictGlyph("attention"));
    glyph.setAttribute("aria-hidden", "true");
    const body = el("div", "min-w-0");
    const link = cardLink(item.check, item.title);
    link.className = "font-medium text-ink underline-offset-2 hover:text-accent hover:underline";
    body.append(link);
    if (item.detail) body.append(el("p", cx(fieldLabel, "font-normal"), item.detail));
    li.append(glyph, body);
    list.append(li);
  }
  card.append(list);
  return card;
}

interface NavItem {
  title: string;
  id: string;
  attention: number;
  flagged: boolean;
}

function summaryBar(attentionCount: number, navItems: NavItem[], container: HTMLElement) {
  const bar = el("div", "card sticky top-3 z-10 mb-6 bg-surface-overlay p-3 backdrop-blur sm:p-4");

  const top = el("div", "flex flex-wrap items-center justify-between gap-3");

  const status = el("p", "flex items-center gap-2");
  if (attentionCount === 0) {
    status.append(chip("All clear", "pass"), el("span", kicker, "Nothing needs attention"));
  } else {
    status.append(
      el("span", chipClass("attention", "px-2 text-base font-bold"), String(attentionCount)),
      el("span", kicker, attentionCount === 1 ? "item needs attention" : "items need attention"),
    );
  }
  top.append(status);

  // "Just show me what's wrong" toggle
  const toggle = el("label", "flex cursor-pointer items-center gap-2 select-none");
  const input = el("input", "peer sr-only");
  input.type = "checkbox";
  const track = el(
    "span",
    "relative h-5 w-9 rounded-full bg-hairline-strong transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-surface after:transition-transform peer-checked:after:translate-x-4",
  );
  track.setAttribute("aria-hidden", "true");
  toggle.append(input, track, el("span", kicker, "Only issues"));
  input.addEventListener("change", () => {
    container.classList.toggle("filter-issues", input.checked);
  });
  top.append(toggle);
  bar.append(top);

  if (navItems.length) {
    // One scrolling row on phones so the sticky bar stays short.
    const nav = el(
      "nav",
      "relative -mx-1 mt-3 flex gap-1.5 overflow-x-auto border-t border-hairline px-1 pt-3 pb-0.5 sm:flex-wrap",
    );
    nav.setAttribute("aria-label", "Report sections");
    nav.dataset.flagged = String(navItems.some((i) => i.flagged));
    for (const item of navItems) {
      const a = el("a", cx(navPill, "shrink-0"));
      a.href = `#${item.id}`;
      a.dataset.flagged = String(item.flagged);
      a.append(document.createTextNode(item.title));
      if (item.attention > 0) a.append(countBadge(item.attention, "py-0"));
      nav.append(a);
    }
    bar.append(nav);
  }
  return bar;
}

/** A small meter: the share of graded items in a category that pass. */
function scoreMeter(score: CategoryScore): HTMLElement | null {
  if (score.score === null) return null;
  const wrap = el("div", "ml-auto flex items-center gap-2");
  wrap.title = `${score.pass} passing · ${score.attention} need attention`;
  const meter = el("div", "h-1.5 w-20 overflow-hidden rounded-full bg-attention-bg");
  meter.setAttribute("role", "img");
  meter.setAttribute(
    "aria-label",
    `${score.pass} of ${score.pass + score.attention} graded items pass`,
  );
  const fill = el("div", "h-full rounded-full bg-pass");
  fill.style.width = `${score.score}%`;
  meter.append(fill);
  const pct = el("span", cx(val, "text-xs text-ink-muted"), `${score.score}%`);
  pct.setAttribute("aria-hidden", "true");
  wrap.append(meter, pct);
  return wrap;
}

function section(
  title: string,
  id: string,
  cards: HTMLElement[],
  attention: number,
  flagged: boolean,
  score?: CategoryScore,
): HTMLElement {
  const sec = el("section", "mb-8");
  sec.id = id;
  sec.dataset.flagged = String(flagged);
  sec.setAttribute("aria-labelledby", `${id}-title`);

  const head = el("div", "mb-3 flex items-center gap-2");
  const h = el("h3", "text-base font-bold tracking-tight text-ink", title);
  h.id = `${id}-title`;
  head.append(h);
  if (attention > 0) head.append(countBadge(attention));
  const meter = score && scoreMeter(score);
  if (meter) head.append(meter);
  sec.append(head);

  // Row-major grid, so visual order matches reading and tab order.
  const grid = el("div", "grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3");
  for (const c of cards) grid.append(c);
  sec.append(grid);
  return sec;
}

/** Render a report into `container`; returns how many items need attention. */
export function renderResult(result: InspectionResult, container: HTMLElement): number {
  container.replaceChildren();
  container.classList.remove("filter-issues", "no-issues");

  const assessment = assess(result);
  const byCheck = assessment.attentionByCheck;

  const header = el("div", "mb-5");
  const heading = el("h2", "text-3xl font-bold tracking-tight text-ink", result.domain);
  heading.id = "report-title";
  heading.tabIndex = -1;
  header.append(heading);
  const when = new Date(result.inspectedAt).toLocaleString();
  header.append(
    el(
      "p",
      cx(val, "mt-1 text-ink-muted"),
      result.canonicalUrl ? `${result.canonicalUrl} · inspected ${when}` : `inspected ${when}`,
    ),
  );
  container.append(header);

  const propsAttention = byCheck["properties"] ?? 0;
  if (!result.properties.up || Object.keys(result.checks).length === 0) {
    container.append(propertiesCard(assessment, result.properties, propsAttention));
    const down = el("div", "card reveal mt-6 border-dashed p-8 text-center");
    down.append(
      el("p", cx(kicker, "mb-2 text-attention"), "No response"),
      el("p", "text-lg font-semibold text-ink", "This site appears to be down"),
      el(
        "p",
        cx(val, "mx-auto mt-2 max-w-md text-ink-muted"),
        "The domain didn't respond, so no checks were run. Double-check the domain and try again.",
      ),
    );
    container.append(down);
    return assessment.attentionCount;
  }

  const scores = new Map(scoreCategories(assessment).map((s) => [s.title, s]));
  const remaining = new Map(Object.entries(result.checks));
  const sections: HTMLElement[] = [];
  const navItems: NavItem[] = [
    {
      title: "Properties",
      id: "properties",
      attention: propsAttention,
      flagged: propsAttention > 0,
    },
  ];

  let cardIndex = 0;
  const addSection = (title: string, checks: CheckResult[], score?: CategoryScore) => {
    if (!checks.length) return;
    let attention = 0;
    let flagged = false;
    const cards = checks.map((c) => {
      const a = byCheck[c.name] ?? 0;
      attention += a;
      const card = checkCard(assessment, c, a, cardIndex++);
      flagged ||= card.dataset.flagged === "true";
      return card;
    });
    const id = slug(title);
    sections.push(section(title, id, cards, attention, flagged, score));
    navItems.push({ title, id, attention, flagged });
  };

  for (const group of CHECK_CATEGORIES) {
    const checks = group.checks.flatMap((name) => {
      const c = remaining.get(name);
      remaining.delete(name);
      return c ? [c] : [];
    });
    addSection(group.title, checks, scores.get(group.title));
  }
  addSection("Other", [...remaining.values()]);

  container.append(summaryBar(assessment.attentionCount, navItems, container));
  const issues = topIssues(assessment);
  if (issues) container.append(issues);

  const propsWrap = el("div", "mb-8");
  propsWrap.append(propertiesCard(assessment, result.properties, propsAttention));
  container.append(propsWrap);

  for (const s of sections) container.append(s);

  // "All clear" banner shown only when the issues filter is on and nothing is flagged.
  if (!navItems.some((i) => i.flagged)) container.classList.add("no-issues");
  const clear = el("div", "issues-clear card reveal hidden p-8 text-center");
  clear.append(
    el("p", cx(kicker, "mb-2 text-pass"), "All clear"),
    el("p", "text-lg font-semibold text-ink", "Nothing needs attention"),
    el(
      "p",
      cx(val, "mt-1 text-ink-muted"),
      "Every graded check passed. Turn off “Only issues” to see the full report.",
    ),
  );
  container.append(clear);
  return assessment.attentionCount;
}

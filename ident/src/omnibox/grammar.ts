import { findIcaoCountry } from "../data/icaoCountry";
import type { FilterSlice } from "../data/store";
import type { Aircraft, CategoryKey, RouteInfo } from "../data/types";

// Keyword toggles understood by applyToken. Single-word clauses with no colon.
export const KEYWORDS = [
  "emergency",
  "military",
  "ground",
  "!ground",
  "nopos",
  "haspos",
  "inview",
] as const;
export type Keyword = (typeof KEYWORDS)[number];

export function isKeyword(s: string): s is Keyword {
  return (KEYWORDS as readonly string[]).includes(s);
}

export interface OperatorToken {
  kind: "op";
  field: string;
  value: string;
}

export interface KeywordToken {
  kind: "kw";
  word: Keyword;
}

export interface UnknownToken {
  kind: "unknown";
  raw: string;
}

export type Token = OperatorToken | KeywordToken | UnknownToken;

// Tokenize a single clause (compose operators &/|/! are out of scope for
// apply-logic, but recognized by the tokenizer so the caller can ghost them).
export function tokenize(input: string): Token | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  const opMatch = /^([a-z]+):([^\s]+)$/i.exec(trimmed);
  if (opMatch) {
    return { kind: "op", field: opMatch[1].toLowerCase(), value: opMatch[2] };
  }
  if (isKeyword(trimmed.toLowerCase())) {
    return { kind: "kw", word: trimmed.toLowerCase() as Keyword };
  }
  return { kind: "unknown", raw: trimmed };
}

const CATEGORY_VALUE_TO_KEY: Record<string, CategoryKey> = {
  a1: "ga",
  a2: "airline",
  a3: "airline",
  a4: "airline",
  a5: "airline",
  a6: "bizjet",
  a7: "rotor",
  airline: "airline",
  ga: "ga",
  bizjet: "bizjet",
  mil: "mil",
  military: "mil",
  rotor: "rotor",
  unknown: "unknown",
  unk: "unknown",
};

const CATEGORY_KEY_TO_FILTER_CLAUSE: Record<CategoryKey, string> = {
  airline: "cat:a2",
  ga: "cat:a1",
  bizjet: "cat:a6",
  mil: "cat:mil",
  rotor: "cat:a7",
  unknown: "cat:unknown",
};

function parseAltRange(
  value: string,
  current: [number, number],
): [number, number] | null {
  const [lo, hi] = current;
  if (value.startsWith(">")) {
    if (value.slice(1).trim().length === 0) return null;
    const n = Number(value.slice(1));
    if (!Number.isFinite(n)) return null;
    return [n, hi];
  }
  if (value.startsWith("<")) {
    if (value.slice(1).trim().length === 0) return null;
    const n = Number(value.slice(1));
    if (!Number.isFinite(n)) return null;
    return [lo, n];
  }
  const rangeMatch = /^(-?\d+)\.\.(-?\d+)$/.exec(value);
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return [Math.min(a, b), Math.max(a, b)];
  }
  return null;
}

// Parse `>N`, `<N`, or `A..B` into a bounded [min, max] range using
// Number.MIN_SAFE_INTEGER / MAX_SAFE_INTEGER as sentinels for the open side.
// Returns null when the value doesn't match any supported form.
function parseNumericRange(value: string): [number, number] | null {
  if (value.startsWith(">")) {
    if (value.slice(1).trim().length === 0) return null;
    const n = Number(value.slice(1));
    if (!Number.isFinite(n)) return null;
    return [n, Number.MAX_SAFE_INTEGER];
  }
  if (value.startsWith("<")) {
    if (value.slice(1).trim().length === 0) return null;
    const n = Number(value.slice(1));
    if (!Number.isFinite(n)) return null;
    return [Number.MIN_SAFE_INTEGER, n];
  }
  const rangeMatch = /^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/.exec(value);
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return [Math.min(a, b), Math.max(a, b)];
  }
  return null;
}

// Parse `A±B` heading window. Returns [center, tolerance] normalized so
// center ∈ [0, 360) and tolerance ∈ [0, 180].
function parseHeadingWindow(value: string): [number, number] | null {
  const m = /^(-?\d+(?:\.\d+)?)\s*(?:±|\+-|\+\/-)\s*(\d+(?:\.\d+)?)$/.exec(
    value,
  );
  if (!m) return null;
  const center = Number(m[1]);
  const tol = Number(m[2]);
  if (!Number.isFinite(center) || !Number.isFinite(tol)) return null;
  const norm = ((center % 360) + 360) % 360;
  return [norm, Math.min(180, Math.max(0, tol))];
}

// A value-completion suggestion for field-focus mode. `value` is the tail
// the user would type after `field:` (e.g. `>20000` for `alt:`); `desc`
// describes its effect. The rendered token is `${field}:${value}`.
export interface ValueSuggestion {
  value: string;
  desc: string;
}

// Static value-completion tables for fields with well-known enums or
// canonical magnitudes. Live-data fields (cs, hex, reg, type, op, rt)
// draw their suggestions from the aircraft map at render time.
export const VALUE_SUGGESTIONS: Record<string, ValueSuggestion[]> = {
  alt: [
    { value: ">1000", desc: "Altitude greater than 1,000 ft" },
    { value: ">5000", desc: "Altitude greater than 5,000 ft" },
    { value: ">10000", desc: "Altitude greater than 10,000 ft" },
    { value: ">20000", desc: "Altitude greater than 20,000 ft" },
    { value: ">30000", desc: "Altitude greater than 30,000 ft" },
    { value: ">40000", desc: "Altitude greater than 40,000 ft" },
    { value: "<1000", desc: "Altitude below 1,000 ft" },
    { value: "<5000", desc: "Altitude below 5,000 ft" },
    { value: "<10000", desc: "Altitude below 10,000 ft" },
    { value: "0..10000", desc: "Altitude 0 to 10,000 ft" },
    { value: "10000..30000", desc: "Altitude 10,000 to 30,000 ft" },
    { value: "30000..45000", desc: "Altitude 30,000 to 45,000 ft" },
  ],
  kt: [
    { value: ">100", desc: "Ground speed greater than 100 kt" },
    { value: ">200", desc: "Ground speed greater than 200 kt" },
    { value: ">300", desc: "Ground speed greater than 300 kt" },
    { value: ">400", desc: "Ground speed greater than 400 kt" },
    { value: ">500", desc: "Ground speed greater than 500 kt" },
  ],
  nm: [
    { value: "<10", desc: "Distance less than 10 nm" },
    { value: "<25", desc: "Distance less than 25 nm" },
    { value: "<50", desc: "Distance less than 50 nm" },
    { value: "<100", desc: "Distance less than 100 nm" },
    { value: ">100", desc: "Distance greater than 100 nm" },
    { value: ">200", desc: "Distance greater than 200 nm" },
  ],
  vs: [
    { value: ">500", desc: "Climbing faster than 500 fpm" },
    { value: ">1000", desc: "Climbing faster than 1,000 fpm" },
    { value: ">2000", desc: "Climbing faster than 2,000 fpm" },
    { value: "<-500", desc: "Descending faster than 500 fpm" },
    { value: "<-1000", desc: "Descending faster than 1,000 fpm" },
    { value: "<-2000", desc: "Descending faster than 2,000 fpm" },
  ],
  hdg: [
    { value: "0±45", desc: "Heading north (±45°)" },
    { value: "90±45", desc: "Heading east (±45°)" },
    { value: "180±45", desc: "Heading south (±45°)" },
    { value: "270±45", desc: "Heading west (±45°)" },
    { value: "90±30", desc: "Heading east (±30°)" },
    { value: "270±30", desc: "Heading west (±30°)" },
  ],
  cat: [
    { value: "a1", desc: "Light / GA" },
    { value: "a2", desc: "Small airliner" },
    { value: "a3", desc: "Large airliner" },
    { value: "a4", desc: "Heavy" },
    { value: "a5", desc: "Jumbo" },
    { value: "a6", desc: "High-performance / bizjet" },
    { value: "a7", desc: "Rotorcraft" },
  ],
  src: [
    { value: "adsb", desc: "All ADS-B sources" },
    { value: "mlat", desc: "MLAT (multilateration)" },
    { value: "tisb", desc: "All TIS-B sources" },
    { value: "mode_s", desc: "Mode S (no position)" },
    { value: "adsc", desc: "ADS-C (oceanic / satellite)" },
  ],
  sqk: [
    { value: "7500", desc: "Hijack" },
    { value: "7600", desc: "Radio failure" },
    { value: "7700", desc: "Emergency" },
    { value: "1200", desc: "VFR (US)" },
    { value: "7000", desc: "VFR (EU)" },
  ],
};

// All fields that show up in field-focus mode (static + live).
export const FIELD_FOCUS_FIELDS = new Set<string>([
  ...Object.keys(VALUE_SUGGESTIONS),
  "cs",
  "hex",
  "reg",
  "type",
  "op",
  "rt",
  "country",
]);

// Parse a partial operator token `field:partial`. Returns the field and
// the already-typed value tail, or null if the query isn't in field-focus
// shape (no colon yet, or whitespace present — field-focus is intra-clause).
export function parseFieldFocus(
  input: string,
): { field: string; partial: string } | null {
  const m = /^([a-z]+):([^\s]*)$/i.exec(input);
  if (!m) return null;
  const field = m[1].toLowerCase();
  if (!FIELD_FOCUS_FIELDS.has(field)) return null;
  return { field, partial: m[2] };
}

export interface ParsedOmniboxQuery {
  kind: "search" | "filter";
  body: string;
  clauses: string[];
  text: string;
  invalidClauses: string[];
  expressionParts: string[];
  usesLogicalSyntax: boolean;
}

export interface DerivedFilterQuery {
  kind: "search" | "filter";
  filter: FilterSlice;
  clauses: string[];
  text: string;
  invalidClauses: string[];
  expressionBranches: FilterSlice[] | null;
}

export interface QueryFieldFocus {
  field: string;
  partial: string;
  filterMode: boolean;
}

export interface OmniboxFilterChip {
  label: string;
  start: number;
  end: number;
  kind: "clause" | "logic";
}

const TEXT_SEARCH_FIELDS = new Set(["any"]);
const DEFAULT_ALT_RANGE_FT: [number, number] = [0, 45000];

interface QueryPart {
  text: string;
  start: number;
  end: number;
}

interface FilterExpressionClause {
  kind: "clause";
  raw: string;
}

interface FilterExpressionAnd {
  kind: "and";
  terms: FilterExpression[];
}

interface FilterExpressionOr {
  kind: "or";
  terms: FilterExpression[];
}

type FilterExpression =
  | FilterExpressionClause
  | FilterExpressionAnd
  | FilterExpressionOr;

export function isStructuredQuery(input: string): boolean {
  return parseOmniboxQuery(input).kind === "filter";
}

function lexQueryParts(input: string): QueryPart[] {
  return [...input.matchAll(/[()|&]|[^()\s|&]+/g)].map((match) => {
    const start = match.index ?? 0;
    return {
      text: match[0],
      start,
      end: start + match[0].length,
    };
  });
}

function isLogicalSyntaxPart(part: string): boolean {
  return part === "(" || part === ")" || part === "|" || part === "&";
}

export function parseOmniboxQuery(input: string): ParsedOmniboxQuery {
  const body = input.trim();
  if (body.length === 0) {
    return {
      kind: "search",
      body,
      clauses: [],
      text: "",
      invalidClauses: [],
      expressionParts: [],
      usesLogicalSyntax: false,
    };
  }

  const rawParts = lexQueryParts(body);
  const clauses: string[] = [];
  const textParts: string[] = [];
  const invalidClauses: string[] = [];
  const expressionParts: string[] = [];
  let structured = false;

  for (let i = 0; i < rawParts.length; i++) {
    const part = rawParts[i].text;
    if (isLogicalSyntaxPart(part)) {
      structured = true;
      expressionParts.push(part);
      continue;
    }

    const textMatch = /^([a-z]+):(.*)$/i.exec(part);
    if (textMatch && TEXT_SEARCH_FIELDS.has(textMatch[1].toLowerCase())) {
      structured = true;
      const inlineValue = textMatch[2];
      if (inlineValue.length > 0) {
        textParts.push(inlineValue);
        continue;
      }
      while (i + 1 < rawParts.length) {
        const next = rawParts[i + 1].text;
        if (isTextSearchStart(next) || isRecognizedClause(next)) break;
        if (isLogicalSyntaxPart(next)) break;
        textParts.push(next);
        i++;
      }
      continue;
    }

    const token = tokenize(part);
    if (token?.kind === "op" || token?.kind === "kw") {
      structured = true;
      clauses.push(part);
      expressionParts.push(part);
    } else {
      invalidClauses.push(part);
    }
  }

  return {
    kind: structured ? "filter" : "search",
    body,
    clauses,
    text: textParts.join(" "),
    invalidClauses: structured ? invalidClauses : [],
    expressionParts,
    usesLogicalSyntax: expressionParts.some((part) =>
      isLogicalSyntaxPart(part),
    ),
  };
}

export function deriveFilterFromQuery(
  input: string,
  baseFilter: FilterSlice,
): DerivedFilterQuery {
  const parsed = parseOmniboxQuery(input);
  if (parsed.kind !== "filter") {
    return {
      kind: "search",
      filter: baseFilter,
      clauses: [],
      text: parsed.body,
      invalidClauses: [],
      expressionBranches: null,
    };
  }

  let filter = baseFilter;
  const invalidClauses = parsed.invalidClauses.slice();
  for (const clause of parsed.clauses) {
    const token = tokenize(clause);
    if (!token) continue;
    const next = applyToken(filter, token);
    if (next.applied) {
      filter = next.filter;
    } else {
      invalidClauses.push(clause);
    }
  }

  let expressionBranches: FilterSlice[] | null = null;
  if (parsed.usesLogicalSyntax) {
    const expression = parseFilterExpression(parsed.expressionParts);
    if (expression.node) {
      const result = buildExpressionBranches(expression.node, baseFilter);
      expressionBranches = result.branches.length > 0 ? result.branches : null;
      invalidClauses.push(...result.invalidClauses);
    }
    invalidClauses.push(...expression.invalidParts);
  }

  return {
    kind: "filter",
    filter: expressionBranches ? { ...baseFilter, expressionBranches } : filter,
    clauses: parsed.clauses,
    text: parsed.text,
    invalidClauses,
    expressionBranches,
  };
}

function parseFilterExpression(parts: string[]): {
  node: FilterExpression | null;
  invalidParts: string[];
} {
  let index = 0;
  const invalidParts: string[] = [];

  function peek(): string | undefined {
    return parts[index];
  }

  function consume(): string | undefined {
    return parts[index++];
  }

  function startsPrimary(part: string | undefined): boolean {
    return part === "(" || (part != null && isRecognizedClause(part));
  }

  function parsePrimary(): FilterExpression | null {
    const part = peek();
    if (part == null) return null;
    if (part === "(") {
      consume();
      const expr = parseOr();
      if (peek() === ")") {
        consume();
      } else {
        invalidParts.push("(");
      }
      return expr;
    }
    if (isRecognizedClause(part)) {
      consume();
      return { kind: "clause", raw: part };
    }
    invalidParts.push(part);
    consume();
    return null;
  }

  function parseAnd(): FilterExpression | null {
    const terms: FilterExpression[] = [];
    const first = parsePrimary();
    if (first) terms.push(first);

    while (index < parts.length) {
      const part = peek();
      if (part === ")" || part === "|") break;
      if (part === "&") {
        consume();
        const next = parsePrimary();
        if (next) terms.push(next);
        continue;
      }
      if (startsPrimary(part)) {
        const next = parsePrimary();
        if (next) terms.push(next);
        continue;
      }
      if (part != null) {
        invalidParts.push(part);
        consume();
      }
    }

    if (terms.length === 0) return null;
    return terms.length === 1 ? terms[0] : { kind: "and", terms };
  }

  function parseOr(): FilterExpression | null {
    const terms: FilterExpression[] = [];
    const first = parseAnd();
    if (first) terms.push(first);

    while (peek() === "|") {
      consume();
      const next = parseAnd();
      if (next) terms.push(next);
    }

    if (terms.length === 0) return null;
    return terms.length === 1 ? terms[0] : { kind: "or", terms };
  }

  const node = parseOr();
  while (index < parts.length) {
    const part = consume();
    if (part != null) invalidParts.push(part);
  }

  return { node, invalidParts };
}

function clauseBranchesForExpression(node: FilterExpression): string[][] {
  if (node.kind === "clause") return [[node.raw]];
  if (node.kind === "or") {
    return node.terms.flatMap((term) => clauseBranchesForExpression(term));
  }

  let branches: string[][] = [[]];
  for (const term of node.terms) {
    const termBranches = clauseBranchesForExpression(term);
    const nextBranches: string[][] = [];
    for (const branch of branches) {
      for (const termBranch of termBranches) {
        nextBranches.push([...branch, ...termBranch]);
      }
    }
    branches = nextBranches;
  }
  return branches;
}

function cloneFilter(baseFilter: FilterSlice): FilterSlice {
  return {
    ...baseFilter,
    categories: { ...baseFilter.categories },
    expressionBranches: null,
  };
}

function buildExpressionBranches(
  node: FilterExpression,
  baseFilter: FilterSlice,
): { branches: FilterSlice[]; invalidClauses: string[] } {
  const branches: FilterSlice[] = [];
  const invalidClauses: string[] = [];

  for (const clauses of clauseBranchesForExpression(node)) {
    let filter = cloneFilter(baseFilter);
    let validBranch = true;
    for (const clause of clauses) {
      const token = tokenize(clause);
      if (!token) continue;
      const next = applyToken(filter, token);
      if (!next.applied) {
        invalidClauses.push(clause);
        validBranch = false;
        break;
      }
      filter = next.filter;
    }
    if (validBranch) branches.push(filter);
  }

  return { branches, invalidClauses };
}

export function parseFieldFocusInQuery(input: string): QueryFieldFocus | null {
  if (/\s$/.test(input)) return null;
  const currentClause = currentFilterClause(input);
  if (!currentClause || isTextSearchStart(currentClause)) return null;
  const focus = parseFieldFocus(currentClause);
  return focus ? { ...focus, filterMode: isStructuredQuery(input) } : null;
}

export function completeFilterClause(input: string, clause: string): string {
  const normalizedClause = clause.trim();
  if (normalizedClause.length === 0) return input;
  const trimmedEnd = input.trimEnd();
  if (trimmedEnd.length === 0) return normalizedClause;
  if (/\s$/.test(input)) return `${trimmedEnd} ${normalizedClause}`;
  const current = currentFilterPart(trimmedEnd);
  if (!current) return normalizedClause;
  if (current.text === "(" || current.text === "|" || current.text === "&") {
    return `${trimmedEnd}${normalizedClause}`;
  }
  if (current.text === ")") {
    return `${trimmedEnd} ${normalizedClause}`;
  }
  return `${trimmedEnd.slice(0, current.start)}${normalizedClause}${trimmedEnd.slice(current.end)}`;
}

export function upsertAltitudeClause(
  input: string,
  range: [number, number],
): string {
  const [lo, hi] = range;
  let clause: string | null = null;
  if (lo > DEFAULT_ALT_RANGE_FT[0] || hi < DEFAULT_ALT_RANGE_FT[1]) {
    if (lo > DEFAULT_ALT_RANGE_FT[0] && hi >= DEFAULT_ALT_RANGE_FT[1]) {
      clause = `alt:>${lo}`;
    } else if (lo <= DEFAULT_ALT_RANGE_FT[0] && hi < DEFAULT_ALT_RANGE_FT[1]) {
      clause = `alt:<${hi}`;
    } else {
      clause = `alt:${lo}..${hi}`;
    }
  }
  return upsertFilterClauses(input, clause, (existing) =>
    clauseHasField(existing, "alt"),
  );
}

export function setCategoryFilterClause(
  input: string,
  key: CategoryKey,
  enabled: boolean,
): string {
  return upsertFilterClauses(
    input,
    enabled ? CATEGORY_KEY_TO_FILTER_CLAUSE[key] : null,
    (existing) => categoryKeyForClause(existing) === key,
  );
}

function currentFilterClause(body: string): string | null {
  return currentFilterPart(body)?.text ?? null;
}

function currentFilterPart(body: string): QueryPart | null {
  const parts = lexQueryParts(body);
  return parts[parts.length - 1] ?? null;
}

function upsertFilterClauses(
  input: string,
  clause: string | null,
  shouldRemove: (existing: string) => boolean,
): string {
  const normalizedClause = clause?.trim();
  const withoutRemoved = removeFilterClauses(input, shouldRemove);
  const parts = [normalizeFilterQuerySpacing(withoutRemoved)];
  if (normalizedClause) parts.push(normalizedClause);
  return normalizeFilterQuerySpacing(parts.filter(Boolean).join(" "));
}

export function removeFilterChipFromQuery(
  input: string,
  chip: OmniboxFilterChip,
): string {
  return cleanupDanglingLogic(blankSpan(input, chip.start, chip.end));
}

function removeFilterClauses(
  input: string,
  shouldRemove: (existing: string) => boolean,
): string {
  let next = input;
  for (const part of lexQueryParts(input)) {
    if (!isRecognizedClause(part.text) || !shouldRemove(part.text)) continue;
    next = blankSpan(next, part.start, part.end);
  }
  return cleanupDanglingLogic(next);
}

function blankSpan(input: string, start: number, end: number): string {
  const chars = [...input];
  for (let i = start; i < end; i++) chars[i] = " ";
  return chars.join("");
}

function normalizeFilterQuerySpacing(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*([()|&])\s*/g, " $1 ")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

function cleanupDanglingLogic(input: string): string {
  let next = normalizeFilterQuerySpacing(input);
  let previous = "";
  while (next !== previous) {
    previous = next;
    next = normalizeFilterQuerySpacing(
      next
        .replace(/\(\s*([|&])\s*/g, "(")
        .replace(/\s*([|&])\s*\)/g, ")")
        .replace(/^([|&])\s+/g, "")
        .replace(/\s+([|&])$/g, "")
        .replace(/([|&])\s+([|&])/g, "$2")
        .replace(/\(\s*\)/g, ""),
    );
  }
  return next;
}

function clauseHasField(clause: string, field: string): boolean {
  const token = tokenize(clause);
  return token?.kind === "op" && token.field === field;
}

function categoryKeyForClause(clause: string): CategoryKey | null {
  const token = tokenize(clause);
  if (token?.kind !== "op" || token.field !== "cat") return null;
  return CATEGORY_VALUE_TO_KEY[token.value.toLowerCase()] ?? null;
}

function isTextSearchStart(part: string): boolean {
  const match = /^([a-z]+):/i.exec(part);
  return match ? TEXT_SEARCH_FIELDS.has(match[1].toLowerCase()) : false;
}

function isRecognizedClause(part: string): boolean {
  const token = tokenize(part);
  return token?.kind === "op" || token?.kind === "kw";
}

export function queryTextFromOmnibox(input: string): string {
  const parsed = parseOmniboxQuery(input);
  return parsed.kind === "filter" ? parsed.text : parsed.body;
}

export function extractFilterChips(input: string): OmniboxFilterChip[] {
  if (!isStructuredQuery(input)) return [];

  const parts = lexQueryParts(input);
  const chips: OmniboxFilterChip[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (isLogicalSyntaxPart(part.text)) {
      chips.push({
        label: part.text,
        start: part.start,
        end: part.end,
        kind: "logic",
      });
      continue;
    }

    if (isTextSearchStart(part.text)) {
      let end = part.end;
      while (i + 1 < parts.length) {
        const next = parts[i + 1];
        if (isTextSearchStart(next.text) || isRecognizedClause(next.text)) {
          break;
        }
        if (isLogicalSyntaxPart(next.text)) break;
        end = next.end;
        i++;
      }
      const label = input.slice(part.start, end).trim();
      if (label !== "any:") {
        chips.push({ label, start: part.start, end, kind: "clause" });
      }
      continue;
    }

    if (isRecognizedClause(part.text)) {
      chips.push({
        label: part.text,
        start: part.start,
        end: part.end,
        kind: "clause",
      });
    }
  }

  return chips;
}

export function currentQueryToken(input: string): string {
  if (/\s$/.test(input)) return "";
  const current = currentFilterPart(input);
  if (!current) return input.trim();
  return isLogicalSyntaxPart(current.text) ? "" : current.text;
}

// Build live value suggestions from the current aircraft map (and route
// cache, for the `rt:` field). Dedupes, sorts by frequency desc, and
// trims to a stable top-10. Callers pass the already-mode-switched `field`.
export function buildLiveFieldSuggestions(
  field: string,
  aircraftMap: ReadonlyMap<string, Aircraft>,
  routeByCallsign: Record<string, RouteInfo | null>,
): ValueSuggestion[] {
  const freq = new Map<string, number>();
  const bump = (key: string | undefined | null) => {
    if (!key) return;
    const k = key.trim();
    if (!k) return;
    freq.set(k, (freq.get(k) ?? 0) + 1);
  };

  if (field === "cs") {
    for (const ac of aircraftMap.values()) {
      const cs = (ac.flight ?? "").trim().toUpperCase();
      if (cs.length >= 3 && /^[A-Z]{3}/.test(cs)) bump(cs.slice(0, 3));
    }
  } else if (field === "hex") {
    // Most-recently-seen: lowest `seen` value wins. We can't dedupe-by-freq
    // since hexes are unique; sort by seen ascending instead.
    const sorted = [...aircraftMap.values()]
      .slice()
      .sort((a, b) => (a.seen ?? Infinity) - (b.seen ?? Infinity))
      .slice(0, 10);
    return sorted
      .map((ac) => ac.hex)
      .filter((h): h is string => Boolean(h))
      .map((h) => ({ value: h.toLowerCase(), desc: `hex ${h.toLowerCase()}` }));
  } else if (field === "reg") {
    for (const ac of aircraftMap.values()) bump(ac.r);
  } else if (field === "type") {
    for (const ac of aircraftMap.values()) bump(ac.t);
  } else if (field === "op") {
    for (const ac of aircraftMap.values()) {
      const op = ac.ownOp?.trim().split(/\s+/)[0];
      bump(op);
    }
  } else if (field === "rt") {
    for (const ac of aircraftMap.values()) {
      const cs = (ac.flight ?? "").trim().toUpperCase();
      if (!cs) continue;
      const route = routeByCallsign[cs];
      if (!route) continue;
      bump(route.origin);
      bump(route.destination);
    }
  } else if (field === "country") {
    const countries = new Map<
      string,
      { code: string; name: string; count: number }
    >();
    for (const ac of aircraftMap.values()) {
      const country = findIcaoCountry(ac.hex);
      const code = country.countryCode?.trim().toUpperCase();
      if (!code) continue;
      const name = country.country === "Unassigned" ? code : country.country;
      const existing = countries.get(code);
      countries.set(code, {
        code,
        name,
        count: (existing?.count ?? 0) + 1,
      });
    }
    return [...countries.values()]
      .sort(
        (a, b) =>
          b.count - a.count ||
          a.name.localeCompare(b.name) ||
          a.code.localeCompare(b.code),
      )
      .slice(0, 10)
      .map(({ code, name }) => ({
        value: code,
        desc: name === code ? `ICAO country ${code}` : `ICAO country ${name}`,
      }));
  } else {
    return [];
  }

  const sorted = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10);

  const describe = (field: string, value: string): string => {
    switch (field) {
      case "cs":
        return `callsigns starting with ${value}`;
      case "reg":
        return `registration starting with ${value}`;
      case "type":
        return `aircraft type ${value}`;
      case "op":
        return `operator ${value}`;
      case "rt":
        return `origin or destination ${value}`;
      case "country":
        return `ICAO country ${value}`;
      default:
        return value;
    }
  };

  return sorted.map(([value]) => ({ value, desc: describe(field, value) }));
}

// Merge well-known squawks with a frequency-sorted tail of live squawks,
// deduped and capped at 10 entries. Used for `sqk:` field-focus where the
// static table is hard-coded emergencies and the tail is whatever's actually
// on air right now.
export function buildLiveSquawkSuggestions(
  aircraftMap: ReadonlyMap<string, Aircraft>,
): ValueSuggestion[] {
  const freq = new Map<string, number>();
  for (const ac of aircraftMap.values()) {
    const sq = (ac.squawk ?? "").trim();
    if (sq) freq.set(sq, (freq.get(sq) ?? 0) + 1);
  }
  const seen = new Set(VALUE_SUGGESTIONS.sqk.map((s) => s.value));
  const tail: ValueSuggestion[] = [...freq.entries()]
    .filter(([v]) => !seen.has(v))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10 - VALUE_SUGGESTIONS.sqk.length)
    .map(([value]) => ({ value, desc: `live squawk ${value}` }));
  return [...VALUE_SUGGESTIONS.sqk, ...tail];
}

export interface ApplyResult {
  filter: FilterSlice;
  applied: boolean;
}

// Apply a token to the current filter slice, returning the next slice. When
// the token isn't recognized or its value doesn't parse, `applied` is false
// and the filter is returned unchanged.
export function applyToken(filter: FilterSlice, token: Token): ApplyResult {
  if (token.kind === "kw") {
    switch (token.word) {
      case "emergency":
        return { filter: { ...filter, emergOnly: true }, applied: true };
      case "ground":
        return { filter: { ...filter, hideGround: false }, applied: true };
      case "!ground":
        return { filter: { ...filter, hideGround: true }, applied: true };
      case "haspos":
        return { filter: { ...filter, hasPosOnly: true }, applied: true };
      case "nopos":
        return { filter: { ...filter, hasPosOnly: false }, applied: true };
      case "military":
        return { filter: { ...filter, militaryOnly: true }, applied: true };
      case "inview":
        return { filter: { ...filter, inViewOnly: true }, applied: true };
    }
  }
  if (token.kind === "op") {
    if (token.field === "alt") {
      const next = parseAltRange(token.value, filter.altRangeFt);
      if (next)
        return { filter: { ...filter, altRangeFt: next }, applied: true };
      return { filter, applied: false };
    }
    if (token.field === "cat") {
      const key = CATEGORY_VALUE_TO_KEY[token.value.toLowerCase()];
      if (key) {
        return {
          filter: {
            ...filter,
            categories: { ...filter.categories, [key]: true },
          },
          applied: true,
        };
      }
      return { filter, applied: false };
    }
    if (token.field === "op") {
      // Generic operator-name substring match; any text works.
      return {
        filter: { ...filter, operatorContains: token.value },
        applied: true,
      };
    }
    if (token.field === "cs") {
      // Callsign prefix. Strip trailing * so users can type `cs:UAL*`.
      const stripped = token.value.replace(/\*+$/, "");
      return { filter: { ...filter, callsignPrefix: stripped }, applied: true };
    }
    if (token.field === "rt") {
      return {
        filter: { ...filter, routeContains: token.value },
        applied: true,
      };
    }
    if (token.field === "country") {
      return {
        filter: { ...filter, countryContains: token.value },
        applied: true,
      };
    }
    if (token.field === "hex") {
      return { filter: { ...filter, hexContains: token.value }, applied: true };
    }
    if (token.field === "reg") {
      const stripped = token.value.replace(/\*+$/, "");
      return { filter: { ...filter, regPrefix: stripped }, applied: true };
    }
    if (token.field === "sqk") {
      return {
        filter: { ...filter, squawkEquals: token.value.trim() },
        applied: true,
      };
    }
    if (token.field === "type") {
      const stripped = token.value.replace(/\*+$/, "");
      return { filter: { ...filter, typePrefix: stripped }, applied: true };
    }
    if (token.field === "src") {
      return {
        filter: { ...filter, sourceEquals: token.value.toLowerCase() },
        applied: true,
      };
    }
    if (token.field === "kt") {
      const range = parseNumericRange(token.value);
      if (range)
        return { filter: { ...filter, gsRangeKt: range }, applied: true };
      return { filter, applied: false };
    }
    if (token.field === "nm") {
      const range = parseNumericRange(token.value);
      if (range)
        return { filter: { ...filter, distRangeNm: range }, applied: true };
      return { filter, applied: false };
    }
    if (token.field === "vs") {
      const range = parseNumericRange(token.value);
      if (range)
        return { filter: { ...filter, vsRangeFpm: range }, applied: true };
      return { filter, applied: false };
    }
    if (token.field === "hdg") {
      const parsed = parseHeadingWindow(token.value);
      if (parsed) {
        return {
          filter: { ...filter, hdgCenter: parsed[0], hdgTolerance: parsed[1] },
          applied: true,
        };
      }
      return { filter, applied: false };
    }
    // TODO(compose): compose operators `&`, `|`, `!` require an expression
    // tree and are intentionally unhandled here.
    return { filter, applied: false };
  }
  return { filter, applied: false };
}

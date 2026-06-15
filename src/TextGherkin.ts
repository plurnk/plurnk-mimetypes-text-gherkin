import { BaseHandler } from "@plurnk/plurnk-mimetypes";
import type { HandlerContent, MimeSymbol } from "@plurnk/plurnk-mimetypes";
import {
    Parser,
    AstBuilder,
    GherkinClassicTokenMatcher,
} from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";

// text/x-gherkin (.feature BDD) handler, backed by @cucumber/gherkin — the
// cucumber org's reference parser (pure JS/ESM, synchronous, no WASM). Gherkin
// has no usable tree-sitter grammar, so the lean-library tier applies; the
// dep precedent is text-pdf's pdfjs.
//
// extractRaw(): one MimeSymbol per Feature / Rule / Scenario / Scenario
//   Outline / Background / step / Examples block. Containers are the dot-joined
//   path of enclosing named symbols (§3 issue #18).
//
// The AST carries START locations only; endLine is derived as the maximum line
// of every descendant node (docStrings extend to their closing delimiter;
// tables extend to their last row). @cucumber/gherkin handles localization
// natively (`# language: fr`, 80 dialects) — keyword extraction reads the
// parsed keyword text, so non-English surfaces for free.
//
// references(): refs-free by design. Gherkin steps bind to step-definitions in
// OTHER codebases via regex/cucumber-expression; nothing in a .feature corpus
// is name-joinable, so there is no honest code-graph edge to emit.
export default class TextGherkin extends BaseHandler {
    override extractRaw(content: HandlerContent): MimeSymbol[] {
        const source = typeof content === "string"
            ? content
            : new TextDecoder("utf-8").decode(content);
        let doc: GherkinDocument;
        try {
            doc = parse(source);
        } catch {
            // Malformed .feature → @cucumber/gherkin throws a
            // CompositeParserException ("Parser errors: ..."). Mirror the
            // AntlrExtractor catch-to-empty policy: agents see malformed input,
            // and the symbols channel comes back empty rather than erroring.
            return [];
        }
        const feature = doc.feature;
        if (!feature) return [];
        return buildSymbols(feature);
    }
}

function parse(source: string): GherkinDocument {
    const parser = new Parser(
        new AstBuilder(IdGenerator.incrementing()),
        new GherkinClassicTokenMatcher(),
    );
    return parser.parse(source) as GherkinDocument;
}

function buildSymbols(feature: Feature): MimeSymbol[] {
    const out: MimeSymbol[] = [];
    const featureName = feature.name || feature.keyword;
    out.push(node("module", featureName, feature.location, lastLine(feature)));

    for (const child of feature.children ?? []) {
        emitChild(child, featureName, out);
    }
    return out;
}

// A feature child is exactly one of background / scenario / rule. Rules nest
// their own background/scenario children under the rule's path.
function emitChild(
    child: FeatureChild,
    container: string,
    out: MimeSymbol[],
): void {
    if (child.rule) {
        const rule = child.rule;
        const ruleName = rule.name || rule.keyword;
        out.push(node("module", ruleName, rule.location, lastLine(rule), container));
        const innerPath = `${container}.${ruleName}`;
        for (const inner of rule.children ?? []) emitChild(inner, innerPath, out);
        return;
    }
    if (child.background) {
        emitBackground(child.background, container, out);
        return;
    }
    if (child.scenario) {
        emitScenario(child.scenario, container, out);
    }
}

function emitBackground(
    bg: Background,
    container: string,
    out: MimeSymbol[],
): void {
    out.push(node("function", bg.keyword, bg.location, lastLine(bg), container));
    const path = `${container}.${bg.keyword}`;
    for (const step of bg.steps ?? []) emitStep(step, path, out);
}

function emitScenario(
    sc: Scenario,
    container: string,
    out: MimeSymbol[],
): void {
    const name = sc.name || sc.keyword;
    out.push(node("function", name, sc.location, lastLine(sc), container));
    const path = `${container}.${name}`;
    for (const step of sc.steps ?? []) emitStep(step, path, out);
    for (const ex of sc.examples ?? []) {
        const exName = ex.name ? `${ex.keyword}: ${ex.name}` : ex.keyword;
        out.push(node("field", exName, ex.location, lastLine(ex), path));
    }
}

// Step name is "{keyword}{text}" — the parsed keyword already carries its
// trailing space ("Given "), so "Given a paid invoice" composes directly.
function emitStep(step: Step, container: string, out: MimeSymbol[]): void {
    const name = `${step.keyword}${step.text}`.trim();
    out.push(node("field", name, step.location, lastLine(step), container));
}

function node(
    kind: MimeSymbol["kind"],
    name: string,
    location: Location,
    endLine: number,
    container?: string,
): MimeSymbol {
    const sym: MimeSymbol = {
        name,
        kind,
        line: location.line,
        endLine,
        column: location.column,
    };
    if (container !== undefined) sym.container = container;
    return sym;
}

// endLine = the maximum source line reached by any descendant of `node`. The
// AST stores start positions only, so we recurse the whole subtree and take
// the deepest line. docStrings reach their closing delimiter (start line +
// content line count + 1); tables reach their last row.
function lastLine(node: unknown): number {
    let max = 0;
    const visit = (value: unknown): void => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        const obj = value as Record<string, unknown>;
        const loc = obj.location as Location | undefined;
        if (loc && typeof loc.line === "number" && loc.line > max) max = loc.line;
        const docEnd = docStringEnd(obj);
        if (docEnd > max) max = docEnd;
        for (const key of Object.keys(obj)) {
            if (key === "location") continue;
            visit(obj[key]);
        }
    };
    visit(node);
    return max;
}

// A docString node reaches its closing delimiter: opening delimiter line +
// content line count + closing delimiter line. Returns 0 for non-docString
// objects so callers can `max` it unconditionally.
function docStringEnd(obj: Record<string, unknown>): number {
    if (typeof obj.content !== "string" || typeof obj.delimiter !== "string") return 0;
    const loc = obj.location as Location | undefined;
    if (!loc || typeof loc.line !== "number") return 0;
    const lines = obj.content.length === 0 ? 0 : obj.content.split("\n").length;
    return loc.line + lines + 1;
}

// Minimal structural types for the @cucumber/gherkin GherkinDocument subset
// this handler reads. The full @cucumber/messages types carry far more; we
// type only the fields touched here (plain-TS-as-JS-with-type-hints).
interface Location {
    line: number;
    column: number;
}
interface Step {
    keyword: string;
    text: string;
    location: Location;
    docString?: { location: Location; content: string; delimiter: string };
}
interface Background {
    keyword: string;
    name: string;
    location: Location;
    steps?: Step[];
}
interface Examples {
    keyword: string;
    name: string;
    location: Location;
}
interface Scenario {
    keyword: string;
    name: string;
    location: Location;
    steps?: Step[];
    examples?: Examples[];
}
interface Rule {
    keyword: string;
    name: string;
    location: Location;
    children?: FeatureChild[];
}
interface FeatureChild {
    background?: Background;
    scenario?: Scenario;
    rule?: Rule;
}
interface Feature {
    keyword: string;
    name: string;
    location: Location;
    children?: FeatureChild[];
}
interface GherkinDocument {
    feature?: Feature;
}

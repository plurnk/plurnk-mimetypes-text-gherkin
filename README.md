# @plurnk/plurnk-mimetypes-text-gherkin

`text/x-gherkin` (Gherkin / `.feature` BDD) mimetype handler for the [plurnk](https://github.com/plurnk) ecosystem. Lean-library tier, backed by [`@cucumber/gherkin`](https://github.com/cucumber/gherkin) — the cucumber org's reference parser.

## why @cucumber/gherkin

Gherkin has no usable tree-sitter grammar, so Tiers 1–3 (clean WASM / dirty WASM / antlr4ng) don't apply. The honest backend is the format's own reference parser: `@cucumber/gherkin` is pure JS/ESM, parses synchronously (no WASM init), and natively handles every Gherkin construct including localization (80 dialects via `# language: xx`). The dep precedent is `text-pdf`'s pdfjs — a focused, canonical library beats a hand-rolled scanner once the parse surface (docstrings, data tables, outlines, dialects) gets non-trivial.

## what it emits

`extractRaw` → `MimeSymbol[]` with 1-indexed `line` / `endLine` / `column`. The AST carries start locations only; `endLine` is derived as the deepest descendant line (docstrings reach their closing delimiter, tables reach their last row).

| construct | kind | name | container |
|---|---|---|---|
| `Feature` | `module` | feature name | — (top-level) |
| `Rule` | `module` | rule name | feature name |
| `Scenario` / `Scenario Outline` | `function` | scenario name | feature or `feature.rule` |
| `Background` | `function` | the keyword (`Background`) | feature or rule path |
| step | `field` | `"{keyword} {text}"` (e.g. `Given a paid invoice`) | dotted scenario path |
| `Examples:` block | `field` | `Examples: {name}` (or `Examples`) | the outline's path |

`container` is the dot-joined path of enclosing named symbols (e.g. a step under a rule scenario carries `Feature.Rule.Scenario`). Tags (`@smoke`) are dropped from symbols — they're render noise; leave them to query.

Localization works for free: keyword extraction reads the parsed keyword text, so a `# language: fr` file surfaces `Fonctionnalité` / `Scénario` / `Soit …` keywords without special handling.

Malformed `.feature` input → `extractRaw` returns `[]` (mirrors the AntlrExtractor catch-to-empty policy; agents see malformed input rather than an error).

## refs-free

This handler emits **no references**. Gherkin steps bind to step-definitions living in *other* codebases (Java/Ruby/JS) via regex or cucumber-expressions — nothing in a `.feature` corpus is name-joinable in-corpus, so there is no honest code-graph edge to emit. References are a code-graph concept; this format has none to offer.

## license

MIT.

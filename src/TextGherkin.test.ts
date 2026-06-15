import { describe, it } from "node:test";
import assert from "node:assert/strict";
import TextGherkin from "./TextGherkin.ts";

const meta = { mimetype: "text/x-gherkin", glyph: "🥒", extensions: [".feature"] as const };
const h = () => new TextGherkin(meta);

// A full .feature: Feature + Background + Scenario (with a step carrying a
// docstring) + Scenario Outline + Examples + Rule + a data table + tags.
const FULL = [
    "@feature-tag",                          // 1
    "Feature: Invoice payments",             // 2
    "  As a finance user",                   // 3
    "",                                      // 4
    "  Background: a known account",         // 5
    "    Given an account exists",           // 6
    "",                                      // 7
    "  @smoke",                              // 8
    "  Scenario: pay a paid invoice",        // 9
    "    Given a paid invoice",              // 10
    '    """',                               // 11
    "    multi-line",                        // 12
    "    doc string",                        // 13
    '    """',                               // 14
    "    When I attempt payment",            // 15
    "    Then it is rejected",               // 16
    "",                                      // 17
    "  Scenario Outline: charge variants",   // 18
    "    Given a <type> invoice",            // 19
    "    When I charge <amount>",            // 20
    "    Then balance is <result>",          // 21
    "",                                      // 22
    "    Examples: amounts",                 // 23
    "      | type | amount | result |",      // 24
    "      | A    | 10     | 0      |",       // 25
    "      | B    | 20     | -20    |",       // 26
    "",                                      // 27
    "  Rule: only admins refund",            // 28
    "    Scenario: admin refunds",           // 29
    "      Given I am admin",                // 30
    "      When I refund",                   // 31
    "      Then it succeeds",                // 32
].join("\n");

describe("TextGherkin — symbol model", () => {
    const syms = h().extractRaw(FULL);
    const by = (name: string) => syms.find((s) => s.name === name)!;

    it("Feature → module, top-level, no container, 1-indexed start", () => {
        const f = by("Invoice payments");
        assert.equal(f.kind, "module");
        assert.equal(f.line, 2);
        assert.equal(f.column, 1);
        assert.equal(f.container, undefined);
    });

    it("Rule → module, container = feature name", () => {
        const r = by("only admins refund");
        assert.equal(r.kind, "module");
        assert.equal(r.line, 28);
        assert.equal(r.container, "Invoice payments");
    });

    it("Background → function named by its keyword, container = feature", () => {
        const bg = by("Background");
        assert.equal(bg.kind, "function");
        assert.equal(bg.line, 5);
        assert.equal(bg.container, "Invoice payments");
    });

    it("Scenario → function, container = feature name", () => {
        const sc = by("pay a paid invoice");
        assert.equal(sc.kind, "function");
        assert.equal(sc.line, 9);
        assert.equal(sc.container, "Invoice payments");
    });

    it("Scenario under a Rule → container is dotted feature.rule path", () => {
        const sc = by("admin refunds");
        assert.equal(sc.kind, "function");
        assert.equal(sc.line, 29);
        assert.equal(sc.container, "Invoice payments.only admins refund");
    });

    it("steps → field, name = '{keyword} {text}', container = scenario path", () => {
        const given = by("Given a paid invoice");
        assert.equal(given.kind, "field");
        assert.equal(given.line, 10);
        assert.equal(given.container, "Invoice payments.pay a paid invoice");
        assert.equal(by("When I attempt payment").container, "Invoice payments.pay a paid invoice");
        // Background step sits under the background path.
        assert.equal(by("Given an account exists").container, "Invoice payments.Background");
        // Rule scenario step carries the full dotted path.
        assert.equal(by("Given I am admin").container, "Invoice payments.only admins refund.admin refunds");
    });

    it("Examples block → field 'Examples: {name}', container = outline path", () => {
        const ex = by("Examples: amounts");
        assert.equal(ex.kind, "field");
        assert.equal(ex.line, 23);
        assert.equal(ex.container, "Invoice payments.charge variants");
    });

    it("tags are dropped from symbols (render noise)", () => {
        assert.equal(syms.some((s) => s.name.includes("@")), false);
        assert.equal(syms.some((s) => s.name === "@smoke"), false);
    });
});

describe("TextGherkin — derived endLines", () => {
    const syms = h().extractRaw(FULL);
    const by = (name: string) => syms.find((s) => s.name === name)!;

    it("Feature endLine reaches its last descendant line", () => {
        assert.equal(by("Invoice payments").endLine, 32);
    });

    it("step with a docstring spans to the closing delimiter", () => {
        // Given on line 10; docstring opens line 11, 2 content lines, closes 14.
        assert.equal(by("Given a paid invoice").endLine, 14);
    });

    it("Examples block spans to its last table row", () => {
        assert.equal(by("Examples: amounts").endLine, 26);
    });

    it("Scenario Outline spans across its steps and examples", () => {
        assert.equal(by("charge variants").endLine, 26);
    });

    it("Rule spans across its nested scenario", () => {
        assert.equal(by("only admins refund").endLine, 32);
    });
});

describe("TextGherkin — localization", () => {
    it("French (# language: fr) surfaces native keywords", () => {
        const fr = [
            "# language: fr",
            "Fonctionnalité: Paiement",
            "  Scénario: payer une facture",
            "    Soit une facture",
            "    Quand je paie",
            "    Alors c'est payé",
        ].join("\n");
        const syms = h().extractRaw(fr);
        const feat = syms.find((s) => s.name === "Paiement")!;
        assert.equal(feat.kind, "module");
        const sc = syms.find((s) => s.name === "payer une facture")!;
        assert.equal(sc.kind, "function");
        // Step keywords come from the French dialect.
        assert.equal(syms.some((s) => s.name === "Soit une facture"), true);
        assert.equal(syms.find((s) => s.name === "Quand je paie")?.kind, "field");
        assert.equal(syms.some((s) => s.name === "Alors c'est payé"), true);
    });
});

describe("TextGherkin — error policy", () => {
    it("malformed .feature → extractRaw returns []", () => {
        const bad = "Scenario: orphan step before any feature\n  Given no feature\n@@@ broken\nFeature: late";
        assert.deepEqual(h().extractRaw(bad), []);
    });

    it("empty input → []", () => {
        assert.deepEqual(h().extractRaw(""), []);
    });
});

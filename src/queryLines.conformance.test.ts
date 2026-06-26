import { describe, it } from "node:test";
import { assertQueryLineConformance } from "@plurnk/plurnk-mimetypes/conformance";
import Handler from "./TextGherkin.ts";

const h = new Handler({"mimetype":"text/x-gherkin","glyph":"🥒","extensions":[".feature"]});

describe("#41 query-line conformance", () => {
    it("every structural match carries a source-line span", async () => {
        await assertQueryLineConformance(h, [{ source: "Feature: Login\n  Scenario: ok\n    Given a user\n    When they log in\n    Then success\n", dialect: "jsonpath", pattern: "$..*" }]);
    });
});

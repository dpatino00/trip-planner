// @vitest-environment node

import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

// @spec ACT-DATA-001, ACT-DATA-002, ACT-DATA-003, ACT-DATA-007
// @spec ACT-API-012
it("defines only the approved, clearly described Custom GPT operations", () => {
  const schema = fs.readFileSync(
    path.join(root, "docs/gpt-action-openapi.yaml"),
    "utf8",
  );
  const operations = [
    "getTripContext",
    "setTripDestination",
    "addPlace",
    "updatePlace",
    "setTripPreferences",
    "optimizeTrip",
    "applyPlanProposal",
  ];

  for (const operation of operations) {
    expect(schema).toContain(`operationId: ${operation}`);
  }
  expect(schema.match(/operationId:/g)).toHaveLength(operations.length);
  expect(schema).toMatch(/applyPlanProposal[\s\S]*explicitly accepts/i);
  expect(schema).not.toMatch(/operationId:\s*delete/i);
});

// @spec ACT-DATA-004, ACT-DATA-005, ACT-DATA-006
it("provides reproducible private-GPT instructions for trip credentials", () => {
  const instructions = fs.readFileSync(
    path.join(root, "docs/custom-gpt-instructions.md"),
    "utf8",
  );

  expect(instructions).toMatch(/request.*private trip link/i);
  expect(instructions).toMatch(/never.*repeat.*trip token/i);
  expect(instructions).toMatch(/getTripContext.*before.*mutation/i);
});

// @spec OPS-PROC-009
it("does not add an OpenAI runtime dependency to the application", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.optionalDependencies,
  };

  expect(dependencies).not.toHaveProperty("openai");
  expect(fs.readFileSync(path.join(root, ".env.example"), "utf8")).not.toMatch(
    /OPENAI_API_KEY/,
  );
});

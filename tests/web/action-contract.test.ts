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
  expect(schema).not.toContain("$ref:");
  expect(schema).not.toMatch(/^\s*allOf:/m);
  expect(schema).not.toContain("name: X-Trip-Token");
  expect(schema).not.toMatch(/tripToken/i);
  expect(schema.match(/name: placeId/g)).toHaveLength(1);
  expect(schema.match(/name: proposalId/g)).toHaveLength(1);
  expect(schema).toMatch(
    /\/api\/actions\/trip:\s+get:\s+operationId: getTripContext/,
  );

  for (const operation of operations.filter(
    (operation) => operation !== "getTripContext",
  )) {
    expect(schema).toMatch(
      new RegExp(
        `operationId: ${operation}[\\s\\S]*?requestBody:[\\s\\S]*?schema:[\\s\\S]*?type: object`,
      ),
    );
  }
});

// @spec ACT-DATA-004, ACT-DATA-005, ACT-DATA-006
it("provides reproducible private-GPT instructions for trip credentials", () => {
  const instructions = fs.readFileSync(
    path.join(root, "docs/custom-gpt-instructions.md"),
    "utf8",
  );

  expect(instructions).toMatch(/already bound.*one trip/i);
  expect(instructions).toMatch(/never request[\s\S]*private trip link/i);
  expect(instructions).toMatch(/getTripContext.*before.*mutation/i);
});

// @spec OPS-PROC-009, OPS-PROC-010
it("configures the server-only OpenAI client and optional Action client", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.optionalDependencies,
  };

  expect(dependencies).toHaveProperty("openai");
  const environment = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  expect(environment).toMatch(/OPENAI_API_KEY=\s*$/m);
  expect(environment).toMatch(/OPENAI_MODEL=\s*$/m);
  expect(environment).toMatch(/UPSTASH_REDIS_REST_URL=\s*$/m);
  expect(environment).toMatch(/TRIP_GPT_ACTION_KEY=\s*$/m);
});

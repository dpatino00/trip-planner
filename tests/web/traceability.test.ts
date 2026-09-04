// @vitest-environment node

import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const idPattern = /[A-Z]{2,4}-[A-Z]+-[0-9]{3}/g;

function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

it("traces every active requirement to tests without orphan annotations", () => {
  const specification = fs.readFileSync(
    path.join(root, "docs/specs/trip-companion-specs.md"),
    "utf8",
  );
  const activeIds = new Set(
    specification
      .split("\n")
      .filter((line) => /^- \[(?: |x)\]/.test(line))
      .flatMap((line) => line.match(idPattern) ?? []),
  );

  const testSource = [
    path.join(root, "tests/web"),
    path.join(root, "tests/e2e"),
  ]
    .flatMap(walk)
    .filter((file) => /\.(test|spec)\.(ts|tsx)$/.test(file))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");

  const annotatedIds = new Set(
    testSource
      .split("\n")
      .filter((line) => line.includes("@spec"))
      .flatMap((line) => line.match(idPattern) ?? []),
  );

  expect([...activeIds].filter((id) => !annotatedIds.has(id))).toEqual([]);
  expect([...annotatedIds].filter((id) => !activeIds.has(id))).toEqual([]);
});

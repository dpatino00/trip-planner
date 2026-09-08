import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    ".next/**",
    ".pixi/**",
    "playwright-report/**",
    "public/sw-prod.js",
    "public/sw-prod.js.map",
    "test-results/**",
  ]),
]);

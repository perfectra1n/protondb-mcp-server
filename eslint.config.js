import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "data/**", ".playwright-mcp/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Prettier owns formatting — disable any ESLint rules that would conflict.
  prettier,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      // TypeScript already resolves identifiers; no-undef just produces false
      // positives for ambient globals (process, fetch, Response, …).
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  // The manual smoke clients are plain ESM scripts, not part of the typed build.
  {
    files: ["test/**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
);

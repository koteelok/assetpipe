import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist", "**/node_modules"] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["packages/**/*.{ts,js}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["packages/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": 0,
      "@typescript-eslint/no-empty-object-type": 0,
      "@typescript-eslint/no-namespace": 0,
      "@typescript-eslint/no-unused-vars": 0,
      "no-var": 0,
    },
  },
  {
    plugins: {
      "unused-imports": unusedImports,
    },
    rules: {
      "unused-imports/no-unused-imports": "error",
    },
  },
  {
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
  eslintConfigPrettier,
);

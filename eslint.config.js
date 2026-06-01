import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js", "test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Possible errors
      "no-console": "off",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "error",

      // Best practices
      "eqeqeq": ["error", "always"],
      "no-var": "error",
      "prefer-const": "warn",
      "curly": ["error", "all"],
      "no-throw-literal": "error",
      "no-return-await": "warn",
    },
  },
  {
    // Relax rules for test files
    files: ["test/**/*.js"],
    rules: {
      "no-unused-vars": "off",
    },
  },
  // Must be last: disables all ESLint rules that conflict with Prettier
  prettier,
];

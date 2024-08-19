import globals from "globals";
import pluginJs from "@eslint/js";
import stylisticJs from "@stylistic/eslint-plugin-js";

export default [
  pluginJs.configs.recommended,
  {
    plugins: { "@stylistic/js": stylisticJs },
    rules: {
      "@stylistic/js/quotes": ["error", "double"],
      "@stylistic/js/semi": ["error", "always"],
      "@stylistic/js/no-multiple-empty-lines": ["error", { "max": 2, "maxEOF": 0 }]
    },
    languageOptions: { globals: globals.node }
  },
];

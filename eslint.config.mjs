import tailwindcss from "eslint-plugin-tailwindcss";
import tseslint from "typescript-eslint";

const recommended = tailwindcss.configs.recommended;

function tailwindConfig(files, cssConfigPath) {
  return {
    ...recommended,
    files,
    languageOptions: {
      ...recommended.languageOptions,
      parser: tseslint.parser,
    },
    settings: {
      tailwindcss: {
        cssConfigPath,
      },
    },
    rules: {
      ...recommended.rules,
      // v4.3.0 incorrectly rewrites decimal line heights to invalid utilities.
      "tailwindcss/no-unnecessary-arbitrary-value": "off",
    },
  };
}

export default [
  {
    ignores: ["**/dist/**", "**/.wxt/**", "**/node_modules/**"],
  },
  tailwindConfig(
    ["apps/web/**/*.{js,jsx,ts,tsx}"],
    "./src/styles.css",
  ),
  tailwindConfig(
    ["apps/extension/**/*.{js,jsx,ts,tsx}"],
    "./src/entrypoints/popup/style.css",
  ),
];

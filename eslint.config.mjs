import typescriptEslint from "typescript-eslint";

export default typescriptEslint.config(
    ...typescriptEslint.configs.recommended,
    {
        ignores: ["out/**", "coverage/**", "node_modules/**", "**/*.js", "**/*.mjs"]
    },
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: typescriptEslint.parser,
            ecmaVersion: 2022,
            sourceType: "module",
        },
        rules: {
            "@typescript-eslint/naming-convention": ["error", {
                selector: "import",
                format: ["camelCase", "PascalCase"],
            }],

            // Formatting Rules
            "no-multiple-empty-lines": ["error", { "max": 1 }],
            "no-trailing-spaces": "error",

            // Code Quality Rules
            "@typescript-eslint/no-unused-vars": ["error", {
                "argsIgnorePattern": "^_",
                "varsIgnorePattern": "^_",
                "caughtErrorsIgnorePattern": "^_"
            }],

            "@typescript-eslint/no-explicit-any": "error",

            // Disallow console.log/warn/error — use Logger service instead
            "no-console": "error",

            "curly": "error",
            "eqeqeq": "error",
            "no-throw-literal": "error",
            "semi": "error",
        },
    },
    // Allow console in test files
    {
        files: ["**/test/**/*.ts"],
        rules: {
            "no-console": "off",
        },
    }
);

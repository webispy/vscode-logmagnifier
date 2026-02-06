import typescriptEslint from "typescript-eslint";

export default typescriptEslint.config(
    ...typescriptEslint.configs.recommended,
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: typescriptEslint.parser,
            ecmaVersion: 2022,
            sourceType: "module",
        },
        rules: {
            "@typescript-eslint/naming-convention": ["warn", {
                selector: "import",
                format: ["camelCase", "PascalCase"],
            }],

            // Formatting Rules
            "no-multiple-empty-lines": ["warn", { "max": 1 }],
            "no-trailing-spaces": "warn",

            // Code Quality Rules
            "@typescript-eslint/no-unused-vars": ["warn", {
                "argsIgnorePattern": "^_",
                "varsIgnorePattern": "^_",
                "caughtErrorsIgnorePattern": "^_"
            }],

            "@typescript-eslint/no-explicit-any": "warn",

            "curly": "warn",
            "eqeqeq": "warn",
            "no-throw-literal": "warn",
            "semi": "warn",
        },
    }
);
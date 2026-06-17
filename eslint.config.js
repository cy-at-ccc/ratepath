export default [
  {
    ignores: [
      "**/node_modules/**",
      ".next/**",
      "apps/web/.next/**",
      "dist/**",
      "build/**",
      "out/**"
    ]
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        console: "readonly",
        process: "readonly",
        module: "readonly",
        require: "readonly",
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        globalThis: "readonly",
        window: "readonly",
        self: "readonly",
        document: "readonly",
        ResizeObserver: "readonly",
        URL: "readonly",
        Worker: "readonly"
      }
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "error",
      "eqeqeq": "error",
      "curly": "off"
    }
  }
];

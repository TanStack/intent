# TanStack Template Guide

This template provides a complete TanStack library setup. Follow these steps to create a new library:

## Search and Replace

Replace the following strings throughout the codebase:

| Find       | Replace With        | Example                                          |
| ---------- | ------------------- | ------------------------------------------------ |
| `template` | `your-library-name` | @tanstack/template → @tanstack/your-library-name |
| `Template` | `YourLibraryName`   | class Template → class YourLibraryName           |
| `TEMPLATE` | `YOUR_LIBRARY_NAME` | TEMPLATE_VAR → YOUR_LIBRARY_NAME_VAR             |

## Files to Update

### 1. Root package.json

- Update repository URL
- Update homepage URL
- Update description
- Update overrides section with your package names

### 2. Package package.json files

- Update name, description, keywords
- Update repository directory paths

### 3. Documentation

- Update docs/overview.md with your library's purpose
- Update docs/quick-start.md with real usage examples
- Add guides for your library's features
- Update config.json with your DocSearch credentials

### 4. GitHub Configuration

- Update .github/ISSUE_TEMPLATE/bug_report.yml
- Update workflow files if needed
- Update FUNDING.yml with your sponsor links

### 5. Source Code

- Replace placeholder console.log code with your library's implementation
- Update types in src/types.ts
- Write real tests
- Add framework-specific implementations

### 6. Examples

- Update example apps to demonstrate your library
- Add more examples as needed

### 7. README.md

- Write comprehensive README describing your library
- Add badges, installation instructions, usage examples

## Package Structure

```
template/
├── packages/
│   ├── template/                    # Core library (framework-agnostic)
│   ├── react-template/              # React adapter
│   ├── solid-template/              # Solid adapter
│   ├── template-devtools/           # Base devtools
│   ├── react-template-devtools/     # React devtools
│   └── solid-template-devtools/     # Solid devtools
├── examples/                         # Example applications
├── docs/                            # Documentation
├── scripts/                         # Build and doc scripts
└── .github/                         # CI/CD workflows
```

## Adding More Framework Adapters

To add a new framework (e.g., Vue):

1. Create `packages/vue-template/` directory
2. Copy structure from `packages/react-template/`
3. Update package.json with vue-specific dependencies
4. Implement Vue-specific primitives
5. Add example in `examples/vue/`
6. Update docs with `framework/vue/adapter.md`
7. Update root package.json overrides
8. Update vitest.workspace.js
9. Update scripts/generate-docs.ts

## Development Workflow

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build:all

# Run tests
pnpm test:lib

# Run linting
pnpm test:eslint

# Format code
pnpm format

# Generate documentation
pnpm generate-docs

# Watch mode for development
pnpm watch
```

## Release Process

1. Make changes
2. Run `pnpm changeset` to create a changeset
3. Commit and push
4. Create PR
5. Merge PR
6. GitHub Actions will automatically version and publish

## Questions?

- See CONTRIBUTING.md for contribution guidelines
- Check existing TanStack libraries for patterns
- Refer to pacer source for complete examples

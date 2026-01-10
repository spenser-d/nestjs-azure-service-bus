# Contributing to NestJS Azure Service Bus

Thank you for your interest in contributing to the NestJS Azure Service Bus transporter! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md). We are committed to providing a welcoming and inclusive experience for everyone.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
3. **Add the upstream remote**: `git remote add upstream https://github.com/[org]/nestjs-azure-service-bus.git`
4. **Create a branch** for your changes: `git checkout -b feature/my-feature`

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- Git

### Installation

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/nestjs-azure-service-bus.git
cd nestjs-azure-service-bus

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

### Useful Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run clean` | Remove compiled output |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:cov` | Run tests with coverage report |
| `npm run lint` | Check code for linting errors |
| `npm run format` | Format code with Prettier |

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-batch-processing` - New features
- `fix/connection-timeout` - Bug fixes
- `docs/update-readme` - Documentation updates
- `refactor/improve-error-handling` - Code refactoring
- `test/add-health-tests` - Test additions

### Code Requirements

Before submitting a pull request, ensure:

1. **All tests pass**: Run `npm test`
2. **Linting passes**: Run `npm run lint`
3. **Code is formatted**: Run `npm run format`
4. **Build succeeds**: Run `npm run build`
5. **Coverage meets threshold**: Run `npm run test:cov`

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `style` | Code style changes (formatting, etc.) |
| `refactor` | Code refactoring |
| `test` | Adding or updating tests |
| `chore` | Maintenance tasks |
| `perf` | Performance improvements |

### Scope

Use the relevant module name:
- `client` - Client-related changes
- `server` - Server-related changes
- `admin` - Admin service changes
- `health` - Health check changes
- `observability` - Metrics/tracing changes
- `errors` - Error handling changes
- `deps` - Dependency updates

### Examples

```
feat(client): add batch message publishing

fix(server): prevent message loss during shutdown

docs: update installation instructions

test(health): add health indicator tests

chore(deps): update @azure/service-bus to 7.10.0
```

### Subject Guidelines

- Use imperative, present tense ("add" not "added")
- Don't capitalize the first letter
- No period at the end
- Keep it under 72 characters

## Pull Request Process

1. **Update your fork** with the latest upstream changes:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Push your branch** to your fork:
   ```bash
   git push origin feature/my-feature
   ```

3. **Create a Pull Request** from your fork to the main repository

4. **Fill out the PR template** completely

5. **Wait for review** - maintainers will review your PR and may request changes

6. **Address feedback** - make any requested changes and push updates

7. **Merge** - once approved, a maintainer will merge your PR

### PR Requirements

- PRs should focus on a single change
- Include tests for new functionality
- Update documentation if needed
- Ensure all CI checks pass
- Keep commits clean and atomic

## Code Style

### TypeScript Guidelines

- Use strict TypeScript (`strict: true`)
- Prefer `const` over `let` when possible
- Use explicit return types for public methods
- Document public APIs with JSDoc

### Naming Conventions

| Item | Convention | Example |
|------|------------|---------|
| Files | kebab-case | `service-bus.client.ts` |
| Classes | PascalCase | `ServiceBusClientProxy` |
| Interfaces | PascalCase | `ServiceBusOptions` |
| Functions | camelCase | `createSender` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_TIMEOUT` |

### File Organization

```
src/
├── client/          # Client-side code
├── server/          # Server-side code
├── decorators/      # Custom decorators
├── errors/          # Error classes
├── health/          # Health checks
├── interfaces/      # TypeScript interfaces
├── observability/   # Metrics and tracing
├── serializers/     # Message serialization
├── utils/           # Utility functions
└── constants.ts     # Shared constants
```

## Testing

### Test Requirements

- All new features must have tests
- Bug fixes should include regression tests
- Maintain or improve code coverage

### Test Structure

```typescript
describe('ClassName', () => {
  describe('methodName', () => {
    it('should do something specific', () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- --testPathPattern="client"

# Run with coverage
npm run test:cov

# Watch mode
npm run test:watch
```

## Documentation

### JSDoc Comments

Document all public APIs:

```typescript
/**
 * Sends a message to the specified topic
 *
 * @param pattern - The message pattern
 * @param data - The message payload
 * @returns Observable that completes when message is sent
 *
 * @example
 * ```typescript
 * client.emit('order.created', { orderId: '123' });
 * ```
 */
emit<TResult = any>(pattern: any, data: any): Observable<TResult>
```

### README Updates

If your change affects the public API or adds new features:
1. Update the README with usage examples
2. Add any new configuration options
3. Update the feature list if applicable

## Questions?

If you have questions about contributing, please:
1. Check existing [issues](https://github.com/[org]/nestjs-azure-service-bus/issues)
2. Open a new issue with the `question` label
3. Join the discussion in existing PRs

Thank you for contributing!

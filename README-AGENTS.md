# Claude Code Agents for Jotmint RatePath

These files are designed for Claude Code project-level subagents.

## Installation

Copy the following into the root of the mortgage app repository:

```text
CLAUDE.md
.claude/
  agents/
    mortgage-algorithm-architect.md
    mortgage-code-implementer.md
    mortgage-code-reviewer.md
    mortgage-ui-designer.md
```

Restart Claude Code after manually adding or changing agent files. Alternatively, manage them using `/agents`.

## Why `model: inherit`

All four agents inherit the model used by the current Claude Code session. This avoids forcing a native Anthropic model when the project is routed through another supported model configuration.

When using native Claude models, you may change:

```yaml
model: inherit
```

to:

```yaml
model: opus
```

for the algorithm architect or reviewer, and:

```yaml
model: sonnet
```

for implementation and UI work.

## Recommended workflow

### 1. Algorithm design

```text
Use the mortgage-algorithm-architect agent.

Analyse the requested change. Produce an implementation-ready specification,
hard constraints, formulas, Pareto objectives, edge cases, and golden tests.
Do not modify code.
```

### 2. Implementation

```text
Use the mortgage-code-implementer agent.

Implement the approved algorithm specification below. Add tests and run
checkJs, lint, tests, and the relevant build. Do not modify UI unless the
spec explicitly requires a domain API adjustment.
```

### 3. Review

```text
Use the mortgage-code-reviewer agent.

Review the algorithm specification, diff, and tests. Focus on financial
correctness, target payment semantics, offset, extra-payment frequency,
Pareto correctness, deterministic results, privacy, and regressions.
Do not edit code.
```

### 4. UI design and implementation

```text
Use the mortgage-ui-designer agent.

Implement the approved dark fintech UI using existing engine outputs.
Add the Strategy Lab controls, result cards, and Pareto trade-off chart.
Do not reproduce financial formulas or ranking in components.
```

### 5. Final review

Run the reviewer again after UI changes.

## Recommended order for the current project

1. Correct Offset calculation.
2. Correct `targetMode: "payment"` and explicit payment policies.
3. Correct extra repayment date/frequency scheduling.
4. Separate simulation cache from ranking.
5. Centralise metrics, normalisation, Pareto, ranking, and explanations.
6. Add safe strategy-generation pruning.
7. Add Pareto visualisation.
8. Benchmark before adding worker pools.
9. Defer stochastic and evolutionary optimisation.

## Concurrency rule

Do not run `mortgage-code-implementer` and `mortgage-ui-designer` simultaneously if they may touch the same files.

The algorithm architect and reviewer are read-only and can safely run without source edits.

# ConstraintLab

ConstraintLab is a browser-based, agent-native workspace for factory job-shop scheduling. Humans and WebMCP agents mutate one canonical Zustand model through the same validated domain actions; a real HiGHS MILP solver running in a Web Worker computes every schedule.

## Run locally

```bash
npm install
npm run dev
```

Use `npm test` for the domain, solver, infeasibility, WebMCP, and two-pass demo verification suite. Use `npm run build` to create the static `dist/` deployment.

## Demo sequence

1. Add a Machine 2 downtime constraint from 1:00–3:00 PM and a Job 7 deadline at noon, then solve. The MILP remains optimal and Job 7 finishes by noon.
2. Add a Machine 2 assignment and 12:30 PM deadline for Job 4, then solve. HiGHS proves the model infeasible; the typed rule checker reports that the 240-minute job cannot fit in Machine 2's 210-minute pre-deadline window.

The WebMCP surface registers exactly nine tools on `document.modelContext`: `get_problem_state`, `add_job`, `update_job`, `add_constraint`, `remove_constraint`, `set_objective`, `solve_problem`, `get_solution`, and `analyze_infeasibility`. `@mcp-b/global` supplies the fallback when the native API is absent.

## Architecture

```text
React UI ──┐
           ├── canonical domain actions ── Zustand state ── audit history
WebMCP  ───┘                         │
                                    └── LP compiler → HiGHS worker → onSolverResult
```

The solver receives an immutable model snapshot. Worker results return through `onSolverResult`; worker code never mutates application state. Structural mutations increment `modelVersion`, and stale solved versions are rejected until the model is solved again.

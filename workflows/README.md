# Workflows

Markdown SOPs that define automation processes for the WAT framework.

Each workflow file (`*.md`) should specify:

- **Goal** — what this workflow accomplishes
- **Inputs** — required parameters / preconditions
- **Tool sequence** — ordered list of tools in `../tools/` to invoke
- **Outputs** — expected results / artifacts
- **Edge cases** — known failure modes and how to handle them

Workflows are read by the Agent first; tools are then executed in the specified order.

# Marmaide

Draw a diagram for the user when a picture explains better than words:
`pumi call <owner>.marmaide.draw 'flowchart LR
  a[ask] --> b[answer]'` opens a pane beside you and answers its id; `pane=%N` redraws that one
(`local.marmaide.draw` while the package is linked from disk, `amresyd.marmaide.draw` installed).
Any Mermaid works (flowchart, sequenceDiagram, stateDiagram-v2, erDiagram, classDiagram, gantt…).
The user can click a node and ask you about it: it arrives in `<pumi-attached>` with the source.
More: AGENTS.md in this package.

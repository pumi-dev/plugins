# Marmaide

Draw a diagram for the user when a picture explains better than words:
`pumi call <owner>.marmaide.draw 'flowchart LR
  a[ask] --> b[answer]'` opens a tab beside you and answers its id; `pane=%N` redraws that one
(`amresyd.marmaide.draw` while the package is linked from a checkout, `pumi_dev.marmaide.draw`
installed from GitHub).
Any Mermaid works (flowchart, sequenceDiagram, stateDiagram-v2, erDiagram, classDiagram, gantt…).
The user can click a node and ask you about it: it arrives in `<pumi-attached>` with the source.
More: AGENTS.md in this package.

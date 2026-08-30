# Architecture Decision Records

Each record captures one decision, the constraints that forced it, and what it
cost. Decisions derived from failure keep the failure in the record — the
reasoning that turned out wrong is usually more instructive than the reasoning
that held.

| ADR | Decision | Status |
|---|---|---|
| [001](001-client-side-trust-boundary.md) | The server receives structure, never content | Accepted |
| [002](002-checksum-verified-identifiers.md) | Verify structured identifiers by checksum | Accepted |
| [003](003-fail-closed.md) | Every failure path redacts rather than leaks | Accepted |
| [004](004-three-corpus-evaluation.md) | Evaluate on three corpora that disagree | Accepted |
| [005](005-small-vision-model.md) | A 227 KB detector over a 2B-parameter model | Accepted |
| [006](006-context-requirements.md) | Ambiguous patterns require corroborating context | Accepted |
| [007](007-block-ancestor-grouping.md) | Group text by block ancestor before scanning | Accepted |
| [008](008-bundle-content-script.md) | Bundle the content script to a classic IIFE | Accepted |
| [009](009-neural-tagger-not-shipped.md) | Build the neural tagger, do not ship it yet | Accepted |

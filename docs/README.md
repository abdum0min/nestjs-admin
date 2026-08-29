# Documentation

| Document                                 | Contents                                              |
| ---------------------------------------- | ----------------------------------------------------- |
| [status.md](status.md)                   | Exactly what is implemented and what is not           |
| [architecture.md](architecture.md)       | Components, dependency direction, open decisions      |
| [mvp-scope.md](mvp-scope.md)             | The frozen MVP definition and its acceptance test     |
| [publishing.md](publishing.md)           | Single-public-package strategy; nothing published yet |
| [prisma-metadata.md](prisma-metadata.md) | Decision: how Prisma model metadata is obtained       |

Phase reports with full experimental evidence live in [../reports/](../reports/):

| Report                                                                    | Contents                                                             |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [002-prisma-metadata-spike.md](../reports/002-prisma-metadata-spike.md)   | How Prisma model metadata is obtained, and the rejected alternatives |
| [003-prisma-adapter.md](../reports/003-prisma-adapter.md)                 | The Prisma adapter and generic CRUD                                  |
| [004-http-api.md](../reports/004-http-api.md)                             | The generic admin HTTP API                                           |
| [005-authentication.md](../reports/005-authentication.md)                 | The authentication boundary and 401/403 semantics                    |
| [006-resource-authorization.md](../reports/006-resource-authorization.md) | Per-model authorization and metadata filtering                       |
| [007-admin-ui.md](../reports/007-admin-ui.md)                             | Publishing fix and the metadata-driven admin UI                      |

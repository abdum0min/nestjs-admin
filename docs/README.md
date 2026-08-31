# Documentation

## Using it

| Document                                 | Contents                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| [getting-started.md](getting-started.md) | From an existing NestJS application to a working admin                   |
| [configuration.md](configuration.md)     | Every option, in one place                                               |
| [adapters.md](adapters.md)               | The `OrmAdapter` contract, the two shipped adapters, and writing a third |

## Understanding it

| Document                                 | Contents                                                             |
| ---------------------------------------- | -------------------------------------------------------------------- |
| [architecture.md](architecture.md)       | Components, dependency direction, and the rules that hold them apart |
| [project-state.md](project-state.md)     | An honest assessment: what exists, what does not, the open risks     |
| [status.md](status.md)                   | The implemented/not-implemented list                                 |
| [roadmap.md](roadmap.md)                 | What is planned, in what order, and why in that order                |
| [publishing.md](publishing.md)           | Why one package is published, and how the others get into it         |
| [prisma-metadata.md](prisma-metadata.md) | How Prisma model metadata is obtained, and the rejected alternatives |
| [mvp-scope.md](mvp-scope.md)             | Historical: the frozen 0.1-0.7 scope                                 |

## Release reports

One per release, in [../reports/](../reports/): what was built, what it cost,
what broke, and what was deliberately left out. They are written as evidence
rather than as announcements - every measurement in them was taken, and every
defect found along the way is recorded whether or not it was flattering.

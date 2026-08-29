# @nest-admin/cli

Internal package — bundled into the single public package, where it will be
exposed as the `nest-admin` executable.

**Nothing is implemented yet**, and no `bin` entry is declared: an executable
that does nothing is worse than no executable.

## Planned

```bash
npx nest-admin init      # detect project, write config, print wiring snippet
npx nest-admin doctor    # explain why detection failed
npx nest-admin generate  # scaffold customisations
```

`init` will need to answer:

- Is this a NestJS project? (dependency graph in `package.json`)
- Is Prisma installed, and at which version?
- Where is `schema.prisma`?
- Where is the generated Prisma Client?

## Argument parsing

`node:util` `parseArgs`, built into Node >= 20. No CLI framework dependency —
the command surface is small and the code is bundled into the published
package, where every kilobyte is the consumer's.

## Rule

The CLI writes to the consumer's project. Every write must be idempotent,
previewable and non-destructive: never rewrite `app.module.ts` silently,
print a snippet the developer pastes instead.

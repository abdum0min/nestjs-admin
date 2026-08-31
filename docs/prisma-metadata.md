# Decision: how Prisma model metadata is obtained

**Status: decided.** Full evidence, experiments and rejected alternatives are in
a spike run against Prisma 7.
This page is the summary; the report is the authority.

> This document previously recorded a preliminary Phase 0 investigation that
> recommended `@prisma/internals`. **That recommendation is superseded** — the
> Phase 1 spike found an identical-output package at 1/19th the size.

## The problem

Prisma 7 does not expose enough model metadata at runtime to drive an admin
panel. The structure embedded in the generated client carries only `name`,
`kind` and `type` per field. It cannot tell you which field is the primary key,
whether a field is required, whether it is unique, or even whether it is a list
— so relation cardinality is unrecoverable too. There is no runtime `DMMF` in
Prisma 7, from either the modern or the legacy generator.

## The decision

**MVP: `@prisma/get-dmmf`**, called from exactly one module in
`packages/prisma`.

- Returns complete metadata — verified byte-identical to `@prisma/internals`.
- 3.9 MB installed, versus 73 MB for `@prisma/internals`.
- The only route to DMMF that Prisma does not flag "internal use, no SemVer";
  its README names "creating custom tools" as an intended use.
- Costs ~70 ms once at startup.

**Long-term: a custom Prisma generator** that emits metadata during
`prisma generate`. It uses the consumer's own Prisma version, needs no runtime
dependency, and does not require `schema.prisma` in production. It is not the
MVP choice because generator provider resolution by package name failed on the
Windows environment used for the spike — only an absolute path worked, which
cannot be committed to a shared schema.

## Why the migration is cheap

Both approaches produce the same `DMMF.Document`. Only _acquisition_ differs:

```text
  getDmmfViaGetDmmf()        getDmmfFromGeneratedFile()
  [MVP]                      [long-term]
           \                /
        same DMMF.Document shape
                  |
        toModelMetadata(dmmf)     <- written once, never rewritten
                  |
           ModelMetadata[]        <- Core contract
```

## Rules this places on the codebase

1. `@prisma/get-dmmf` may be imported by **exactly one module** in
   `packages/prisma`. Nothing else, ever. That confinement is what makes the
   generator migration a one-file change.
2. Core gains nothing from this decision — no dependency, no Prisma knowledge,
   no contract change. `OrmAdapter.getModels()` already covers it.
3. `getDMMF` **resolves with an error object** (`{ type, reason, error }`)
   instead of throwing. Check for `datamodel` and re-throw a `NestAdminError`
   carrying the Prisma `P1012` text. Never return empty metadata — an admin with
   no resources reads as a configuration mistake and costs users hours.
4. Declare a supported Prisma version range and enforce it at startup. The
   pinned parser rejects valid schemas from other Prisma majors; this was
   demonstrated with a Prisma 6 schema.

## Related consequence

Prisma 7 constructs clients from driver adapters, so the Nest Admin Prisma
adapter must **accept** an already-constructed `PrismaClient` and never build
one. It cannot know the driver adapter, credentials or connection strategy.

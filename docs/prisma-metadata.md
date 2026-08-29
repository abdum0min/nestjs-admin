# Risk: reading model metadata from Prisma 7

This is the single largest technical risk to the MVP. It was investigated
during setup against a real generated client
(`examples/basic`, Prisma 7.10.0, `prisma-client` generator) and the findings
are recorded here so the implementation phase does not rediscover them.

**Nothing here is implemented.** These are options, not a decision.

## What the MVP needs per field

To render a table and a form generically, the admin needs at minimum:
which field is the primary key, whether a field is required, unique, a list,
generated (`@default`, `@updatedAt`), its type, its enum values, and its
relations.

## What Prisma 7 actually exposes

### `runtimeDataModel` - present but private and lossy

The generated client embeds a `runtimeDataModel` in
`internal/class.ts`. For the example schema it contains:

```json
{
  "models": {
    "User": {
      "fields": [
        { "name": "id", "kind": "scalar", "type": "String" },
        { "name": "email", "kind": "scalar", "type": "String" }
      ]
    }
  }
}
```

Two problems:

1. **It is not exported.** It lives on a module-private `config` object,
   reachable only as `(client as any)._runtimeDataModel`.
2. **It is lossy.** Only `name`, `kind` and `type`. No `isId`, `isRequired`,
   `isUnique`, `isList`, `hasDefaultValue`, no relation information. Note that
   `id` above is indistinguishable from `email` - the primary key cannot be
   determined from it at all.

On its own this is **not sufficient** for the MVP.

### `DMMF` - type-only in the new generator

`internal/prismaNamespace.ts` has `export type DMMF = typeof runtime.DMMF`.
It is a **type**, not a runtime value. The full DMMF is not re-exported by the
`prisma-client` generator.

### `inlineSchema` - the full schema text is embedded

The same private `config` object carries `inlineSchema`: the complete verbatim
text of `schema.prisma`. So the information exists at runtime; it is just not
parsed.

### `@prisma/internals` - has `getDMMF()`, but is not installed

It exposes the full DMMF with every field attribute, but it is **not** a
transitive dependency of `prisma` 7 (verified: `MODULE_NOT_FOUND`). It is also
explicitly an internal package with no stability guarantee.

## Options

| Option                                                                      | Gets full metadata?                      | Cost                                                                        |
| --------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| A. `_runtimeDataModel` only                                                 | **No** - cannot identify the primary key | trivial, but insufficient                                                   |
| B. `@prisma/internals.getDMMF()` on the schema file                         | Yes                                      | extra dependency, explicitly unstable API, needs `schema.prisma` at runtime |
| C. Parse `inlineSchema` ourselves                                           | Yes                                      | we own a Prisma DSL parser forever                                          |
| D. Generate metadata at build time via a custom Prisma generator            | Yes                                      | a real generator to maintain; metadata is a build artefact, always in sync  |
| E. `_runtimeDataModel` + developer-supplied hints in `nest-admin.config.ts` | Partially                                | pushes work onto the developer, against the product premise                 |

## Recommendation for the implementation phase

Start with **B** to get the MVP moving, behind a single narrow function in
`packages/prisma` - something like `readPrismaMetadata(): ModelMetadata[]` -
with an explicit supported Prisma version range and a loud, specific failure
when the shape is not what was expected. Never silently return empty metadata:
an admin panel with no resources looks like a configuration mistake and will
cost users hours.

Treat **D** as the likely destination. A metadata generator sidesteps every
private-API concern, survives Prisma major versions, and matches how Prisma
itself expects extension. It is more work than the MVP justifies today.

Whichever is chosen, it lives entirely behind `OrmAdapter`. Core, the HTTP
layer and the admin UI are unaffected by the decision, which is the whole
point of the seam.

## Related: client construction changed too

Prisma 7 removed `url` from the schema `datasource` block. The URL moves to
`prisma.config.ts`, and the runtime client is built from a **driver adapter**
(`new PrismaClient({ adapter: new PrismaBetterSQLite3(...) })`).

Consequence for us: the Nest Admin Prisma adapter must **accept an
already-constructed `PrismaClient`** from the consuming application and must
never try to construct one itself. It cannot know the driver adapter, the
credentials, or the connection strategy. `examples/basic` is configured this
way.

Second consequence: the word "adapter" now means two unrelated things - a
Prisma _driver_ adapter and a Nest Admin _ORM_ adapter. Pick different naming
in the public API.

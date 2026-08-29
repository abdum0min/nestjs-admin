# Prisma Metadata Spike

Phase 1 technical spike. Status: **complete, decision made.**
No production code was written. No CRUD, adapter, API or CLI logic was implemented.

---

## 1. Executive Summary

The question: **what is the most reliable way for Nest Admin to obtain complete
Prisma model metadata for its generic CRUD engine?**

Five approaches were investigated against the Prisma version actually installed
in this repository, using a schema that deliberately exercises every attribute
the admin will need. Every claim below is backed by an experiment that was run,
not by documentation.

**Findings that decided the outcome:**

1. The metadata embedded in the generated Prisma Client (`runtimeDataModel`) is
   private **and** insufficient. It cannot identify a primary key, whether a
   field is required, unique, or even whether a field is a list. Approach A is
   dead on completeness, not merely on stability.
2. There is **no runtime DMMF in Prisma 7** — not from the `prisma-client`
   generator, and not from the legacy `prisma-client-js` generator either. Both
   embed the identical lossy structure.
3. `@prisma/internals` does work, but costs **73 MB** installed (it pulls
   `effect` at 31 MB). Unacceptable as a dependency of a published package.
4. **`@prisma/get-dmmf` returns byte-identical DMMF for 3.9 MB.** It is also the
   only candidate package that does _not_ carry Prisma's "internal use, no
   SemVer" warning.
5. A custom Prisma generator receives the complete DMMF — proven end-to-end by
   running one. But generator provider resolution by package name **failed on
   this Windows environment**, and that is unresolved.

**Decision:**

- **MVP:** `@prisma/get-dmmf`, isolated behind a single narrow function in
  `packages/prisma`.
- **Long-term:** a custom Prisma generator, once cross-platform provider
  resolution is validated.
- **Migration cost is low by construction:** both approaches produce the same
  DMMF shape, so only metadata _acquisition_ differs. The DMMF → `ModelMetadata`
  mapper is written once and is shared.

**Rejected:** `@prisma/internals` (size), runtime client introspection
(insufficient data), hand-written schema parsing (unjustifiable).

---

## 2. Environment

All experiments were run on the machine and repository state below.

| Component                  | Version                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| OS                         | Windows 11 (10.0.26200), Git Bash shell                            |
| Node.js                    | v24.13.0                                                           |
| pnpm                       | 10.33.0                                                            |
| `prisma` (CLI)             | 7.10.0                                                             |
| `@prisma/client`           | 7.10.0                                                             |
| `@prisma/internals`        | 7.10.0 (installed in isolation for the spike only)                 |
| `@prisma/get-dmmf`         | 7.10.0 (installed in isolation for the spike only)                 |
| `@prisma/generator-helper` | 7.10.0 (installed in isolation for the spike only)                 |
| Generator under test       | `prisma-client` (Prisma 7 default) and `prisma-client-js` (legacy) |

**Operating assumptions**

- Spike dependencies were installed with `npm` into throwaway directories so the
  workspace `pnpm-lock.yaml` was never modified. All of it has been deleted.
- The consuming application owns and constructs its own `PrismaClient`. Nest
  Admin never constructs one. (Confirmed still correct — see §4.6.)
- Conclusions are pinned to Prisma **7.10.0**. Prisma 8 is already in RC and is
  explicitly out of scope for this spike.
- The Windows-specific generator finding in §4.4 was observed on **one platform
  only** and has not been cross-checked on Linux or macOS.

### Test schema

Chosen to force every attribute of interest to appear: an `@id` with a function
default, a `@unique`, a required scalar, an optional scalar, a boolean with a
literal default, an optional `Int`, an enum with a default, a `now()` default, an
`@updatedAt`, a one-to-many relation in both directions, a `@@map`, and a
composite `@@unique`.

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String
  bio       String?
  active    Boolean  @default(true)
  age       Int?
  role      Role     @default(USER)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  posts     Post[]

  @@map("users")
}

model Post {
  id       String @id @default(cuid())
  title    String
  slug     String @unique
  authorId String
  author   User   @relation(fields: [authorId], references: [id])

  @@unique([authorId, title])
}

enum Role {
  USER
  ADMIN
}
```

---

## 3. Problem

The admin UI renders tables and forms **generically**. To do that for an
arbitrary model it must know, per field: the type, whether it is required,
whether it is the primary key, whether it is unique, whether it is a list,
whether it has a default (and therefore should not be asked for on create),
its enum values if any, and how it relates to other models.

Prisma declares all of this in `schema.prisma`. The difficulty is that Prisma 7
does not hand it back to you at runtime.

Historically (Prisma 5 and earlier) `Prisma.dmmf.datamodel` was available from
the generated client and carried the full field attributes. That is gone. What
remains in the generated client is a reduced structure intended for the query
engine's own use, which preserves only what the query engine needs — and the
query engine does not need to know what a primary key is, because the schema
already told it.

The result is that the single most important piece of information for an admin
panel — _which field identifies this record_ — is exactly the piece that is no
longer exposed.

---

## 4. Experiments

### 4.1 Approach A — Prisma Client runtime metadata

**What was tested.** Generated a client from the test schema with the Prisma 7
default `prisma-client` generator, then extracted the `runtimeDataModel`
embedded in `internal/class.ts` and decoded it.

**What was accessible.** The structure exists, but it is assigned to a
module-private `config` object. It is not exported. Reaching it from application
code means `(client as any)._runtimeDataModel` — an underscore-prefixed internal.

**What metadata was available.** Verbatim, for every field:

```json
{ "name": "id", "kind": "scalar", "type": "String" }
```

Per model: `name`, `dbName` (so `@@map` survives), and a `fields` array whose
entries carry only `name`, `kind` (`scalar` | `enum` | `object`), `type`, and
`relationName` on relation fields.

**What was missing.** Everything that matters:

- `isId` — **absent.** `id` and `email` are byte-for-byte indistinguishable.
- `isRequired` — **absent.** `bio String?` is identical to `name String`.
- `isList` — **absent.** This is the sharpest failure: `posts Post[]` and
  `author User` differ only in the `type` string. Relation cardinality cannot be
  recovered, so the adapter could not tell a to-one from a to-many.
- `isUnique`, `hasDefaultValue`, `default`, `isUpdatedAt` — all absent.
- Enum **values** — absent. The top-level `"enums"` map was `{}` even though the
  schema defines `Role` and a field reports `"kind": "enum"`.

**One redeeming detail.** Enum values _are_ available, just not from there: the
generator emits `enums.ts` containing `export const Role = { USER: 'USER',
ADMIN: 'ADMIN' } as const`, and that file is explicitly marked
"🟢 You can import this file directly." So enum values are publicly obtainable.
Nothing else on the missing list is.

**A note on the TypeScript types.** The generated `$UserPayload` type does encode
nullability and list-ness correctly (`bio: string | null`, `posts: $PostPayload[]`).
That information is erased at runtime and is useless for introspection. It would
only be reachable by type-level analysis at build time, which is a far more
fragile version of Approach D.

**Result: REJECTED.** Not on stability grounds — on completeness. Even if we
accepted the private-API risk, the data required to render an admin panel is not
present.

---

### 4.2 Approach B — Prisma DMMF at runtime

**What was tested.** Whether any runtime `dmmf` value is reachable, from either
generator.

- Searched the `prisma-client` output. `internal/prismaNamespace.ts` contains
  `export type DMMF = typeof runtime.DMMF` — a **type**, not a value. No runtime
  `dmmf` export exists anywhere in the generated code.
- Regenerated the same schema with the legacy **`prisma-client-js`** generator to
  check whether the old behaviour survived. It still generates under Prisma 7.
  Grepping the emitted JavaScript for `isId`, `isRequired` and `isUnique`
  returned **zero matches in every file**. It embeds the _same_ reduced
  `runtimeDataModel` as the modern generator.

**API stability.** Not applicable — there is no API to assess.

**Result: REJECTED.** There is no runtime DMMF in Prisma 7. Switching generators
does not bring it back. Any tutorial or library relying on `Prisma.dmmf` is
describing Prisma 5 or earlier.

---

### 4.3 Approach C — `@prisma/internals` and `@prisma/get-dmmf`

**What was tested.** Installed `@prisma/internals@7.10.0` in isolation, called
`getDMMF({ datamodel })` on the raw schema text, and dumped the result.

**Result: complete metadata.** Actual output for `User`:

```
id         scalar  String    id=Y req=Y uniq=.  list=.  updAt=.  def={"name":"cuid","args":[1]}
email      scalar  String    id=.  req=Y uniq=Y list=.  updAt=.  def=.
name       scalar  String    id=.  req=Y uniq=.  list=.  updAt=.  def=.
bio        scalar  String    id=.  req=.  uniq=.  list=.  updAt=.  def=.
active     scalar  Boolean   id=.  req=Y uniq=.  list=.  updAt=.  def=true
age        scalar  Int       id=.  req=.  uniq=.  list=.  updAt=.  def=.
role       enum    Role      id=.  req=Y uniq=.  list=.  updAt=.  def="USER"
createdAt  scalar  DateTime  id=.  req=Y uniq=.  list=.  updAt=.  def={"name":"now","args":[]}
updatedAt  scalar  DateTime  id=.  req=Y uniq=.  list=.  updAt=Y  def=.
posts      object  Post      id=.  req=Y uniq=.  list=Y  updAt=.  def=.  rel=PostToUser from=[] to=[]
```

Plus, at model level: `dbName: "users"` (the `@@map`), `uniqueIndexes:
[{ name: null, fields: ["authorId","title"] }]` (the composite `@@unique`),
`primaryKey: null` (populated for `@@id`), and enums with their values:
`Role(USER|ADMIN)`.

Every single attribute the CRUD engine needs is present.

**Dependency implications — and the discovery that changed the recommendation.**

`@prisma/internals` costs **73 MB installed / 32 top-level packages**:

| Contributor  | Size   |
| ------------ | ------ |
| `@prisma/*`  | 35 MB  |
| `effect`     | 31 MB  |
| `fast-check` | 2.9 MB |
| `jiti`       | 1.7 MB |

Shipping that inside an admin framework is indefensible. But its dependency list
exposed a much narrower package: **`@prisma/get-dmmf`**.

Installed in isolation, `@prisma/get-dmmf@7.10.0` is **3.9 MB across 6
packages** (`@prisma/*`, `@streamparser/json`, `pluralize`) and exports the same
`getDMMF`. Running the identical probe through it and diffing the serialised
output against the `@prisma/internals` result:

```
IDENTICAL
```

Same data, **1/19th the footprint.**

**Cost at startup.** `require('@prisma/get-dmmf')` = 28.8 ms; `getDMMF()` on the
test schema = 40.5 ms. ~70 ms once at boot, never per request. Acceptable.

**Stability posture.** This is where the packages differ sharply. READMEs:

| Package                    | Stability statement                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@prisma/generator-helper` | ⚠️ "intended for Prisma's internal use… does not follow SemVer… breaking changes without any prior warning"                                                            |
| `@prisma/dmmf`             | ⚠️ same internal-use warning                                                                                                                                           |
| `@prisma/generator`        | ⚠️ same internal-use warning                                                                                                                                           |
| **`@prisma/get-dmmf`**     | **No warning.** "The DMMF is a JSON representation of the Prisma schema, which can be used for various purposes such as generating code or **creating custom tools**." |

`@prisma/get-dmmf` is the only route to DMMF that Prisma does not explicitly flag
as internal, and its README names our exact use case.

**Two traps found, both real.**

_Trap 1 — it does not throw._ On failure `getDMMF` **resolves** with an error
object rather than rejecting:

```js
const d = await getDMMF({ datamodel })
// d = { type: 'wasm-error', reason: '(get-dmmf wasm)', error: {...} }
```

Naive code doing `d.datamodel.models` gets `TypeError: Cannot read properties of
undefined`. Any integration must check for `datamodel` explicitly and surface
`error.message` (which contains a proper `P1012` validation report).

_Trap 2 — version coupling is real and was demonstrated._ Feeding a valid
**Prisma 6-style** schema (with `url = env("DATABASE_URL")` inside `datasource`)
to `@prisma/get-dmmf@7.10.0`:

```
prisma6 style (url in datasource): ERR The datasource property `url` is no longer
                                       supported in schema files.
prisma7 style (no url)           : OK  models=A
no datasource block              : OK  models=A
truncated / invalid              : ERR Error validating: This line is invalid.
```

The pinned wasm parser enforces **its own** Prisma version's schema rules. A user
still on Prisma 6 has a perfectly valid schema that our pinned parser rejects.
This is the central weakness of Approach C and it cannot be engineered away —
only bounded by declaring and enforcing a supported version range.

Two useful secondary facts: a `generator` block is **not** required, and a
`datasource` block is **not** required. `getDMMF` only needs the models.

**Result: VIABLE via `@prisma/get-dmmf`. `@prisma/internals` rejected on size.**

---

### 4.4 Approach D — Custom Prisma generator

**What was tested.** Whether a generator that runs during `prisma generate`
receives complete metadata, and whether it is a practical distribution channel.

First, the contract. `@prisma/generator`'s `GeneratorOptions`:

```ts
export type GeneratorOptions = {
    generator: GeneratorConfig
    otherGenerators: GeneratorConfig[]
    schemaPath: string
    dmmf: DMMF.Document      // <- the full DMMF
    datasources: DataSource[]
    datamodel: string        // <- and the raw schema text as well
    version: string
    ...
}
```

Then it was actually run. A generator was written against
`@prisma/generator-helper` (237 KB), registered in a schema, and executed via
`prisma generate`:

```
✔ Generated Nest Admin metadata probe (0.0.0-spike) to .\spike-tmp\d2-generator\out in 5ms
```

**What it received**, dumped to disk from inside `onGenerate`:

```
receivedKeys : datamodel, datasources, generator, dmmf, otherGenerators,
               schemaPath, version, allowNoModels
hasDmmf      : true | hasRawDatamodel: true
models       : User, Post
enums        : [{"name":"Role","values":["USER","ADMIN"]}]
output       : ...\spike-tmp\d2-generator\out

id         scalar  String    id=Y req=Y uniq=.  list=.  def={"name":"cuid","args":[1]}
email      scalar  String    id=.  req=Y uniq=Y list=.  def=.
bio        scalar  String    id=.  req=.  uniq=.  list=.  def=.
active     scalar  Boolean   id=.  req=Y uniq=.  list=.  def=true
role       enum    Role      id=.  req=Y uniq=.  list=.  def="USER"
posts      object  Post      id=.  req=Y uniq=.  list=Y  def=.  rel=PostToUser
```

Metadata completeness is **identical to Approach C**, as expected — both come
from the same schema engine.

**Structural advantages.** The generator runs inside the consumer's own project
using **the consumer's own Prisma version**. That dissolves the version-coupling
problem in §4.3 rather than mitigating it: whatever Prisma the user has is the
Prisma that parses their schema. It also means zero runtime dependency (the
output is a plain data file), no wasm loaded in production, no ~70 ms boot cost,
and no requirement that `schema.prisma` be present on the production server.

**The blocker: provider resolution failed on Windows.**

A generator is referenced by `provider` in `schema.prisma`. Real generators ship
as npm packages and are referenced by name. Every portable form of that failed
here:

| `provider` value                                                        | Result                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------ |
| `nest-admin-generator-probe` (bare package name)                        | `Error: spawn nest-admin-generator-probe ENOENT` |
| `./node_modules/.bin/nest-admin-generator-probe.cmd`                    | ENOENT                                           |
| `../node_modules/.bin/nest-admin-generator-probe.cmd` (schema-relative) | ENOENT                                           |
| `./node_modules/nest-admin-generator-probe/bin/gen.cjs`                 | ENOENT                                           |
| **absolute path to the `.cmd` shim**                                    | **works**                                        |

This was reproduced in a clean, standard project layout — package installed from
a real `npm pack` tarball (not a symlink), `node_modules/.bin/` shims present and
verified, schema at `prisma/schema.prisma`, cwd at the project root. It still
failed. Only an absolute path worked, and an absolute path cannot be committed to
a shared `schema.prisma`.

**This finding is scoped to one platform.** It was observed only on Windows 11
with Node 24 under Git Bash. The Prisma generator ecosystem is widely used, so
this is more likely an environment or Prisma-7-regression issue than a universal
break — but it was reproducible here, on the primary development machine, and it
is not acceptable to build the MVP's only metadata path on top of it before it is
understood.

**Result: BEST LONG-TERM, BLOCKED FOR NOW.** The metadata story is strictly
better. The distribution story has an unresolved defect on a platform we
demonstrably develop on.

---

### 4.5 Approach E — Parsing `schema.prisma` ourselves

**Investigated, not implemented — deliberately.**

The brief says "do not write a custom Prisma parser," and the evidence supports
that instruction rather than merely complying with it:

- The Prisma schema language is non-trivial: attributes with arguments, function
  defaults (`cuid(1)`, `dbgenerated(...)`), block-level `@@id` / `@@unique` /
  `@@index` / `@@map`, native database type annotations (`@db.VarChar(255)`),
  composite types, multi-file schemas (`schema` may point at a _folder_), and
  comment forms that carry meaning (`///` doc comments).
- It is a moving target across Prisma majors — §4.3 already demonstrated the
  schema language changing between 6 and 7.
- Every viable alternative (C and D) already reaches Prisma's own parser, which
  is the authoritative implementation compiled to wasm. Hand-rolling a second
  parser would mean permanently chasing the first one.
- A partial parser would fail silently on the schemas we did not anticipate,
  which is the worst possible failure mode for a tool whose job is to display
  someone's production data.

**Result: REJECTED.** No experiment was run because a positive result would not
have changed the decision — Prisma's own parser is reachable through two
supported routes, so writing a third is unjustifiable at any quality level.

---

### 4.6 Re-verification of Phase 0 claims

Phase 0's findings were treated as unverified and re-checked. Outcome:

| Phase 0 claim                                                    | Verdict                                                                                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Runtime metadata is lossy; primary key not derivable             | **Confirmed**, and worse than stated — `isList` is missing too, so relation cardinality is also unrecoverable  |
| `DMMF` is type-only in the new generator                         | **Confirmed**, and additionally confirmed for the legacy `prisma-client-js` generator                          |
| `@prisma/internals` is not a transitive dependency of `prisma`   | **Confirmed** — `prisma` 7.10.0 bundles its internals; `require.resolve` fails                                 |
| Prisma 7 changed datasource configuration                        | **Confirmed** — `url` in `datasource` is rejected by the 7.x parser                                            |
| Client should be supplied by the consumer, not constructed by us | **Confirmed and reinforced** — Prisma 7 requires a driver adapter, so only the consumer can construct a client |
| Phase 0 recommendation: "start with `@prisma/internals`"         | **Superseded.** 73 MB. `@prisma/get-dmmf` gives identical output for 3.9 MB                                    |

One Phase 0 statement is corrected: `runtimeDataModel` was described as carrying
`name`/`kind`/`type` only. It also carries `relationName` on relation fields and
`dbName` at model level. This does not change the conclusion — neither is enough
to establish cardinality or identity.

---

## 5. Metadata Matrix

Filled from actual experimental output, not from documentation.

| Metadata                          |                                 Runtime Client                                  | Runtime DMMF | `@prisma/internals` | `@prisma/get-dmmf` | Generator | Schema parsing |
| --------------------------------- | :-----------------------------------------------------------------------------: | :----------: | :-----------------: | :----------------: | :-------: | :------------: |
| Model name                        |                                       yes                                       |     n/a      |         yes         |        yes         |    yes    | not attempted  |
| Model `@@map`                     |                                       yes                                       |     n/a      |         yes         |        yes         |    yes    | not attempted  |
| Field name                        |                                       yes                                       |     n/a      |         yes         |        yes         |    yes    | not attempted  |
| Field type                        |                                       yes                                       |     n/a      |         yes         |        yes         |    yes    | not attempted  |
| Field kind (scalar/enum/object)   |                                       yes                                       |     n/a      |         yes         |        yes         |    yes    | not attempted  |
| **Required / optional**           |                                     **no**                                      |     n/a      |         yes         |        yes         |    yes    | not attempted  |
| **Primary key (`@id`)**           |                                     **no**                                      |     n/a      |         yes         |        yes         |    yes    | not attempted  |
| **Composite key (`@@id`)**        |                                     **no**                                      |     n/a      |         yes         |        yes         |    yes    | not attempted  |
| **Unique (`@unique`)**            |                                     **no**                                      |     n/a      |         yes         |        yes         |    yes    | not attempted  |
| **Composite unique (`@@unique`)** |                                     **no**                                      |     n/a      |         yes         |        yes         |    yes    | not attempted  |
| **List (`[]`)**                   |                                     **no**                                      |     n/a      |         yes         |        yes         |    yes    | not attempted  |
| **Default value**                 |                                     **no**                                      |     n/a      |         yes         |        yes         |    yes    | not attempted  |
| **`@updatedAt`**                  |                                     **no**                                      |     n/a      |         yes         |        yes         |    yes    | not attempted  |
| Enum values                       | **no** (`enums` is `{}`); available separately via the public `enums.ts` export |     n/a      |         yes         |        yes         |    yes    | not attempted  |
| Relation exists                   |                          partial (`relationName` only)                          |     n/a      |         yes         |        yes         |    yes    | not attempted  |
| **Relation cardinality**          |                     **no** (follows from missing `isList`)                      |     n/a      |         yes         |        yes         |    yes    | not attempted  |
| **Relation fields / references**  |                                     **no**                                      |     n/a      |         yes         |        yes         |    yes    | not attempted  |

_"Runtime DMMF" is `n/a` throughout because it does not exist in Prisma 7 — see §4.2._

Supporting non-metadata criteria:

| Criterion                   | Runtime Client         | `@prisma/internals` | `@prisma/get-dmmf`              | Generator                     |
| --------------------------- | ---------------------- | ------------------- | ------------------------------- | ----------------------------- |
| Metadata completeness       | insufficient           | complete            | complete                        | complete                      |
| Prisma 7 compatibility      | yes                    | yes                 | yes                             | yes                           |
| Public API stability        | private (`_`-prefixed) | flagged internal    | **no internal warning**         | helper flagged internal       |
| Runtime performance         | free                   | ~70 ms boot         | ~70 ms boot                     | **free** (build-time)         |
| Build-time complexity       | none                   | none                | none                            | generator + wiring            |
| Installation complexity     | none                   | none                | none                            | schema edit + regenerate      |
| Developer experience        | n/a                    | n/a                 | transparent                     | must re-run `prisma generate` |
| Version compatibility       | n/a                    | pinned parser       | **pinned parser (proven risk)** | **uses consumer's Prisma**    |
| npm package safety          | n/a                    | **73 MB — unsafe**  | 3.9 MB                          | 237 KB, build-time only       |
| Maintenance cost            | n/a                    | high                | moderate                        | moderate                      |
| Future Prisma compatibility | poor                   | moderate            | moderate                        | **best**                      |

---

## 6. Decision

```text
Recommended approach (MVP):
  @prisma/get-dmmf, called from exactly one function inside packages/prisma.

Why:
  - Complete metadata. Proven byte-identical to @prisma/internals output.
  - 3.9 MB instead of 73 MB.
  - The only DMMF route with no "internal use / no SemVer" warning, and its
    README names "creating custom tools" as an intended use.
  - No change to the consumer's schema.prisma, no new build step, no
    regeneration discipline. `npm install` + `nest-admin init` stays true.
  - ~70 ms once at boot. Irrelevant next to a Nest application's startup.
  - It works today, on this machine, on the platform we develop on.

Long-term approach:
  A custom Prisma generator emitting metadata at `prisma generate` time.

Why:
  - Uses the consumer's own Prisma version, which dissolves the version-coupling
    problem rather than bounding it.
  - Zero runtime dependency and zero boot cost.
  - Does not require schema.prisma to exist in production.

Why it is not the MVP choice:
  - Generator provider resolution by package name is broken on the Windows
    environment used for this spike (§4.4). Only an absolute path worked, which
    is not committable to a shared schema. Until that is understood and fixed on
    all three platforms, it cannot be the MVP's only metadata path.

What we reject:
  1. Prisma Client runtime metadata (`_runtimeDataModel`)
  2. Runtime DMMF (`Prisma.dmmf`)
  3. @prisma/internals
  4. Hand-written schema.prisma parsing

Why we reject them:
  1. Insufficient, not merely unstable. Cannot identify a primary key, a
     required field, or a to-one vs to-many relation. Also private API.
  2. Does not exist in Prisma 7 — verified against both generators.
  3. Identical output to @prisma/get-dmmf at 19x the install size, plus an
     explicit internal-use warning. No benefit whatsoever.
  4. Duplicates Prisma's own parser, which we can already call. Guaranteed to
     drift, and fails silently on unanticipated schemas.
```

### Migration path

The two chosen approaches differ **only in how the DMMF is obtained**. Both
produce the same `DMMF.Document`. So:

```text
   getDmmfViaGetDmmf()          getDmmfFromGeneratedFile()
   [MVP]                        [long-term]
            \                  /
             \                /
          same DMMF.Document shape
                    |
          toModelMetadata(dmmf)      <- written once, never rewritten
                    |
             ModelMetadata[]         <- Core contract
```

The mapper is the expensive part and it is shared. Swapping acquisition later is
a contained change behind one function, not a rewrite. This is precisely what the
`OrmAdapter` seam was created to protect, and it is now doing so before a single
line of adapter code exists.

---

## 7. Architecture Impact

**The Core stays exactly as it is.** It gains no dependency, no Prisma
knowledge, and no new contract. `OrmAdapter.getModels(): Promise<ModelMetadata[]>`
already expresses everything needed, and it is already `async`, which the
wasm-backed `getDMMF` requires.

Everything lands inside `packages/prisma`:

```text
packages/prisma/src/
  metadata/
    read-dmmf.ts     <- the ONLY file that imports @prisma/get-dmmf
    to-metadata.ts   <- DMMF.Document -> ModelMetadata[] (shared by both approaches)
  adapter.ts         <- implements OrmAdapter (Phase 2)
```

`@prisma/get-dmmf` is confined to a single module. Nothing else in the repository
may import it. That is what makes the eventual switch to a generator a one-file
change, and it is the same discipline that keeps Prisma out of Core.

**Dependency changes: none in this phase.** `@prisma/get-dmmf` is _not_ added to
`packages/prisma/package.json` yet. This spike decides; Phase 2 implements. When
it is added it will be a regular `dependencies` entry (it is ours to ship, not
the consumer's to provide) — unlike `@prisma/client`, which stays a peer because
it is generated against the consumer's schema.

**No new packages.** A generator, when built, belongs in
`packages/prisma/src/generator/` and would be exposed through a second `bin` on
the published package. It is Prisma-specific and does not justify a workspace
package of its own.

**One small contract clarification was made.** The spike exposed a genuine trap:
Core's `FieldMetadata.isGenerated` was documented as meaning "produced by the
database or the ORM (`@default`, `@updatedAt`)", but DMMF _also_ has a field
called `isGenerated` that means something different — it was `false` for
`id String @id @default(cuid())` in the actual output. An implementer mapping
`dmmf.isGenerated → metadata.isGenerated` would silently produce wrong forms.
The docstring in `packages/core/src/metadata/model.ts` now states the intended
derivation (`hasDefaultValue || isUpdatedAt`) and warns against the collision.
This is a comment change only — no shape change, no behaviour change.

---

## 8. MVP vs Long-Term Strategy

|                                     | MVP                                        | Long-term                                       |
| ----------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| Metadata source                     | `@prisma/get-dmmf` at startup              | generated file from `prisma generate`           |
| Runtime dependency                  | 3.9 MB                                     | none                                            |
| Startup cost                        | ~70 ms once                                | none                                            |
| Needs `schema.prisma` in production | yes                                        | no                                              |
| Prisma version coupling             | pinned parser, bounded by a declared range | none — uses the consumer's Prisma               |
| Consumer setup                      | none beyond `nest-admin init`              | add a generator block, re-run `prisma generate` |
| Staleness risk                      | none (always reads current schema)         | metadata can go stale if generate is skipped    |

**Trigger to migrate** — any one of:

1. Windows/cross-platform generator provider resolution is confirmed working.
2. A user on a Prisma major we do not parse reports a rejected-but-valid schema.
3. Bundling wasm becomes a problem for a deployment target.

Note the trade is not one-directional: the generator introduces a _staleness_
failure mode that runtime introspection does not have. That is a further reason
not to migrate before there is a concrete trigger.

---

## 9. Risks

| #   | Risk                                                                                                                                                 |    Severity    | Notes                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | :------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Prisma schema-language version coupling.** Our pinned parser rejects valid schemas from other Prisma majors — demonstrated with a Prisma 6 schema. |    **High**    | Declare a supported Prisma range, detect the consumer's version at startup, fail with a message naming both versions. Do not attempt to support multiple parsers.                                                                               |
| 2   | **`getDMMF` resolves with an error object instead of throwing.**                                                                                     |    **High**    | Easy to get wrong, produces a baffling `TypeError`. The wrapper must check for `datamodel` and re-throw a `NestAdminError` carrying the `P1012` text. Never return empty metadata — an empty admin looks like a config mistake and costs hours. |
| 3   | **`schema.prisma` may be absent in production.** Slim Docker images frequently do not copy it.                                                       |   **Medium**   | Locate it at startup and fail with an actionable message. This risk is the main argument for the generator long-term.                                                                                                                           |
| 4   | **Generator provider resolution broken on Windows.**                                                                                                 |   **Medium**   | Blocks the long-term approach, not the MVP. Must be reproduced on Linux/macOS and reported upstream if genuine before Phase D work starts.                                                                                                      |
| 5   | **`@prisma/get-dmmf` carries no stability guarantee**, even without a warning banner.                                                                |   **Medium**   | Confined to one module. Pin exactly, test against each Prisma minor.                                                                                                                                                                            |
| 6   | **Prisma 8 is already in RC** and Prisma 7 changed the schema language once.                                                                         |   **Medium**   | Assume it will happen again. Risk 1's version gate is the mitigation.                                                                                                                                                                           |
| 7   | **Multi-file schemas.** `schema` may point at a directory of `.prisma` files.                                                                        | **Low–Medium** | Not tested in this spike. `getDMMF` takes a single datamodel string, so files must be concatenated or `@prisma/schema-files-loader` used. **Open item for Phase 2.**                                                                            |
| 8   | **wasm bundling.** `@prisma/get-dmmf` ships wasm; tsup must not try to inline it.                                                                    | **Low–Medium** | Keep it `external` in the tsup config, verify the published tarball actually resolves it.                                                                                                                                                       |
| 9   | **DMMF `isGenerated` collision** with our own field of the same name.                                                                                |    **Low**     | Documented in Core; see §7.                                                                                                                                                                                                                     |
| 10  | **~70 ms startup cost** grows with schema size.                                                                                                      |    **Low**     | Only measured on a 2-model schema. Re-measure against a 50-model schema in Phase 2.                                                                                                                                                             |

---

## 10. Next Phase

Phase 2 should build **metadata discovery only** — still no CRUD, no HTTP, no UI.

1. Add `@prisma/get-dmmf` (exact pin) to `packages/prisma`.
2. Implement `readPrismaDmmf()` in `src/metadata/read-dmmf.ts` — the only module
   permitted to import it. It must locate the schema, handle the
   resolves-with-an-error-object trap, and throw a `NestAdminError` carrying the
   Prisma validation text.
3. Implement `toModelMetadata(dmmf): ModelMetadata[]` in
   `src/metadata/to-metadata.ts`. This is the durable asset — it survives the
   eventual generator migration. Map `isGenerated` as
   `hasDefaultValue || isUpdatedAt` (see §7), and `primaryKey` from the `@id`
   field or the model-level `primaryKey.fields`.
4. Add a Prisma version gate with a clear out-of-range error.
5. **Tests are the point of this phase.** Assert against a fixture schema that
   every row of the §5 matrix maps correctly — especially `isId`, `isRequired`,
   `isList` and relation cardinality, since those are the attributes Prisma does
   not give us any other way.
6. Resolve the open multi-file-schema question (Risk 7).
7. Re-measure `getDMMF` cost on a large schema (Risk 10).

Explicitly **not** in Phase 2: `OrmAdapter` CRUD methods, query translation, the
admin API, any UI, the generator, and the CLI `init` command.

---

## Appendix — Reproducing this spike

All experiment directories were deleted after the investigation; nothing was left
in the repository. To reproduce:

1. Create a throwaway directory **outside** the pnpm workspace (or install with
   `npm` so `pnpm-lock.yaml` is untouched).
2. `npm install @prisma/get-dmmf@7.10.0`
3. Call `getDMMF({ datamodel })` with the §2 schema and inspect
   `datamodel.models[].fields[]`.
4. For the generator experiment: `npm install @prisma/generator-helper@7.10.0`,
   implement `generatorHandler({ onManifest, onGenerate })`, and reference it
   from a schema's `generator` block by **absolute path** on Windows.

Note that `getDMMF` requires syntactically valid multi-line Prisma blocks —
single-line `model A { id Int @id }` is rejected by the parser as invalid, which
can easily be mistaken for a version-compatibility failure. It was, briefly,
during this spike.

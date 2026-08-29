/**
 * `@nest-admin/cli` - the command line interface.
 *
 * Nothing is implemented yet. No `bin` entry is declared anywhere in the
 * repository on purpose: shipping an executable that does not work would be
 * worse than shipping none.
 *
 * Planned commands:
 *
 *   nest-admin init      detect the project, write nest-admin.config.ts,
 *                        print the AdminModule wiring snippet
 *   nest-admin doctor    report why detection failed
 *   nest-admin generate  scaffold customisations
 *
 * Planned argument parsing: `node:util`'s `parseArgs`. Node >= 20 ships it,
 * the command surface is tiny, and a CLI dependency would be bundled into the
 * single published package for no benefit.
 */

export {}

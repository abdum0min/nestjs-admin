/**
 * Everything about the schema, on one screen.
 *
 * The map, the report and the field tables are three views of one subject, and
 * they answer each other: a model outlined in red on the map is one the report
 * has something to say about, and clicking it is how you get from "that box
 * looks wrong" to "here is the column to nominate".
 *
 * They were on the developer tools page, below a data generator, a danger zone
 * and an undo button. That page had become a drawer.
 */
import { Network } from 'lucide-react'

import { devDoctor } from '../api/client.js'
import { fetchMetadata } from '../api/client.js'
import { useAsync } from '../hooks/use-async.js'
import { MetadataViewer } from './MetadataViewer.jsx'
import { SchemaDoctor } from './SchemaDoctor.jsx'
import { SchemaMap } from './SchemaMap.jsx'
import { ErrorState, FormSkeleton } from './States.jsx'
import { Breadcrumb } from './ui/breadcrumb.jsx'
import { Card, CardContent } from './ui/card.jsx'

export function SchemaView() {
  const metadata = useAsync(() => fetchMetadata(), [])
  const report = useAsync(() => devDoctor(), [])

  const models = metadata.data?.models ?? []
  const findings = report.data ?? []

  // Which boxes the map should outline. Only what fails: outlining most of the
  // schema would say nothing, which is the same reason the navigation counts
  // only the broken ones.
  const flagged = [
    ...new Set(
      findings
        .filter((finding) => finding.severity === 'broken')
        .flatMap((finding) => finding.subjects)
        .map((subject) => subject.split(/[.\s]/)[0] ?? subject),
    ),
  ]

  if (metadata.loading) {
    return (
      <Card>
        <CardContent className="pt-5">
          <FormSkeleton fields={4} />
        </CardContent>
      </Card>
    )
  }
  if (metadata.error !== undefined) {
    return <ErrorState error={metadata.error} onRetry={metadata.reload} />
  }

  return (
    <section className="flex flex-col gap-4">
      <Breadcrumb trail={[{ label: 'Home', href: '#/' }, { label: 'Schema' }]} />

      <header className="flex items-center gap-3">
        <span className="bg-accent text-accent-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
          <Network className="size-5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">Schema</h1>
          <p className="text-muted-foreground text-sm">
            What this admin knows about your models, and what it had to guess.
          </p>
        </div>
      </header>

      <SchemaMap models={models} flagged={flagged} />

      {report.data === undefined ? null : <SchemaDoctor findings={report.data} />}

      <MetadataViewer />
    </section>
  )
}

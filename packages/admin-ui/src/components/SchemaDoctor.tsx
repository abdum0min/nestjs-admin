/**
 * What the admin had to guess about this schema.
 *
 * ## Why it is at the top of a page about generating data
 *
 * Nobody navigates to a diagnosis. They open the developer tools because
 * something looks wrong, and the thing that is wrong is usually one of these -
 * so it sits above the generator rather than behind a second click.
 *
 * When there is nothing to report it collapses to one line. A panel that takes
 * a quarter of the screen to say "everything is fine" trains people to skip the
 * place where the problems appear.
 *
 * ## The fix is the point
 *
 * Every finding that a configuration option can solve carries that option,
 * ready to copy. A diagnosis nobody can act on is a list of complaints, and the
 * whole reason these problems persist is that the reader does not know the
 * option exists.
 */
import { Check, ChevronDown, ChevronRight, Copy, Stethoscope } from 'lucide-react'
import { useState } from 'react'

import type { DevFinding } from '../api/client.js'
import { Badge } from './ui/badge.jsx'
import { Button } from './ui/button.jsx'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.jsx'

/** Copy, and say so - a button that does nothing visible is a button that failed. */
function CopyFix({ fix }: { readonly fix: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex items-start gap-2">
      <code className="bg-muted min-w-0 flex-1 overflow-x-auto rounded px-2 py-1 font-mono text-xs">
        {fix}
      </code>
      <Button
        variant="ghost"
        size="sm"
        aria-label={copied ? 'Copied' : 'Copy the fix'}
        onClick={() => {
          // `clipboard` is absent over plain HTTP on a remote host, and a
          // silent no-op would look like a broken button.
          void navigator.clipboard
            ?.writeText(fix)
            .then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
            .catch(() => setCopied(false))
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  )
}

export function SchemaDoctor({ findings }: { readonly findings: readonly DevFinding[] }) {
  const broken = findings.filter((finding) => finding.severity === 'broken')
  const [open, setOpen] = useState(broken.length > 0)

  if (findings.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-3 text-sm">
          <Stethoscope className="text-muted-foreground size-4" aria-hidden="true" />
          <span className="font-medium">Nothing to report</span>
          <span className="text-muted-foreground">
            The admin did not have to guess anything about this schema.
          </span>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={broken.length > 0 ? 'border-destructive/40' : undefined}>
      <CardHeader className="pb-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="flex w-full items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
          )}
          <Stethoscope className="size-4 shrink-0" aria-hidden="true" />
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Schema report
            {broken.length > 0 ? <Badge variant="destructive">{broken.length} broken</Badge> : null}
            {findings.length - broken.length > 0 ? (
              <Badge variant="outline">{findings.length - broken.length} guessed</Badge>
            ) : null}
          </CardTitle>
        </button>
      </CardHeader>

      {open ? (
        <CardContent className="flex flex-col gap-4">
          {findings.map((finding) => (
            <div
              key={`${finding.code}:${finding.model}:${finding.field ?? ''}`}
              className="flex flex-col gap-1.5"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium">{finding.title}</span>
                <Badge variant={finding.severity === 'broken' ? 'destructive' : 'outline'}>
                  {finding.severity}
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm">{finding.detail}</p>
              {finding.fix === undefined ? (
                <p className="text-muted-foreground text-xs italic">
                  No option fixes this one — it needs a change to the schema.
                </p>
              ) : (
                <CopyFix fix={finding.fix} />
              )}
            </div>
          ))}
        </CardContent>
      ) : null}
    </Card>
  )
}

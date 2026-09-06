/**
 * What the admin had to guess about this schema.
 *
 * ## What the first version got wrong
 *
 * It printed one entry per model, so a ten-model schema with optimistic
 * concurrency on it showed the same paragraph eight times with a different name
 * in each - a wall nobody reads, ending in "no option fixes this one" eight
 * times over. One entry is now one **problem**, carrying the models it applies
 * to, and every entry offers whatever the way out actually is: a configuration
 * option, a line of schema, or turning something off.
 *
 * ## Quiet unless it matters
 *
 * Nothing to report collapses to a line. Notes stay folded. Only something
 * failing opens the card by itself, because that is the only case where the
 * reader has not come looking.
 */
import { Check, ChevronDown, ChevronRight, Copy, Stethoscope } from 'lucide-react'
import { useState } from 'react'

import type { DevFinding, DevRemedy } from '../api/client.js'
import { Badge } from './ui/badge.jsx'
import { Button } from './ui/button.jsx'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.jsx'

/** What each severity is, in the words the page uses. */
const SEVERITY: Readonly<Record<DevFinding['severity'], { label: string; destructive: boolean }>> =
  {
    broken: { label: 'fails today', destructive: true },
    warning: { label: 'not happening', destructive: false },
    note: { label: 'note', destructive: false },
  }

/** Copy, and say so - a button that does nothing visible is a button that failed. */
function CopyCode({ code }: { readonly code: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex items-start gap-2">
      <code className="bg-muted min-w-0 flex-1 overflow-x-auto rounded px-2 py-1 font-mono text-xs">
        {code}
      </code>
      <Button
        variant="ghost"
        size="sm"
        aria-label={copied ? 'Copied' : 'Copy'}
        onClick={() => {
          // `clipboard` is absent over plain HTTP on a remote host, and a
          // silent no-op would look like a broken button.
          void navigator.clipboard
            ?.writeText(code)
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

function Remedy({ remedy }: { readonly remedy: DevRemedy }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{remedy.label}</span>
      <CopyCode code={remedy.code} />
    </div>
  )
}

export function SchemaDoctor({ findings }: { readonly findings: readonly DevFinding[] }) {
  const broken = findings.filter((finding) => finding.severity === 'broken')
  const [open, setOpen] = useState(broken.length > 0)

  if (findings.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-3 text-sm">
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
            {broken.length > 0 ? (
              <Badge variant="destructive">{broken.length} failing</Badge>
            ) : null}
            <span className="text-muted-foreground text-sm font-normal">
              {findings.length} {findings.length === 1 ? 'thing' : 'things'} to look at
              {broken.length === 0 ? ' · nothing is failing' : ''}
            </span>
          </CardTitle>
        </button>
      </CardHeader>

      {open ? (
        <CardContent className="flex flex-col gap-5">
          {findings.map((finding) => (
            <div key={finding.code} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium">{finding.title}</span>
                <Badge variant={SEVERITY[finding.severity].destructive ? 'destructive' : 'outline'}>
                  {SEVERITY[finding.severity].label}
                </Badge>
              </div>

              <p className="text-muted-foreground text-sm">{finding.detail}</p>

              {/* The list, once, rather than the paragraph repeated per model. */}
              <p className="flex flex-wrap gap-1.5">
                {finding.subjects.map((subject) => (
                  <span key={subject} className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                    {subject}
                  </span>
                ))}
              </p>

              {finding.remedies.length === 0 ? (
                <p className="text-muted-foreground text-xs italic">
                  Nothing to change here — this is the schema being what it is.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {finding.remedies.map((remedy) => (
                    <Remedy key={remedy.code} remedy={remedy} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      ) : null}
    </Card>
  )
}

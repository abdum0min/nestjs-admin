/**
 * The document every screen is drawn from.
 *
 * `/admin/meta` is the whole of what this interface knows: which models exist,
 * which fields they have, what each field is, what the policy allows. So the
 * answer to "why does this column look like that" is always in there, and until
 * now the only way to look was the browser's network tab.
 *
 * ## A table, not a pretty-printed blob
 *
 * The raw JSON is one button away, for pasting into a bug report. What is on
 * screen is the shape somebody actually reads: one row per field with the
 * attributes that decide how it is rendered - kind, required, unique,
 * generated, read-only, its widget, what it points at.
 *
 * Loaded only when opened. It is a second copy of a document the shell already
 * has, and fetching it on the chance somebody expands a card would be a request
 * per page view for nothing.
 */
import { Check, ChevronDown, ChevronRight, Copy, FileJson } from 'lucide-react'
import { useState } from 'react'

import { fetchMetadata } from '../api/client.js'
import type { FieldDescriptor, ModelDescriptor } from '../api/types.js'
import { useAsync } from '../hooks/use-async.js'
import { ErrorState } from './States.jsx'
import { Badge } from './ui/badge.jsx'
import { Button } from './ui/button.jsx'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.jsx'
import { Input } from './ui/input.jsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from './ui/table.jsx'

/** The attributes that decide how a field is drawn, as short labels. */
function traits(field: FieldDescriptor): readonly string[] {
  return [
    field.isId ? 'id' : undefined,
    field.isRequired ? 'required' : undefined,
    field.isUnique ? 'unique' : undefined,
    field.isGenerated ? 'generated' : undefined,
    field.readOnly === true && !field.isGenerated ? 'read-only' : undefined,
    field.writeOnly === true ? 'write-only' : undefined,
    field.isList ? 'list' : undefined,
  ].filter((trait): trait is string => trait !== undefined)
}

function matches(model: ModelDescriptor, term: string): boolean {
  if (term === '') return true
  const needle = term.toLowerCase()

  return (
    model.name.toLowerCase().includes(needle) ||
    model.fields.some((field) => field.name.toLowerCase().includes(needle))
  )
}

export function MetadataViewer() {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [copied, setCopied] = useState(false)

  // Only once it is opened, and only once after that.
  const document = useAsync(async () => (open ? fetchMetadata() : undefined), [open])

  const models = (document.data?.models ?? []).filter((model) => matches(model, term))

  return (
    <Card>
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
          <FileJson className="size-4 shrink-0" aria-hidden="true" />
          <CardTitle className="text-base">Metadata</CardTitle>
          <span className="text-muted-foreground text-sm font-normal">
            what every screen is drawn from
          </span>
        </button>
      </CardHeader>

      {open ? (
        <CardContent className="flex flex-col gap-3">
          {document.error !== undefined ? (
            <ErrorState error={document.error} onRetry={document.reload} />
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              className="w-full sm:max-w-xs"
              placeholder="Filter by model or field…"
              aria-label="Filter the metadata"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />

            <Button
              variant="outline"
              size="sm"
              disabled={document.data === undefined}
              onClick={() => {
                // For a bug report, where the shape matters more than the
                // reading.
                void navigator.clipboard
                  ?.writeText(JSON.stringify(document.data, null, 2))
                  .then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  })
                  .catch(() => setCopied(false))
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? 'Copied' : 'Copy JSON'}
            </Button>
          </div>

          {document.data === undefined ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : models.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing matches “{term}”.</p>
          ) : (
            models.map((model) => <ModelTable key={model.name} model={model} />)
          )}
        </CardContent>
      ) : null}
    </Card>
  )
}

function ModelTable({ model }: { readonly model: ModelDescriptor }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-medium">{model.name}</h3>
        <span className="text-muted-foreground text-xs">
          key: {model.primaryKey.join(', ') || '—'} · shown as: {model.displayField}
          {model.versionField === undefined ? '' : ` · version: ${model.versionField}`}
          {model.softDeleteField === undefined ? '' : ` · deleted: ${model.softDeleteField}`}
        </span>
      </div>

      <TableWrap>
        <Table aria-label={`${model.name} fields`}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col">Field</TableHead>
              <TableHead scope="col">Kind</TableHead>
              <TableHead scope="col">Attributes</TableHead>
              <TableHead scope="col">Widget</TableHead>
              <TableHead scope="col">Points at</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {model.fields.map((field) => (
              <TableRow key={field.name}>
                <TableCell className="font-medium">
                  {field.name}
                  {field.label === undefined ? null : (
                    <span className="text-muted-foreground"> · “{field.label}”</span>
                  )}
                </TableCell>
                <TableCell>
                  {field.kind}
                  {field.enumValues ? (
                    <span className="text-muted-foreground"> ({field.enumValues.join(', ')})</span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    {traits(field).map((trait) => (
                      <Badge key={trait} variant="outline">
                        {trait}
                      </Badge>
                    ))}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{field.widget ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">
                  {field.relation === undefined
                    ? '—'
                    : `${field.relation.targetModel} (${field.relation.shape ?? field.relation.cardinality})`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrap>
    </div>
  )
}

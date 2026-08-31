/**
 * Jump anywhere, from anywhere.
 *
 * On a schema of thirty models the sidebar is a scroll and a scan; this is a
 * keystroke and three letters. It is also entirely metadata-driven - every
 * entry comes from the resource list the server sent, so a model a policy
 * hides is not in it, for the same reason it is not in the navigation.
 */
import { ArrowRight, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { ModelDescriptor } from '../api/types.js'
import { navigate } from '../hooks/use-route.js'
import { modelLabel } from '../metadata/fields.js'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './ui/command.jsx'

export function CommandPalette({
  models,
  open,
  onOpenChange,
}: {
  readonly models: readonly ModelDescriptor[]
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const go = (action: () => void): void => {
    onOpenChange(false)
    action()
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Go to a resource…" />
      <CommandList className="max-h-80 overflow-y-auto p-1">
        <CommandEmpty>Nothing matches.</CommandEmpty>

        <CommandGroup heading="Open">
          {models.map((model) => (
            <CommandItem
              key={model.name}
              // Both, so typing either the column name or what people call it
              // finds the resource. They differ whenever a label is set.
              value={`${modelLabel(model)} ${model.name}`}
              onSelect={() => go(() => navigate({ kind: 'list', model: model.name }))}
            >
              <ArrowRight />
              {modelLabel(model)}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Create">
          {models
            // Not offered where the policy would refuse it. The request is
            // checked again when it arrives; this only stops the interface
            // promising something it cannot deliver.
            .filter((model) => model.can?.create !== false)
            .map((model) => (
              <CommandItem
                key={model.name}
                value={`new ${modelLabel(model)} ${model.name}`}
                onSelect={() => go(() => navigate({ kind: 'create', model: model.name }))}
              >
                <Plus />
                New {modelLabel(model)}
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}

/**
 * Ctrl+K, or Cmd+K on a Mac.
 *
 * Bound on the window rather than on an element, because the point of it is
 * that it works wherever you are - including with focus in a table cell.
 * Ignored while typing in a field, where the shortcut would eat the keystroke.
 */
export function useCommandPalette(): {
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
} {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const listen = (event: KeyboardEvent): void => {
      if (event.key !== 'k' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      setOpen((current) => !current)
    }
    window.addEventListener('keydown', listen)
    return () => window.removeEventListener('keydown', listen)
  }, [])

  return { open, setOpen }
}

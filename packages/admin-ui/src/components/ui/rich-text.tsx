/**
 * Formatted text, on a string column that holds HTML.
 *
 * ## The editor is the sanitiser
 *
 * Rendering HTML that came out of a database, on the admin's own origin, is a
 * session-stealing XSS the moment anything less trusted than an administrator
 * can write that column - which on most schemas is a comment box.
 *
 * So the value is never handed to `innerHTML`. It goes through TipTap, which
 * parses HTML into its own document model and **drops everything the model does
 * not contain** - `<script>`, `<iframe>`, `onerror=`, all of it - and then
 * renders that document. The editor a person types into and the read-only view
 * somebody else's text is displayed in are the same component in two modes,
 * which is the point: there is one parser, so there is one answer about what
 * survives.
 *
 * A sanitiser library would be the other way to do it, at twenty kilobytes and
 * a second set of rules to keep in step with the first.
 *
 * ## Links
 *
 * `javascript:` in an `href` is the other half of the same problem, and the
 * link extension is told the three protocols worth allowing rather than left to
 * its defaults.
 *
 * ## Why this file is loaded lazily
 *
 * TipTap and ProseMirror are about two hundred kilobytes. A schema with no
 * rich-text field should not pay for them, so every import of this module is
 * dynamic - see `RichTextField` and `RichTextValue`, which are the only things
 * that reach it.
 */
import Link from '@tiptap/extension-link'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Code, Italic, Link2, List, ListOrdered, Quote } from 'lucide-react'
import { useEffect } from 'react'

import { cn } from '../../lib/utils.js'
import { Button } from './button.jsx'

/** The only protocols a link in stored text may use. */
const PROTOCOLS = ['http', 'https', 'mailto']

const EXTENSIONS = [
  StarterKit.configure({
    // Headings below h4 in a record's body are decoration; the document is
    // already inside a page with its own heading.
    heading: { levels: [2, 3] },
  }),
  Link.configure({
    openOnClick: false,
    autolink: false,
    protocols: PROTOCOLS,
    HTMLAttributes: { rel: 'noreferrer noopener', target: '_blank' },
  }),
]

/** Shared between the editor and the read-only view, so both read the same. */
const PROSE = cn(
  'prose-sm max-w-none',
  '[&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold',
  '[&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold',
  '[&_p]:my-2',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_a]:text-link [&_a]:underline [&_a]:underline-offset-4',
  '[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:italic',
  '[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs',
  '[&_pre]:bg-muted [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:p-2',
)

function ToolbarButton({
  active,
  label,
  onClick,
  children,
}: {
  readonly active: boolean
  readonly label: string
  readonly onClick: () => void
  readonly children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={active}
      className={active ? 'bg-accent text-accent-foreground' : undefined}
      // `onMouseDown` rather than `onClick`: a click moves focus out of the
      // editor first, which collapses the selection the button is about.
      onMouseDown={(event) => {
        event.preventDefault()
        onClick()
      }}
    >
      {children}
    </Button>
  )
}

function Toolbar({ editor }: { readonly editor: Editor }) {
  const link = (): void => {
    const current = String(editor.getAttributes('link')['href'] ?? '')
    const entered = window.prompt('Link address', current)
    if (entered === null) return

    if (entered === '') {
      editor.chain().focus().unsetLink().run()
      return
    }

    // Refused rather than silently dropped, so nobody believes a link was made.
    if (!PROTOCOLS.some((protocol) => entered.startsWith(`${protocol}:`))) {
      window.alert(`A link has to start with ${PROTOCOLS.join(':// , ')}://`)
      return
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: entered }).run()
  }

  return (
    <div className="border-input flex flex-wrap items-center gap-0.5 border-b p-1">
      <ToolbarButton
        active={editor.isActive('bold')}
        label="Bold"
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('italic')}
        label="Italic"
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('heading', { level: 2 })}
        label="Heading"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <span className="text-xs font-semibold">H2</span>
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('heading', { level: 3 })}
        label="Subheading"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <span className="text-xs font-semibold">H3</span>
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('bulletList')}
        label="Bulleted list"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('orderedList')}
        label="Numbered list"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('blockquote')}
        label="Quote"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive('code')}
        label="Code"
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive('link')} label="Link" onClick={link}>
        <Link2 />
      </ToolbarButton>
    </div>
  )
}

/** The editable form control. */
export function RichTextEditor({
  value,
  onChange,
  disabled = false,
  id,
  'aria-describedby': describedBy,
  'aria-labelledby': labelledBy,
}: {
  readonly value: string
  readonly onChange: (html: string) => void
  readonly disabled?: boolean
  readonly id?: string
  readonly 'aria-describedby'?: string
  /**
   * The label's id.
   *
   * A `<label for>` names a form control, and this is a div with
   * `role="textbox"` - which `for` does not reach. Without it the editor is an
   * unnamed text box to anything reading the page.
   */
  readonly 'aria-labelledby'?: string
}) {
  const editor = useEditor({
    extensions: EXTENSIONS,
    content: value,
    editable: !disabled,
    // An empty document serialises as `<p></p>`, which is not nothing: it would
    // turn every untouched field into a write.
    onUpdate: ({ editor: current }) => onChange(current.isEmpty ? '' : current.getHTML()),
    editorProps: {
      attributes: {
        class: cn(PROSE, 'min-h-32 px-3 py-2 focus:outline-none'),
        ...(id === undefined ? {} : { id }),
        ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
        ...(labelledBy === undefined ? {} : { 'aria-labelledby': labelledBy }),
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
  })

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  if (!editor) return null

  return (
    <div
      className={cn(
        'border-input bg-background rounded-md border',
        'focus-within:border-ring focus-within:ring-ring/40 focus-within:ring-[3px]',
        disabled && 'pointer-events-none opacity-60',
      )}
    >
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}

/**
 * Stored HTML, rendered rather than executed.
 *
 * The same parser, with nothing editable. Anything the document model does not
 * describe never reaches the page, which is what makes this safe to point at a
 * column somebody else can write.
 */
export function RichTextReader({ value }: { readonly value: string }) {
  const editor = useEditor(
    {
      extensions: EXTENSIONS,
      content: value,
      editable: false,
      editorProps: { attributes: { class: PROSE } },
    },
    [value],
  )

  if (!editor) return null
  return <EditorContent editor={editor} />
}

/**
 * What you can do to this record, beside it rather than above it.
 *
 * ## Why the actions moved out of the header
 *
 * They were a row of buttons next to the title, and that row has one property
 * that gets worse with every release: it is horizontal. Every action added to
 * it competes for the same line, so they shrink to icons, or wrap onto a
 * second row above the content, or get pushed into a menu - and a destructive
 * action hidden in a menu is a different kind of mistake from one that is
 * visible.
 *
 * A column does not have that problem. Save, Delete, Duplicate, Restore and
 * however many actions the application defines all get a full-width button
 * with a readable label, in a fixed order, in the same place on every record
 * of every model. Nothing competes and nothing needs abbreviating.
 *
 * ## It follows the page
 *
 * `sticky` on wide screens, because the thing it acts on is a form that can be
 * three screens long: an editor who has scrolled to the last field should not
 * have to scroll back to save. On narrow screens it sits above the content,
 * which is where the header row used to be - so nothing moved for the person
 * on a phone.
 *
 * ## The primary action is a submit button that lives outside the form
 *
 * `form="…"` is what the attribute exists for. The alternative - a second Save
 * inside the form for narrow screens - would mean two buttons that must stay
 * in step about whether they are disabled, and they would not.
 */
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.jsx'
import { Card, CardContent } from './ui/card.jsx'

export function ActionRail({
  children,
  title = 'Actions',
}: {
  readonly children: React.ReactNode
  /** Named, because a record screen may have a second rail below the first. */
  readonly title?: string
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-4">
        <h2 className="text-muted-foreground mb-0.5 text-[10px] font-medium tracking-wider uppercase">
          {title}
        </h2>
        {children}
      </CardContent>
    </Card>
  )
}

/**
 * The column itself, and the layout that puts it beside the content.
 *
 * Both halves are here rather than repeated in the two record screens, because
 * the breakpoint, the width and the sticky offset have to agree between them -
 * a rail that is 18rem on one screen and 20rem on the other is the sort of
 * difference nobody reports and everybody notices.
 */
export function WithRail({
  rail,
  children,
}: {
  readonly rail: React.ReactNode
  readonly children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4">{children}</div>

      <aside
        className={cn(
          'flex w-full shrink-0 flex-col gap-3 lg:w-72',
          // Above the content on a phone, where the header row used to be;
          // beside it once there is room. `order` moves it visually without
          // moving it in the document, so a reader still meets the record
          // before the buttons that act on it.
          'order-first lg:order-none',
          // Parked under the header, which is 3.5rem tall.
          'lg:sticky lg:top-18',
        )}
      >
        {rail}
      </aside>
    </div>
  )
}

/**
 * One action.
 *
 * Full width and labelled, which is the whole point of the column: a button
 * that says "Delete forever" cannot be mistaken for one that says "Delete".
 */
export function RailButton({ children, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button className="w-full justify-center" {...props}>
      {children}
    </Button>
  )
}

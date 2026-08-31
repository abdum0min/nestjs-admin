/**
 * The icons a model may be given, as components.
 *
 * A closed map rather than a dynamic lookup, and that is what keeps the bundle
 * honest: `lucide-react` has about fifteen hundred icons, and naming them here
 * is what lets the bundler ship these and drop the rest. An
 * `icons[name as keyof typeof icons]` over the whole package would ship all of
 * them.
 *
 * Kept in step with `ModelIcon` in `api/types.ts`, which mirrors Core. The
 * `satisfies` below is what makes a name added in one place and forgotten in
 * the other a compile error rather than a blank space in the navigation.
 */
import {
  Activity,
  Bell,
  Bookmark,
  Box,
  Building,
  CalendarDays,
  ChartBar,
  Clock,
  CreditCard,
  Database,
  FileText,
  Folder,
  Gift,
  Globe,
  Image,
  Key,
  Layers,
  Link2,
  List,
  Mail,
  MapPin,
  MessageSquare,
  Package,
  Receipt,
  Settings,
  Shield,
  ShoppingCart,
  Star,
  Table2,
  Tag,
  Truck,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react'

import type { ModelIcon } from '../api/types.js'

const ICONS = {
  users: Users,
  user: User,
  building: Building,
  box: Box,
  package: Package,
  tag: Tag,
  'shopping-cart': ShoppingCart,
  'credit-card': CreditCard,
  receipt: Receipt,
  'file-text': FileText,
  folder: Folder,
  image: Image,
  calendar: CalendarDays,
  clock: Clock,
  mail: Mail,
  'message-square': MessageSquare,
  bell: Bell,
  star: Star,
  'map-pin': MapPin,
  globe: Globe,
  settings: Settings,
  key: Key,
  shield: Shield,
  database: Database,
  table: Table2,
  layers: Layers,
  list: List,
  'chart-bar': ChartBar,
  activity: Activity,
  truck: Truck,
  gift: Gift,
  bookmark: Bookmark,
  link: Link2,
} satisfies Record<ModelIcon, LucideIcon>

/**
 * The component for a name, or nothing.
 *
 * Nothing is a real answer. A model without an icon is drawn without one, and
 * a wrong name from a newer server is drawn without one too - a missing icon
 * is a smaller problem than a crash, and the label is still there.
 */
export function modelIcon(name: string | undefined): LucideIcon | undefined {
  return name === undefined ? undefined : ICONS[name as ModelIcon]
}

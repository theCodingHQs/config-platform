import React from 'react';
import {
  User,
  Users,
  UserCheck,
  Contact,
  Briefcase,
  ShoppingCart,
  ShoppingBag,
  Package,
  CreditCard,
  DollarSign,
  Receipt,
  Tag,
  Building2,
  Building,
  Warehouse,
  Store,
  MapPin,
  Globe,
  Home,
  Map,
  Navigation,
  FileText,
  Folder,
  ClipboardList,
  Database,
  Layers,
  Table,
  Book,
  Bookmark,
  File,
  Inbox,
  Calendar,
  Clock,
  Truck,
  Shield,
  Settings,
  HeartPulse,
  Lock,
  Key,
  Server,
  Cpu,
  Terminal,
  Radio,
  Wifi,
  Activity,
  Zap,
  Mail,
  Phone,
  MessageSquare,
  Send,
  Share2,
  Camera,
  Image,
  Video,
  Music,
  Volume2,
  Tv,
  CheckSquare,
  Link,
  Code,
  Type,
  Hash,
  Award,
  Star,
  Heart,
  Gift,
  Flag,
  Filter,
  Search,
  Download,
  Eye,
  Compass,
  Laptop,
  Smartphone,
  Printer,
  Box,
  Grid,
  List,
  Circle,
  ThumbsUp,
  Wrench,
  Trash2,
  Info,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import {
  ALLOWED_ENTITY_ICONS,
  type AllowedIconName,
} from '@config-platform/schema';

export const CURATED_ICONS_MAP: Partial<Record<AllowedIconName, LucideIcon>> = {
  User,
  Users,
  UserCheck,
  Contact,
  Briefcase,
  ShoppingCart,
  ShoppingBag,
  Package,
  CreditCard,
  DollarSign,
  Receipt,
  Tag,
  Building2,
  Building,
  Warehouse,
  Store,
  MapPin,
  Globe,
  Home,
  Map,
  Navigation,
  FileText,
  Folder,
  ClipboardList,
  Database,
  Layers,
  Table,
  Book,
  Bookmark,
  File,
  Inbox,
  Calendar,
  Clock,
  Truck,
  Shield,
  Settings,
  HeartPulse,
  Lock,
  Key,
  Server,
  Cpu,
  Terminal,
  Radio,
  Wifi,
  Activity,
  Zap,
  Mail,
  Phone,
  MessageSquare,
  Send,
  Share2,
  Camera,
  Image,
  Video,
  Music,
  Volume2,
  Tv,
  CheckSquare,
  Link,
  Code,
  Type,
  Hash,
  Award,
  Star,
  Heart,
  Gift,
  Flag,
  Filter,
  Search,
  Download,
  Eye,
  Compass,
  Laptop,
  Smartphone,
  Printer,
  Box,
  Grid,
  List,
  Circle,
  ThumbsUp,
  Wrench,
  Trash2,
  Info,
  HelpCircle,
};

export const ALL_ICON_NAMES: string[] = [...ALLOWED_ENTITY_ICONS];

export const POPULAR_ENTITY_ICONS: Array<{ name: string; label: string; category: string }> = [
  // People
  { name: 'User', label: 'User', category: 'People' },
  { name: 'Users', label: 'Users / Team', category: 'People' },
  { name: 'UserCheck', label: 'Verified User', category: 'People' },
  { name: 'Contact', label: 'Contact', category: 'People' },
  { name: 'Briefcase', label: 'Employee / Job', category: 'People' },

  // Commerce & Finance
  { name: 'ShoppingCart', label: 'Cart / Orders', category: 'Commerce' },
  { name: 'ShoppingBag', label: 'Products', category: 'Commerce' },
  { name: 'Package', label: 'Inventory / Box', category: 'Commerce' },
  { name: 'CreditCard', label: 'Payment / Card', category: 'Commerce' },
  { name: 'DollarSign', label: 'Finance / Money', category: 'Commerce' },
  { name: 'Receipt', label: 'Invoice / Receipt', category: 'Commerce' },
  { name: 'Tag', label: 'Category / Tag', category: 'Commerce' },

  // Organization & Locations
  { name: 'Building2', label: 'Department / Org', category: 'Organization' },
  { name: 'Building', label: 'Office / Building', category: 'Organization' },
  { name: 'Warehouse', label: 'Warehouse / Supply', category: 'Organization' },
  { name: 'Store', label: 'Store / Branch', category: 'Organization' },
  { name: 'MapPin', label: 'Location / Address', category: 'Organization' },
  { name: 'Globe', label: 'Region / Global', category: 'Organization' },
  { name: 'Home', label: 'Home / Property', category: 'Organization' },

  // Content & Data
  { name: 'FileText', label: 'Document / Article', category: 'Content' },
  { name: 'Folder', label: 'Folder / Project', category: 'Content' },
  { name: 'ClipboardList', label: 'Checklist / Audit', category: 'Content' },
  { name: 'Database', label: 'Database / Table', category: 'Content' },
  { name: 'Layers', label: 'Catalog / Stack', category: 'Content' },
  { name: 'Table', label: 'Grid / Sheet', category: 'Content' },
  { name: 'Book', label: 'Docs / Knowledge', category: 'Content' },

  // Operations & Tech
  { name: 'Calendar', label: 'Events / Dates', category: 'Operations' },
  { name: 'Clock', label: 'Schedule / Time', category: 'Operations' },
  { name: 'Truck', label: 'Shipping / Fleet', category: 'Operations' },
  { name: 'Shield', label: 'Security / Role', category: 'Operations' },
  { name: 'Settings', label: 'Settings / Config', category: 'Operations' },
  { name: 'HeartPulse', label: 'Health / Medical', category: 'Operations' },
  { name: 'Activity', label: 'Live Metrics / Pulse', category: 'Operations' },
  { name: 'Zap', label: 'Automation / Triggers', category: 'Operations' },
  { name: 'Lock', label: 'Permissions / Access', category: 'Operations' },
  { name: 'Key', label: 'Secrets / API Keys', category: 'Operations' },
  { name: 'Server', label: 'Infrastructure', category: 'Operations' },
];

export interface DynamicIconProps {
  name?: string | null;
  /** px, or a CSS length such as "1.25em" so the icon follows the surrounding text size. */
  size?: number | string;
  className?: string;
  color?: string;
  style?: React.CSSProperties;
  fallback?: string;
}

export const DynamicIcon: React.FC<DynamicIconProps> = ({
  name,
  size = 18,
  className,
  color,
  style,
  fallback = 'Database',
}) => {
  const FallbackComponent =
    (CURATED_ICONS_MAP as Record<string, LucideIcon>)[fallback] || Database;

  if (!name) {
    return <FallbackComponent size={size} className={className} color={color} style={style} />;
  }

  // Normalize icon name (e.g. 'user' -> 'User', 'building-2' -> 'Building2')
  const cleanName = name
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');

  const IconComponent =
    (CURATED_ICONS_MAP as Record<string, LucideIcon>)[cleanName] ||
    (CURATED_ICONS_MAP as Record<string, LucideIcon>)[name] ||
    (LucideIcons as any)[cleanName] ||
    (LucideIcons as any)[name] ||
    FallbackComponent;

  return <IconComponent size={size} className={className} color={color} style={style} />;
};

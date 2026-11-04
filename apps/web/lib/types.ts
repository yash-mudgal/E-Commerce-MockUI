/** Contracts mirroring the API (apps/api, see docs/API_DESIGN.md). Money values are decimal strings. */

export type Paged<T> = { items: T[]; page: number; pageSize: number; totalCount: number };

export type Me = {
  user: { id: string; name: string; email: string; emailVerified: boolean; isPlatformAdmin: boolean };
  tenant: {
    id: string;
    name: string;
    slug: string;
    host: string;
    status: "Trialing" | "Active" | "PastDue" | "Suspended" | "Cancelled";
    plan: string;
    trialEndsAt: string | null;
    isLive: boolean;
  } | null;
  role: "Owner" | "Manager" | "Staff" | null;
  permissions: string[];
  memberships: { tenantId: string; tenantName: string; role: string }[];
};

export type Category = { id: string; name: string; slug: string; parentId: string | null; position: number; productCount: number };

export type ProductStatus = "draft" | "active" | "archived";

export type ProductListItem = {
  id: string;
  title: string;
  slug: string;
  status: ProductStatus;
  categoryId: string | null;
  categoryName: string | null;
  variantCount: number;
  primarySku: string | null;
  priceMin: string | null;
  priceMax: string | null;
  totalStock: number;
  updatedAt: string;
};

export type Variant = {
  id: string;
  sku: string;
  optionValues: string[];
  price: string;
  mrp: string;
  cost: string | null;
  stockOnHand: number;
  reserved: number;
  isActive: boolean;
};

export type Product = {
  id: string;
  title: string;
  slug: string;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  status: ProductStatus;
  hsnCode: string | null;
  gstRate: string;
  optionNames: string[];
  tags: string[];
  variants: Variant[];
  createdAt: string;
  updatedAt: string;
  version: string;
};

export type Store = {
  id: string;
  name: string;
  slug: string;
  host: string;
  status: string;
  plan: string;
  trialEndsAt: string | null;
  legalName: string | null;
  gstin: string | null;
  stateCode: string | null;
  tagline: string | null;
  supportEmail: string | null;
  brandColor: string;
  lowStockThreshold: number;
};

export type DashboardSummary = {
  catalog: {
    products: number;
    active: number;
    draft: number;
    archived: number;
    categories: number;
    variants: number;
    lowStockVariants: number;
    outOfStockVariants: number;
    unitsOnHand: number;
  };
  lowStock: { productId: string; title: string; sku: string; optionValues: string[]; onHand: number }[];
  sales: null;
};

export type PlatformTenant = {
  id: string;
  name: string;
  slug: string;
  host: string | null;
  status: string;
  plan: string;
  ownerEmail: string | null;
  products: number;
  createdAt: string;
};

// Storefront (public)
export type StorefrontStore = { name: string; tagline: string | null; brandColor: string; supportEmail: string | null; legalName: string | null; gstin: string | null; isLive: boolean };
export type StorefrontCategory = { name: string; slug: string; productCount: number };
export type StorefrontCard = { title: string; slug: string; categoryName: string | null; price: string; mrp: string; inStock: boolean };
export type StorefrontVariant = { id: string; optionValues: string[]; price: string; mrp: string; available: boolean; lowStock: boolean };
export type StorefrontProduct = {
  title: string;
  slug: string;
  description: string;
  categoryName: string | null;
  categorySlug: string | null;
  gstRate: string;
  optionNames: string[];
  variants: StorefrontVariant[];
};

// Staff and invitations
export type AssignableRole = "Manager" | "Staff";
export type StaffMember = { userId: string; name: string; email: string; role: "Owner" | AssignableRole; joinedAt: string; lastLoginAt: string | null; isYou: boolean };
export type Invitation = { id: string; email: string; role: AssignableRole; invitedBy: string; createdAt: string; expiresAt: string; expired: boolean };
export type StaffOverview = { members: StaffMember[]; invitations: Invitation[]; seats: { used: number; max: number | null } };
export type InvitationPreview = { storeName: string; email: string; role: AssignableRole; invitedBy: string; expiresAt: string; accountExists: boolean };

// Onboarding
export type OnboardingStep = { key: string; title: string; description: string; done: boolean; required: boolean };
export type OnboardingStatus = { isLive: boolean; launchedAt: string | null; canLaunch: boolean; steps: OnboardingStep[] };

// Activity log
export type AuditEntry = {
  id: string;
  at: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actor: { id: string; name: string; email: string } | null;
  data: Record<string, unknown> | null;
  ip: string | null;
};

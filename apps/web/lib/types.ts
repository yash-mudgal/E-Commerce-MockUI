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

export type Category = { id: string; name: string; slug: string; parentId: string | null; position: number; productCount: number; version: string };

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
  thumbnailUrl: string | null;
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
  media: ProductImage[];
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
  businessAddress: string | null;
  shippingFee: string;
  freeShippingThreshold: string | null;
  codEnabled: boolean;
  codMaxOrderValue: string;
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
  sales: SalesSummary | null;
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
export type StorefrontImage = { url: string; altText: string | null };
export type StorefrontCard = { title: string; slug: string; categoryName: string | null; price: string; mrp: string; inStock: boolean; image: StorefrontImage | null };
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
  images: StorefrontImage[];
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

// Product images
export type ProductImage = { id: string; url: string; altText: string | null; position: number; contentType: string; sizeBytes: number };
export type UploadTicket = { mediaId: string; uploadUrl: string; method: "PUT"; headers: Record<string, string>; expiresAt: string };

// Inventory
export type StockLocation = { id: string; name: string; code: string; stateCode: string | null; isDefault: boolean; unitsOnHand: number; variantsStocked: number };
export type LocationsOverview = { locations: StockLocation[]; maxLocations: number | null };
export type InventoryItem = {
  variantId: string;
  productId: string;
  productTitle: string;
  productStatus: ProductStatus;
  sku: string;
  optionValues: string[];
  isActive: boolean;
  onHand: number;
  reserved: number;
  available: number;
  lowStock: boolean;
  levels: { locationId: string; onHand: number; reserved: number }[];
};
export type AdjustmentReason = "receipt" | "correction" | "damaged" | "lost" | "return";
export type StockMovement = {
  id: string;
  at: string;
  variantId: string;
  sku: string | null;
  productTitle: string | null;
  locationId: string;
  locationName: string | null;
  delta: number;
  reason: string;
  note: string | null;
  actorName: string | null;
  batchId: string | null;
};

// Shoppers (storefront)
export type CartLine = {
  id: string;
  variantId: string;
  productTitle: string;
  productSlug: string;
  optionNames: string[];
  optionValues: string[];
  sku: string;
  imageUrl: string | null;
  unitPrice: string;
  mrp: string;
  quantity: number;
  lineTotal: string;
  maxQuantity: number;
  status: "ok" | "limited" | "out_of_stock" | "unavailable";
  message: string | null;
};
export type Cart = { lines: CartLine[]; itemCount: number; subtotal: string; savings: string; hasIssues: boolean };
export type Shopper = { id: string; name: string; email: string; phone: string | null; marketingOptIn: boolean; createdAt: string };
export type Address = {
  id: string;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  stateCode: string;
  stateName: string;
  pincode: string;
  isDefault: boolean;
};
export type AdminCustomer = { id: string; name: string; email: string; phone: string | null; marketingOptIn: boolean; addresses: number; createdAt: string; lastLoginAt: string | null };
export type StorefrontSitemap = { storeUpdatedAt: string; products: { slug: string; updatedAt: string }[]; categories: { slug: string; updatedAt: string }[] };

// Checkout and orders
export type QuoteLine = {
  variantId: string; productTitle: string; variantLabel: string | null; sku: string; hsnCode: string | null; gstRate: string;
  unitPrice: string; mrp: string; quantity: number; gross: string; discount: string; taxable: string; cgst: string; sgst: string; igst: string;
  lineTotal: string; imageUrl: string | null;
};
export type Quote = {
  lines: QuoteLine[]; subtotal: string; discount: string; couponCode: string | null; shipping: string; shippingTax: string;
  taxable: string; cgst: string; sgst: string; igst: string; total: string; intraState: boolean; sellerStateCode: string;
  payment: { onlineAvailable: boolean; onlineIsTest: boolean; codAvailable: boolean; codUnavailableReason: string | null };
};
export type CheckoutPayment = {
  gateway: "razorpay" | "test"; isTest: boolean; keyId: string | null; gatewayOrderId: string; amountPaise: number; currency: string;
  storeName: string; customerName: string; email: string; phone: string;
};
export type CheckoutResult = { orderId: string; number: number; status: OrderStatus; paymentMethod: "Online" | "Cod"; total: string; payment: CheckoutPayment | null };
export type OrderStatus = "PendingPayment" | "Confirmed" | "Packed" | "Shipped" | "Delivered" | "Cancelled" | "Expired";
export type PaymentStatus = "Pending" | "Paid" | "Failed" | "CodDue" | "PartiallyRefunded" | "Refunded" | "Voided";
export type OrderLine = {
  id: string; variantId: string | null; productTitle: string; variantLabel: string | null; sku: string; hsnCode: string | null; gstRate: string;
  unitPrice: string; mrp: string; quantity: number; gross: string; discount: string; taxable: string; cgst: string; sgst: string; igst: string; lineTotal: string;
};
export type Order = {
  id: string; number: number; status: OrderStatus; paymentMethod: "Online" | "Cod"; paymentStatus: PaymentStatus; email: string; customerName: string;
  shipTo: { name: string; phone: string; line1: string; line2: string | null; city: string; stateCode: string; stateName: string; pincode: string };
  lines: OrderLine[]; subtotal: string; discount: string; couponCode: string | null; shipping: string; taxable: string; cgst: string; sgst: string; igst: string;
  total: string; refundedTotal: string; refundable: string; placedAt: string; paidAt: string | null; reservedUntil: string | null;
  cancelledAt: string | null; cancelReason: string | null; invoiceNumber: string | null; invoiceIssuedAt: string | null;
  seller: { name: string | null; legalName: string | null; gstin: string | null; address: string | null; stateCode: string; stateName: string };
  payments: { gateway: string; gatewayOrderId: string; gatewayPaymentId: string | null; amount: string; status: string; failureReason: string | null; createdAt: string }[];
  refunds: { id: string; amount: string; reason: string; status: "Pending" | "Processed" | "Failed" | "Manual"; createdAt: string; processedAt: string | null }[];
  shipments: { carrier: string; trackingNumber: string; trackingUrl: string | null; shippedAt: string; deliveredAt: string | null }[];
  actions: ("pack" | "ship" | "deliver" | "cancel" | "refund" | "pay")[];
};
export type OrderSummary = {
  id: string; number: number; status: OrderStatus; paymentMethod: "Online" | "Cod"; paymentStatus: PaymentStatus; customerName: string; email: string;
  itemCount: number; total: string; placedAt: string;
};
export type Coupon = {
  id: string; code: string; kind: "percent" | "fixed"; value: string; minSubtotal: string; maxDiscount: string | null; startsAt: string | null;
  endsAt: string | null; usageLimit: number | null; perCustomerLimit: number; timesUsed: number; isActive: boolean; version: string;
};
export type PaymentSettings = {
  connected: boolean; keyIdHint: string | null; mode: "live" | "test" | null; webhookUrl: string; testModeAvailable: boolean;
  encryptionConfigured: boolean; updatedAt: string | null;
};
export type SalesSummary = {
  days: number; orders: number; revenue: string; averageOrderValue: string; toFulfil: number; awaitingPayment: number;
  daily: { date: string; orders: number; revenue: string }[];
};

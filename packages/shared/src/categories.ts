// Expense category reference — CLAUDE.md §3 Appendix A.

export const EXPENSE_CATEGORIES = [
  'materials',
  'equipment_rent',
  'truck_rental',
  'per_diem',
  'travel',
  'freight',
  'stock_material',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  materials: 'Materials & Parts',
  equipment_rent: 'Equipment Rent',
  truck_rental: 'Truck Rental',
  per_diem: 'Per Diem',
  travel: 'Travel',
  freight: 'Freight',
  stock_material: 'Stock Material',
};

// Default markups carried from the xlsm (stored as decimals; 0.15 = 15%).
export const DEFAULT_MARKUPS: Record<ExpenseCategory, number> = {
  materials: 0.15,
  equipment_rent: 0.1,
  truck_rental: 0,
  per_diem: 0,
  travel: 0,
  freight: 0,
  stock_material: 0,
};

export const TIERS = ['st', 'ot', 'dt'] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABELS: Record<Tier, string> = {
  st: 'Straight Time',
  ot: 'Overtime',
  dt: 'Double Time',
};
export const TIER_MULTIPLIER: Record<Tier, number> = { st: 1, ot: 1.5, dt: 2 };

export const BILLING_TYPES = ['tm', 'quote'] as const;
export type BillingType = (typeof BILLING_TYPES)[number];
export const BILLING_TYPE_LABELS: Record<BillingType, string> = {
  tm: 'Time & Materials',
  quote: 'Quote',
};

export const INVOICE_STATUSES = ['draft', 'finalized', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const ATTACHMENT_STATUSES = ['pending', 'ready', 'failed'] as const;
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];

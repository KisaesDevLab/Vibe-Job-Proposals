// Zod validation schemas shared between web and api — CLAUDE.md §1.3.
import { z } from 'zod';
import { EXPENSE_CATEGORIES, BILLING_TYPES } from './categories.js';

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const money = z.coerce.number().min(0).finite();
const percent = z.coerce.number().min(0).max(10); // 10 = 1000% sanity cap
const hours = z.coerce.number().min(0).max(24);

export const categoryEnum = z.enum(EXPENSE_CATEGORIES);
export const billingTypeEnum = z.enum(BILLING_TYPES);

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12, 'minimum 12 characters'),
});

export const settingsSchema = z.object({
  company_name: z.string().max(200).default(''),
  address_line1: z.string().max(200).default(''),
  address_line2: z.string().max(200).default(''),
  city: z.string().max(100).default(''),
  state: z.string().max(50).default(''),
  zip: z.string().max(20).default(''),
  phone: z.string().max(40).default(''),
  email: z.string().max(200).default(''),
});

export const markupMapSchema = z.array(
  z.object({ category: categoryEnum, percent }),
);

// Per-customer overhead config. Any field nullable to clear that piece; line
// is only emitted by the invoice service when all three are set and percent > 0.
export const customerOverheadSchema = z.object({
  employee_id: z.string().uuid().nullable(),
  hourly_rate: z.coerce.number().nonnegative().nullable(),
  percent: z.coerce.number().min(0).max(1).nullable(),
});

export const rateLevelSchema = z.object({
  name: z.string().min(1).max(100),
  sort_order: z.coerce.number().int().optional(),
  active: z.boolean().optional(),
});

export const employeeSchema = z.object({
  name: z.string().min(1).max(150),
  level_id: z.string().uuid(),
  active: z.boolean().optional(),
  hire_date: dateStr.nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const costRateSchema = z.object({
  effective_from: dateStr,
  cost_st: money,
  cost_ot: money,
  cost_dt: money,
});

export const customerSchema = z.object({
  name: z.string().min(1).max(200),
  bill_to_address1: z.string().min(1, 'address required').max(200),
  bill_to_address2: z.string().max(200).default(''),
  bill_to_city: z.string().min(1, 'city required').max(100),
  bill_to_state: z.string().min(1, 'state required').max(50),
  bill_to_zip: z.string().min(1, 'zip required').max(20),
  contact_name: z.string().max(150).default(''),
  contact_email: z.string().max(200).default(''),
  contact_phone: z.string().max(40).default(''),
  active: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

export const rateScheduleSchema = z.object({
  name: z.string().min(1).max(150),
  effective_from: dateStr,
  effective_to: dateStr.nullable().optional(),
  notes: z.string().nullable().optional(),
  clone_from_id: z.string().uuid().optional(),
});

export const rateScheduleLinesSchema = z.array(
  z.object({
    level_id: z.string().uuid(),
    rate_1x: money,
    rate_15x: money,
    rate_2x: money,
  }),
);

export const jobSchema = z.object({
  code: z.string().min(1).max(60),
  customer_id: z.string().uuid(),
  description: z.string().min(1).max(500),
  po_number: z.string().max(100).nullable().optional(),
  billing_type: billingTypeEnum.default('tm'),
  site_address1: z.string().max(200).default(''),
  site_address2: z.string().max(200).default(''),
  site_city: z.string().max(100).default(''),
  site_state: z.string().max(50).default(''),
  site_zip: z.string().max(20).default(''),
  active: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

export const timeEntrySchema = z.object({
  employee_id: z.string().uuid(),
  job_id: z.string().uuid(),
  work_date: dateStr,
  st_hours: hours.default(0),
  ot_hours: hours.default(0),
  dt_hours: hours.default(0),
});
export const timeEntryBulkSchema = z.array(timeEntrySchema);

export const expenseSchema = z.object({
  work_date: dateStr,
  job_id: z.string().uuid(),
  vendor: z.string().min(1).max(200),
  reference: z.string().max(100).nullable().optional(),
  amount: z.coerce.number().positive().finite(),
  category: categoryEnum,
  description: z.string().max(500).nullable().optional(),
});

export const invoiceDraftSchema = z.object({
  job_id: z.string().uuid(),
  through_date: dateStr,
});

export const invoiceUpdateSchema = z.object({
  through_date: dateStr.optional(),
  notes: z.string().nullable().optional(),
});

export const invoiceEntriesSchema = z.object({
  time_entry_ids: z.array(z.string().uuid()).default([]),
  expense_ids: z.array(z.string().uuid()).default([]),
});

export const invoiceMarkupOverrideSchema = z.array(
  z.object({ category: categoryEnum, percent }),
);

export const voidSchema = z.object({ reason: z.string().min(1).max(500) });

export const emailSchema = z.object({
  to: z.string().email(),
  cc: z.array(z.string().email()).default([]),
  subject: z.string().min(1),
  body: z.string().min(1),
  include_docx: z.boolean().default(true),
  include_pdf: z.boolean().default(true),
});

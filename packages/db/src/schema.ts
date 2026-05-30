// Drizzle schema mirroring the numbered SQL migrations (the source of truth).
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  numeric,
  bigint,
  jsonb,
  customType,
} from 'drizzle-orm/pg-core';

// citext as a custom column type.
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const userRole = pgEnum('user_role', ['admin', 'owner']);
export const expenseCategory = pgEnum('expense_category', [
  'materials',
  'equipment_rent',
  'truck_rental',
  'per_diem',
  'travel',
  'freight',
  'stock_material',
]);
export const billingType = pgEnum('billing_type', ['tm', 'quote']);
export const attachmentStatus = pgEnum('attachment_status', ['pending', 'ready', 'failed']);
export const invoiceStatus = pgEnum('invoice_status', ['draft', 'finalized', 'void']);
export const lineType = pgEnum('line_type', [
  'labor',
  'labor_subtotal',
  'expense',
  'expense_subtotal',
  'expense_markup',
  'grand_total',
]);
export const tierEnum = pgEnum('tier', ['st', 'ot', 'dt']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull().default('admin'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  // Per-user SMTP sender settings (migration 0013).
  smtpHost: text('smtp_host'),
  smtpPort: integer('smtp_port'),
  smtpUser: text('smtp_user'),
  smtpPasswordEnc: text('smtp_password_enc'),
  smtpFromAddress: text('smtp_from_address'),
  smtpFromName: text('smtp_from_name'),
  smtpEnabled: boolean('smtp_enabled').notNull().default(false),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  userId: uuid('user_id').references(() => users.id),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  summary: text('summary').notNull(),
  detail: jsonb('detail'),
});

export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),
  companyName: text('company_name').notNull().default(''),
  addressLine1: text('address_line1').notNull().default(''),
  addressLine2: text('address_line2').notNull().default(''),
  city: text('city').notNull().default(''),
  state: text('state').notNull().default(''),
  zip: text('zip').notNull().default(''),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  logoPath: text('logo_path'),
  templateDocxPath: text('template_docx_path'),
  smtpHost: text('smtp_host'),
  smtpPort: integer('smtp_port'),
  smtpUser: text('smtp_user'),
  smtpPasswordEnc: text('smtp_password_enc'),
  smtpFromAddress: text('smtp_from_address'),
  smtpFromName: text('smtp_from_name'),
  smtpEnabled: boolean('smtp_enabled').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const settingsMarkupDefaults = pgTable('settings_markup_defaults', {
  category: expenseCategory('category').primaryKey(),
  percent: numeric('percent', { precision: 5, scale: 4 }).notNull().default('0'),
});

export const rateLevels = pgTable('rate_levels', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const employees = pgTable('employees', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  levelId: uuid('level_id')
    .notNull()
    .references(() => rateLevels.id),
  active: boolean('active').notNull().default(true),
  hireDate: date('hire_date'),
  notes: text('notes'),
  importedFromXlsm: boolean('imported_from_xlsm').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const employeeCostRates = pgTable('employee_cost_rates', {
  id: uuid('id').primaryKey().defaultRandom(),
  employeeId: uuid('employee_id')
    .notNull()
    .references(() => employees.id, { onDelete: 'cascade' }),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),
  costSt: numeric('cost_st', { precision: 12, scale: 2 }).notNull().default('0'),
  costOt: numeric('cost_ot', { precision: 12, scale: 2 }).notNull().default('0'),
  costDt: numeric('cost_dt', { precision: 12, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  billToAddress1: text('bill_to_address1').notNull().default(''),
  billToAddress2: text('bill_to_address2').notNull().default(''),
  billToCity: text('bill_to_city').notNull().default(''),
  billToState: text('bill_to_state').notNull().default(''),
  billToZip: text('bill_to_zip').notNull().default(''),
  contactName: text('contact_name').notNull().default(''),
  contactEmail: text('contact_email').notNull().default(''),
  contactPhone: text('contact_phone').notNull().default(''),
  active: boolean('active').notNull().default(true),
  notes: text('notes'),
  defaultRateScheduleId: uuid('default_rate_schedule_id'),
  importedFromXlsm: boolean('imported_from_xlsm').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const customerMarkupDefaults = pgTable('customer_markup_defaults', {
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  category: expenseCategory('category').notNull(),
  percent: numeric('percent', { precision: 5, scale: 4 }).notNull().default('0'),
});

export const rateSchedules = pgTable('rate_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),
  notes: text('notes'),
  importedFromXlsm: boolean('imported_from_xlsm').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rateScheduleLines = pgTable('rate_schedule_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  scheduleId: uuid('schedule_id')
    .notNull()
    .references(() => rateSchedules.id, { onDelete: 'cascade' }),
  levelId: uuid('level_id')
    .notNull()
    .references(() => rateLevels.id),
  rate1x: numeric('rate_1x', { precision: 12, scale: 2 }).notNull().default('0'),
  rate15x: numeric('rate_15x', { precision: 12, scale: 2 }).notNull().default('0'),
  rate2x: numeric('rate_2x', { precision: 12, scale: 2 }).notNull().default('0'),
});

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: citext('code').notNull().unique(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id),
  description: text('description').notNull(),
  poNumber: text('po_number'),
  billingType: billingType('billing_type').notNull().default('tm'),
  siteAddress1: text('site_address1').notNull().default(''),
  siteAddress2: text('site_address2').notNull().default(''),
  siteCity: text('site_city').notNull().default(''),
  siteState: text('site_state').notNull().default(''),
  siteZip: text('site_zip').notNull().default(''),
  active: boolean('active').notNull().default(true),
  notes: text('notes'),
  importedFromXlsm: boolean('imported_from_xlsm').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const timeEntries = pgTable('time_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  employeeId: uuid('employee_id')
    .notNull()
    .references(() => employees.id),
  jobId: uuid('job_id')
    .notNull()
    .references(() => jobs.id),
  workDate: date('work_date').notNull(),
  stHours: numeric('st_hours', { precision: 6, scale: 2 }).notNull().default('0'),
  otHours: numeric('ot_hours', { precision: 6, scale: 2 }).notNull().default('0'),
  dtHours: numeric('dt_hours', { precision: 6, scale: 2 }).notNull().default('0'),
  invoiceId: uuid('invoice_id'),
  importedFromXlsm: boolean('imported_from_xlsm').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const expenses = pgTable('expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  workDate: date('work_date').notNull(),
  jobId: uuid('job_id')
    .notNull()
    .references(() => jobs.id),
  vendor: text('vendor').notNull(),
  reference: text('reference'),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  category: expenseCategory('category').notNull(),
  description: text('description'),
  invoiceId: uuid('invoice_id'),
  importedFromXlsm: boolean('imported_from_xlsm').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const expenseAttachments = pgTable('expense_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  expenseId: uuid('expense_id')
    .notNull()
    .references(() => expenses.id, { onDelete: 'cascade' }),
  originalFilename: text('original_filename').notNull(),
  storedPath: text('stored_path').notNull(),
  contentType: text('content_type').notNull(),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),
  status: attachmentStatus('status').notNull().default('pending'),
  retryCount: integer('retry_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id')
    .notNull()
    .references(() => jobs.id),
  sequenceNumber: integer('sequence_number'),
  billedReference: text('billed_reference'),
  status: invoiceStatus('status').notNull().default('draft'),
  throughDate: date('through_date').notNull(),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidReason: text('void_reason'),
  voidedByUserId: uuid('voided_by_user_id').references(() => users.id),
  generatedDocxPath: text('generated_docx_path'),
  generatedPdfPath: text('generated_pdf_path'),
  docxStatus: attachmentStatus('docx_status'),
  pdfStatus: attachmentStatus('pdf_status'),
  generationError: text('generation_error'),
  importedFromXlsm: boolean('imported_from_xlsm').notNull().default(false),
  totalLabor: numeric('total_labor', { precision: 12, scale: 2 }),
  totalLaborCost: numeric('total_labor_cost', { precision: 12, scale: 2 }),
  totalMaterials: numeric('total_materials', { precision: 12, scale: 2 }),
  totalEquipmentRent: numeric('total_equipment_rent', { precision: 12, scale: 2 }),
  totalTruckRental: numeric('total_truck_rental', { precision: 12, scale: 2 }),
  totalPerDiem: numeric('total_per_diem', { precision: 12, scale: 2 }),
  totalTravel: numeric('total_travel', { precision: 12, scale: 2 }),
  totalFreight: numeric('total_freight', { precision: 12, scale: 2 }),
  totalStockMaterial: numeric('total_stock_material', { precision: 12, scale: 2 }),
  totalMarkup: numeric('total_markup', { precision: 12, scale: 2 }),
  totalExpenseCost: numeric('total_expense_cost', { precision: 12, scale: 2 }),
  grandTotal: numeric('grand_total', { precision: 12, scale: 2 }),
});

export const invoiceMarkupOverrides = pgTable('invoice_markup_overrides', {
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  category: expenseCategory('category').notNull(),
  percent: numeric('percent', { precision: 5, scale: 4 }).notNull(),
});

export const invoiceLineItems = pgTable('invoice_line_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  lineOrder: integer('line_order').notNull(),
  lineType: lineType('line_type').notNull(),
  category: expenseCategory('category'),
  employeeId: uuid('employee_id').references(() => employees.id),
  expenseId: uuid('expense_id').references(() => expenses.id),
  description: text('description').notNull(),
  tier: tierEnum('tier'),
  quantity: numeric('quantity', { precision: 12, scale: 2 }),
  unitRate: numeric('unit_rate', { precision: 12, scale: 2 }),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull().default('0'),
  costAmount: numeric('cost_amount', { precision: 12, scale: 2 }),
});

export const invoiceEmails = pgTable('invoice_emails', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  toAddress: text('to_address').notNull(),
  ccAddresses: text('cc_addresses').array().notNull().default([]),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  sentByUserId: uuid('sent_by_user_id').references(() => users.id),
  includedDocx: boolean('included_docx').notNull().default(true),
  includedPdf: boolean('included_pdf').notNull().default(true),
  smtpMessageId: text('smtp_message_id'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

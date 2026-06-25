import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  numeric,
  date,
  index,
} from "drizzle-orm/pg-core";
import {
  USER_ROLES,
  STRUCTURE_TYPES,
  PROJECT_STATUSES,
  DIAGNOSTIC_STATUSES,
  PRIORITIES,
  TASK_STATUSES,
  TASK_SOURCES,
  DOCUMENT_TYPES,
  DOCUMENT_ORIGINS,
  DOCUMENT_STATUSES,
  REVIEWER_TYPES,
  REVIEW_TARGET_TYPES,
  VERDICTS,
  FINDING_TYPES,
  FINDING_STATUSES,
  AUDIT_STATUSES,
  AGENT_NAMES,
} from "@cqms/shared";

// Helper para usar los arrays de @cqms/shared como enums de Postgres
const e = <T extends readonly [string, ...string[]]>(name: string, vals: readonly string[]) =>
  pgEnum(name, vals as unknown as T);

export const userRole = e("user_role", USER_ROLES);
export const structureType = e("structure_type", STRUCTURE_TYPES);
export const projectStatus = e("project_status", PROJECT_STATUSES);
export const diagnosticStatus = e("diagnostic_status", DIAGNOSTIC_STATUSES);
export const priority = e("priority", PRIORITIES);
export const taskStatus = e("task_status", TASK_STATUSES);
export const taskSource = e("task_source", TASK_SOURCES);
export const documentType = e("document_type", DOCUMENT_TYPES);
export const documentOrigin = e("document_origin", DOCUMENT_ORIGINS);
export const documentStatus = e("document_status", DOCUMENT_STATUSES);
export const reviewerType = e("reviewer_type", REVIEWER_TYPES);
export const reviewTargetType = e("review_target_type", REVIEW_TARGET_TYPES);
export const verdict = e("verdict", VERDICTS);
export const findingType = e("finding_type", FINDING_TYPES);
export const findingStatus = e("finding_status", FINDING_STATUSES);
export const auditStatus = e("audit_status", AUDIT_STATUSES);
export const agentName = e("agent_name", AGENT_NAMES);

const now = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

// ───────────────────────────── CATÁLOGO (global, tu IP) ─────────────────────────────

export const standards = pgTable("standards", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(), // "ISO9001"
  name: text("name").notNull(),
  version: text("version").notNull(), // "2015"
  structureType: structureType("structure_type").notNull(),
  createdAt: now(),
});

export const requirements = pgTable(
  "requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    standardId: uuid("standard_id").notNull().references(() => standards.id),
    clauseNo: text("clause_no").notNull(), // "7.1.5"
    title: text("title").notNull(),
    paraphrasedText: text("paraphrased_text").notNull(), // contenido propio, NO texto oficial ISO
    category: text("category"),
    parentId: uuid("parent_id"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => ({ byStandard: index("req_standard_idx").on(t.standardId) }),
);

export const requirementGuidance = pgTable("requirement_guidance", {
  id: uuid("id").primaryKey().defaultRandom(),
  requirementId: uuid("requirement_id").notNull().references(() => requirements.id),
  expectedEvidence: text("expected_evidence").notNull(),
  suggestedDocumentType: documentType("suggested_document_type"),
  auditCriteria: text("audit_criteria").notNull(),
});

// ───────────────────────────── TENANT (por cliente) ─────────────────────────────

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  industry: text("industry"),
  size: text("size"),
  country: text("country"),
  createdAt: now(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    cognitoSub: text("cognito_sub").unique(), // mapeo al usuario de Cognito
    email: text("email").notNull(),
    name: text("name"),
    role: userRole("role").notNull().default("member"),
    createdAt: now(),
  },
  (t) => ({ byOrg: index("users_org_idx").on(t.orgId) }),
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    standardId: uuid("standard_id").notNull().references(() => standards.id),
    name: text("name").notNull(), // "Proyecto ISO 9001"
    scope: text("scope"),
    status: projectStatus("status").notNull().default("draft"),
    readinessPct: numeric("readiness_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    targetAuditDate: date("target_audit_date"),
    createdAt: now(),
  },
  (t) => ({ byOrg: index("projects_org_idx").on(t.orgId) }),
);

export const diagnostics = pgTable(
  "diagnostics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    requirementId: uuid("requirement_id").notNull().references(() => requirements.id),
    status: diagnosticStatus("status").notNull(),
    answerText: text("answer_text"),
    priority: priority("priority"),
    aiNotes: text("ai_notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ byProject: index("diag_project_idx").on(t.projectId) }),
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    requirementId: uuid("requirement_id").references(() => requirements.id),
    title: text("title").notNull(),
    description: text("description"),
    assigneeId: uuid("assignee_id").references(() => users.id),
    dueDate: date("due_date"),
    status: taskStatus("status").notNull().default("open"),
    source: taskSource("source").notNull().default("manual"),
    createdAt: now(),
  },
  (t) => ({ byProject: index("tasks_project_idx").on(t.projectId) }),
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    requirementId: uuid("requirement_id").references(() => requirements.id),
    type: documentType("type").notNull(),
    title: text("title").notNull(),
    currentVersionId: uuid("current_version_id"),
    origin: documentOrigin("origin").notNull(),
    status: documentStatus("status").notNull().default("draft"),
    createdAt: now(),
  },
  (t) => ({ byProject: index("docs_project_idx").on(t.projectId) }),
);

export const documentVersions = pgTable("document_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => documents.id),
  versionNo: integer("version_no").notNull(),
  s3Key: text("s3_key"),
  contentMd: text("content_md"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: now(),
});

export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    requirementId: uuid("requirement_id").notNull().references(() => requirements.id),
    s3Key: text("s3_key").notNull(),
    filename: text("filename").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ byProject: index("evidence_project_idx").on(t.projectId) }),
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    targetType: reviewTargetType("target_type").notNull(),
    targetId: uuid("target_id").notNull(), // documento o evidencia
    reviewerType: reviewerType("reviewer_type").notNull(),
    verdict: verdict("verdict").notNull(),
    findingsJson: jsonb("findings_json"),
    reviewerId: uuid("reviewer_id").references(() => users.id),
    createdAt: now(),
  },
  (t) => ({ byProject: index("reviews_project_idx").on(t.projectId) }),
);

export const internalAudits = pgTable("internal_audits", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  status: auditStatus("status").notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  summary: text("summary"),
});

export const auditFindings = pgTable("audit_findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  auditId: uuid("audit_id").notNull().references(() => internalAudits.id),
  requirementId: uuid("requirement_id").references(() => requirements.id),
  type: findingType("type").notNull(),
  description: text("description").notNull(),
  status: findingStatus("status").notNull().default("open"),
});

export const correctiveActions = pgTable("corrective_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  findingId: uuid("finding_id").notNull().references(() => auditFindings.id),
  actionText: text("action_text").notNull(),
  ownerId: uuid("owner_id").references(() => users.id),
  dueDate: date("due_date"),
  status: findingStatus("status").notNull().default("open"),
});

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id),
    projectId: uuid("project_id").references(() => projects.id),
    agent: agentName("agent").notNull(),
    inputJson: jsonb("input_json"),
    outputJson: jsonb("output_json"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
    createdAt: now(),
  },
  (t) => ({ byProject: index("agent_runs_project_idx").on(t.projectId) }),
);

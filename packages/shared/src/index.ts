// Dominio de ConsultorQMS — valores compartidos entre db, api, agents y web.

export const USER_ROLES = ["admin", "member", "reviewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const STRUCTURE_TYPES = ["annex_sl", "custom"] as const;
export type StructureType = (typeof STRUCTURE_TYPES)[number];

export const PROJECT_STATUSES = [
  "draft",        // creado, sin alcance definido
  "diagnosing",   // entrevista / diagnóstico en curso
  "in_progress",  // cerrando gaps
  "audit_ready",  // listo para auditoría interna/externa
  "audited",      // auditoría interna hecha
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const DIAGNOSTIC_STATUSES = [
  "compliant",      // cumple
  "partial",        // parcial
  "gap",            // brecha
  "not_applicable", // no aplica al alcance
] as const;
export type DiagnosticStatus = (typeof DIAGNOSTIC_STATUSES)[number];

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TASK_STATUSES = ["open", "in_progress", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_SOURCES = ["gap", "audit", "manual"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export const DOCUMENT_TYPES = ["policy", "procedure", "record", "manual", "other"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_ORIGINS = ["generated", "uploaded"] as const;
export type DocumentOrigin = (typeof DOCUMENT_ORIGINS)[number];

export const DOCUMENT_STATUSES = ["draft", "in_review", "approved"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const REVIEWER_TYPES = ["ai", "human"] as const;
export type ReviewerType = (typeof REVIEWER_TYPES)[number];

export const REVIEW_TARGET_TYPES = ["document", "evidence"] as const;
export type ReviewTargetType = (typeof REVIEW_TARGET_TYPES)[number];

export const VERDICTS = ["accepted", "needs_work", "rejected"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const FINDING_TYPES = [
  "nonconformity_major",
  "nonconformity_minor",
  "observation",
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

export const FINDING_STATUSES = ["open", "addressed", "closed"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const AUDIT_STATUSES = ["pending", "running", "completed"] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const AGENT_NAMES = ["diagnostic", "documentation", "auditor", "coach"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

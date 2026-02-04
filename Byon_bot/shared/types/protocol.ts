/**
 * MACP v1.1 Protocol Types
 * Shared types for all agents in the multi-agent system
 */

// ============================================
// Common Types
// ============================================

export type UUID = string;
export type ISO8601 = string;
export type SHA256Hash = string;
export type Base64 = string;

export type TrustLevel = 'self' | 'trusted' | 'external' | 'unknown';
export type RiskLevel = 'low' | 'medium' | 'high';
export type TaskType = 'coding' | 'general' | 'calendar' | 'message' | 'scheduling' | 'messaging';

export type ActionType =
  | 'code_edit'
  | 'file_create'
  | 'file_delete'
  | 'test_run'
  | 'lint_run'
  | 'build_run';

export type ExecutionStatus = 'success' | 'partial' | 'failed' | 'rejected';

// ============================================
// Source Types
// ============================================

export type SourceType =
  | 'whatsapp'
  | 'telegram'
  | 'discord'
  | 'webchat'
  | 'email'
  | 'calendar'
  | 'file';

export interface Source {
  event_id: UUID;
  source: SourceType;
  timestamp: ISO8601;
  trust_level: TrustLevel;
  payload_ref: SHA256Hash;
}

// ============================================
// Evidence Pack (Worker → Auditor)
// ============================================

export interface ExtractedFact {
  fact_id: UUID;
  fact: string;
  source_event: UUID;
  confidence: number; // 0-1
}

export interface RawQuote {
  quote: string;
  source_event: UUID;
}

export interface FileSection {
  lines: [number, number];
  content: string;
  reason: string;
}

export interface AnalyzedFile {
  path: string;
  relevant_sections: FileSection[];
}

export interface CodebaseContext {
  files_analyzed: AnalyzedFile[] | string[];
  dependencies: string[];
  language: string;
  framework?: string;
}

/**
 * Memory context from FHRSS+FCPE
 * Stores context IDs for retrieval and tracking
 */
export interface MemoryContext {
  conversation_ctx_id?: number;
  relevant_code_ctx_ids?: number[];
  relevant_fact_ctx_ids?: number[];
  similar_past_ctx_ids?: number[];
}

export interface EvidencePack {
  evidence_id: UUID;
  timestamp: ISO8601;
  task_type: TaskType;
  sources: Source[];
  extracted_facts: ExtractedFact[];
  raw_quotes: RawQuote[];
  codebase_context: CodebaseContext;
  forbidden_data_present: boolean;
  /** FHRSS+FCPE memory context for cross-session retrieval */
  memory_context?: MemoryContext;
  hash: SHA256Hash;
}

// ============================================
// Plan Draft (Worker → Auditor)
// ============================================

export interface CodeEdit {
  old: string;
  new: string;
}

export interface ActionParameters {
  file_path?: string;
  edits?: CodeEdit[];
  framework?: string;
  path?: string;
  command?: string;
}

export interface Action {
  action_id: UUID;
  type: ActionType;
  parameters: ActionParameters;
  expected_outcome: string;
}

export interface PlanDraft {
  plan_id: UUID;
  timestamp: ISO8601;
  based_on_evidence: UUID;
  intent: string;
  /** Actions must be canonical Action[] - use toCanonicalActions() to convert from SimplifiedAction[] */
  actions: Action[];
  risk_level: RiskLevel;
  rollback_possible: boolean;
  estimated_iterations: number;
  /** FHRSS+FCPE memory context for experience-based planning */
  memory_context?: MemoryContext;
  hash: SHA256Hash;
}

/**
 * Simplified action format for auto-generated plans
 * This is a DTO - must be converted to Action before use in PlanDraft
 */
export interface SimplifiedAction {
  action_id: UUID;
  action_type: string;
  target: string;
  params: Record<string, unknown>;
  requires_confirmation: boolean;
}

// ============================================
// Action Type Adapters
// ============================================

/**
 * Type guard: check if action is SimplifiedAction
 */
export function isSimplifiedAction(action: Action | SimplifiedAction): action is SimplifiedAction {
  return 'action_type' in action && 'target' in action && 'params' in action;
}

/**
 * Type guard: check if action is canonical Action
 */
export function isCanonicalAction(action: Action | SimplifiedAction): action is Action {
  return 'type' in action && 'parameters' in action && 'expected_outcome' in action;
}

/**
 * Map action_type string to ActionType enum
 */
function mapActionType(actionType: string): ActionType {
  const mapping: Record<string, ActionType> = {
    'code_edit': 'code_edit',
    'code_read': 'code_edit', // Read is a subset of edit
    'code_write': 'code_edit',
    'file_create': 'file_create',
    'file_delete': 'file_delete',
    'test_run': 'test_run',
    'lint_run': 'lint_run',
    'build_run': 'build_run',
  };
  return mapping[actionType] || 'code_edit'; // Default to code_edit for unknown types
}

/**
 * Convert SimplifiedAction to canonical Action
 * BOUNDARY: This is the ONLY place where conversion should happen
 */
export function toCanonicalAction(simplified: SimplifiedAction): Action {
  return {
    action_id: simplified.action_id,
    type: mapActionType(simplified.action_type),
    parameters: {
      file_path: simplified.target !== 'system' && simplified.target !== 'test suite'
        ? simplified.target
        : undefined,
      ...simplified.params as Partial<ActionParameters>,
    },
    expected_outcome: simplified.params.description as string ||
      `Execute ${simplified.action_type} on ${simplified.target}`,
  };
}

/**
 * Convert array of SimplifiedActions to canonical Actions
 */
export function toCanonicalActions(actions: SimplifiedAction[]): Action[] {
  return actions.map(toCanonicalAction);
}

// ============================================
// Approval Request (Auditor → User)
// ============================================

export interface ActionPreview {
  action_id: UUID;
  type: ActionType;
  file?: string;
  description: string;
  diff_preview?: string;
}

export interface SecurityChecks {
  path_traversal: 'PASS' | 'FAIL';
  command_injection: 'PASS' | 'FAIL';
  resource_limits: 'PASS' | 'FAIL';
}

export interface UserOptions {
  approve: string;
  reject: string;
  modify: string;
}

export interface ApprovalSummary {
  intent: string;
  description: string;
  affected_files: string[];
  risk_level: RiskLevel;
}

export interface ApprovalRequest {
  request_id: UUID;
  timestamp: ISO8601;
  based_on_plan: UUID;
  summary: ApprovalSummary;
  actions_preview: ActionPreview[];
  security_checks: SecurityChecks;
  requires_approval: boolean;
  expires_at: ISO8601;
  user_options: UserOptions;
  hash: SHA256Hash;
}

// ============================================
// Execution Order (Auditor → Executor)
// ============================================

export interface ExecutionConstraints {
  max_iterations: number;
  timeout_minutes: number;
  memory_limit_mb: number;
  disk_limit_mb: number;
  network_allowed: false; // Always false for air-gap
}

export interface RollbackConfig {
  enabled: boolean;
  git_ref: string;
}

export interface Ed25519Signature {
  algorithm: 'Ed25519';
  public_key: Base64;
  signature: Base64;
}

export interface ExecutionOrder {
  order_id: UUID;
  timestamp: ISO8601;
  based_on_plan: UUID;
  approved_by: string;
  approved_at: ISO8601;
  actions: Action[];
  constraints: ExecutionConstraints;
  rollback: RollbackConfig;
  signature: Ed25519Signature;
  hash: SHA256Hash;
}

// ============================================
// Johnson Receipt (Executor → Worker)
// ============================================

export interface ExecutionSummary {
  status: ExecutionStatus;
  actions_total: number;
  actions_completed: number;
  actions_failed: number;
  iterations_used: number;
  duration_ms: number;
}

export interface ActionResult {
  action_id: UUID;
  type: ActionType;
  status: 'success' | 'failed';
  iterations: number;
  details: Record<string, unknown>;
}

export interface ExecutionError {
  action_id: UUID;
  iteration: number;
  error: string;
  last_error?: string;
}

export interface ChangesMade {
  files_modified: string[];
  files_created: string[];
  files_deleted: string[];
  git_diff_ref?: string;
}

export interface VerificationStatus {
  tests_passing: boolean;
  lint_passing: boolean;
  build_passing: boolean;
}

export interface JohnsonReceipt {
  receipt_id: UUID;
  timestamp: ISO8601;
  based_on_order: UUID;
  execution_summary: ExecutionSummary;
  action_results: ActionResult[];
  errors: ExecutionError[];
  changes_made: ChangesMade;
  verification: VerificationStatus;
  hash: SHA256Hash;
}

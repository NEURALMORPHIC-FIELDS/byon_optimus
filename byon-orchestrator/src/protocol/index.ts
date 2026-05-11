/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * MACP Protocol Module Exports
 * ============================
 *
 * Central export for MACP v1.1 protocol implementation.
 * Multi-Agent Control Protocol for BYON orchestrator.
 *
 * Documents:
 * - EvidencePack: Gathered evidence for decision making
 * - PlanDraft: Proposed plan of actions
 * - ApprovalRequest: Request for user approval
 * - ExecutionOrder: Signed order for executor (Ed25519)
 * - JohnsonReceipt: Execution result receipt
 */

// EvidencePack
export {
    EvidencePackBuilder,
    createEvidencePackBuilder,
    createEvidencePackForTask,
    createGlobalMemoryHint,
    calculateContentHash,
    validateEvidencePack
} from "./evidence-pack.js";

// Fact Extractor
export {
    ProtocolFactExtractor,
    createProtocolFactExtractor,
    type ProtocolFactExtractorConfig
} from "./protocol-fact-extractor.js";

// Quote Extractor
export {
    QuoteExtractor,
    createQuoteExtractor,
    type QuoteExtractorConfig
} from "./quote-extractor.js";

// PlanDraft
export {
    PlanDraftBuilder,
    createPlanDraftBuilder,
    createPlanDraftFromEvidence,
    createAction,
    validatePlanDraft
} from "./plan-draft.js";

// Action Generator
export {
    ActionGenerator,
    createActionGenerator,
    type ActionGeneratorConfig
} from "./action-generator.js";

// Risk Assessor
export {
    RiskAssessor,
    createRiskAssessor,
    quickRiskCheck,
    isAutoApprovable,
    type RiskAssessment,
    type RiskAssessorConfig
} from "./risk-assessor.js";

// ApprovalRequest
export {
    ApprovalRequestBuilder,
    createApprovalRequestBuilder,
    createApprovalRequestFromPlan,
    isApprovalExpired,
    allSecurityChecksPassed,
    getFailedSecurityChecks,
    validateApprovalRequest,
    type ApprovalRequestConfig
} from "./approval-request.js";

// Security Checker
export {
    SecurityChecker,
    createSecurityChecker,
    validatePlanSecurity,
    getSecurityReport,
    type SecurityCheckConfig
} from "./security-checker.js";

// ExecutionOrder
export {
    ExecutionOrderBuilder,
    createExecutionOrderBuilder,
    createExecutionOrderFromApproval,
    verifyExecutionOrder,
    isExecutionOrderExpired,
    getRemainingExecutionTime,
    type ExecutionConstraints,
    type RollbackConfig
} from "./execution-order.js";

// JohnsonReceipt
export {
    JohnsonReceiptBuilder,
    createJohnsonReceiptBuilder,
    createJohnsonReceiptFromExecution,
    createSuccessReceipt,
    createFailureReceipt,
    validateJohnsonReceipt,
    getReceiptSummary,
    isReceiptSuccessful
} from "./johnson-receipt.js";

// Crypto
export {
    Ed25519Signer,
    createEd25519Signer,
    createSignerWithNewKeys,
    verifySignature,
    quickSign,
    type SigningResult,
    type VerificationResult
} from "./crypto/ed25519-signer.js";

export {
    KeyManager,
    createKeyManager,
    createMemoryKeyManager,
    type KeyPair,
    type KeyManagerConfig
} from "./crypto/key-manager.js";

// Re-export crypto index
export * from "./crypto/index.js";

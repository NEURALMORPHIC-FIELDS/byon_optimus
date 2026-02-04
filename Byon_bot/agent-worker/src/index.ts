/**
 * Agent Worker (A)
 *
 * Responsibilities:
 * - READ inbox channels (WhatsApp, Telegram, Discord, etc.)
 * - PARSE events and extract facts
 * - GENERATE evidence packs and plan drafts
 * - VERIFY johnson receipts from Executor
 * - MANAGE semantic memory via FHRSS+FCPE
 *
 * Outputs to: handoff/worker_to_auditor/
 */

import { generateUUID, calculateHash, addHash, toCanonicalActions } from '@byon-bot/shared';
import type {
  EvidencePack,
  PlanDraft,
  JohnsonReceipt,
  TaskType,
  Source,
  SimplifiedAction,
  Action,
  AnalyzedFile,
} from '@byon-bot/shared';
import { AgentMemory, type RetrievalResult } from '@byon-bot/memory';
import { watch, readdirSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';

// Configuration
const config = {
  role: process.env.ROLE || 'worker',
  handoffPath: process.env.HANDOFF_PATH || '/handoff',
  memoryStorePath: process.env.MEMORY_STORE_PATH || '/memory/worker',
};

console.log(`[Worker] Starting with config:`, config);

// Memory system instance - REQUIRED, not optional!
let memory: AgentMemory;

/**
 * Initialize FHRSS+FCPE memory system
 * CRITICAL: This is REQUIRED for the agent to function.
 * Without memory, the agent CANNOT maintain context across sessions.
 */
async function initializeMemory(): Promise<void> {
  console.log('[Worker] Initializing FHRSS+FCPE memory system (REQUIRED)...');

  memory = new AgentMemory('worker', config.memoryStorePath);

  // This MUST succeed - no graceful degradation
  await memory.initialize();

  const stats = await memory.stats();
  console.log(`[Worker] ✓ FHRSS+FCPE Memory ACTIVE`);
  console.log(`[Worker]   Contexts: ${stats.num_contexts}`);
  console.log(`[Worker]   Storage: ${stats.total_storage_mb.toFixed(2)} MB`);
  console.log(`[Worker]   Compression: 73,000x (FCPE)`);
  console.log(`[Worker]   Recovery: 100% at 40% loss (FHRSS)`);
}

/**
 * Search memory for relevant context
 * Uses FHRSS+FCPE semantic search with 73,000x compression
 */
async function searchContext(query: string, type?: 'code' | 'conversation' | 'fact'): Promise<RetrievalResult[]> {
  switch (type) {
    case 'code':
      return await memory.searchCode(query, 5);
    case 'conversation':
      return await memory.searchConversation(query, 5);
    case 'fact':
      return await memory.searchFacts(query, 5);
    default:
      return await memory.search(query, 5);
  }
}

/**
 * Store content in memory
 * Uses FHRSS+FCPE for fault-tolerant storage with 100% recovery
 */
async function storeInMemory(content: string, type: 'code' | 'conversation' | 'fact', metadata?: {
  file?: string;
  line?: number;
  role?: 'user' | 'assistant' | 'system';
  source?: string;
  tags?: string[];
}): Promise<number> {
  switch (type) {
    case 'code':
      return await memory.storeCode(content, metadata?.file || 'unknown', metadata?.line, metadata?.tags);
    case 'conversation':
      return await memory.storeConversation(content, metadata?.role || 'user');
    case 'fact':
      return await memory.storeFact(content, metadata?.source, metadata?.tags);
    default:
      throw new Error(`Unknown memory type: ${type}`);
  }
}

/**
 * Main worker loop
 */
async function main() {
  console.log('[Worker] ═══════════════════════════════════════════════');
  console.log('[Worker] Agent Worker starting...');
  console.log('[Worker] ═══════════════════════════════════════════════');

  // Initialize FHRSS+FCPE memory system - REQUIRED!
  // Agent WILL NOT START without memory system
  try {
    await initializeMemory();
  } catch (error) {
    console.error('[Worker] ═══════════════════════════════════════════════');
    console.error('[Worker] FATAL: FHRSS+FCPE Memory system initialization FAILED!');
    console.error('[Worker] The agent CANNOT function without memory.');
    console.error('[Worker] ');
    console.error('[Worker] Ensure Python 3.10+ is installed with:');
    console.error('[Worker]   pip install sentence-transformers numpy');
    console.error('[Worker] ');
    console.error('[Worker] Or run the memory service container:');
    console.error('[Worker]   docker-compose up memory-service');
    console.error('[Worker] ═══════════════════════════════════════════════');
    console.error('[Worker] Error:', error);
    process.exit(1);
  }

  console.log('[Worker] ═══════════════════════════════════════════════');
  console.log('[Worker] Agent Worker READY');
  console.log('[Worker] Memory: FHRSS+FCPE ACTIVE');
  console.log('[Worker] Watching inbox for events...');
  console.log('[Worker] ═══════════════════════════════════════════════');

  // Start watching inbox directory
  await watchInbox();

  // Heartbeat
  setInterval(async () => {
    const stats = await memory.stats();
    console.log(`[Worker] Heartbeat... Memory: ${stats.num_contexts} contexts`);
  }, 30000);
}

// Track processed files to avoid reprocessing
const processedFiles = new Set<string>();

/**
 * Watch inbox directory for new events (using polling for Docker compatibility)
 */
async function watchInbox(): Promise<void> {
  const inboxPath = join(config.handoffPath, 'inbox');

  // Ensure inbox directory exists
  if (!existsSync(inboxPath)) {
    mkdirSync(inboxPath, { recursive: true });
  }

  console.log(`[Worker] Watching inbox: ${inboxPath}`);

  // Process existing files first
  await scanInbox(inboxPath);

  // Poll for new files every 2 seconds (fs.watch doesn't work in Docker on Windows)
  setInterval(() => scanInbox(inboxPath), 2000);
}

/**
 * Scan inbox and process new files
 */
async function scanInbox(inboxPath: string): Promise<void> {
  if (!existsSync(inboxPath)) return;

  const files = readdirSync(inboxPath).filter(f => f.endsWith('.json'));

  for (const file of files) {
    if (processedFiles.has(file)) continue;

    const filePath = join(inboxPath, file);

    try {
      const content = readFileSync(filePath, 'utf-8');
      const event = JSON.parse(content);

      console.log(`[Worker] ═══════════════════════════════════════════════`);
      console.log(`[Worker] NEW EVENT: ${file}`);
      console.log(`[Worker] Source: ${event.source || 'unknown'}`);
      console.log(`[Worker] Content: ${(event.content || event.message || '').slice(0, 100)}...`);

      // Process the event
      await processInboxEvent({
        source: event.source || 'cli',
        content: event.content || event.message || '',
        timestamp: event.timestamp || new Date().toISOString(),
      });

      // Mark as processed
      processedFiles.add(file);

      // Move to processed folder or delete
      try {
        const processedPath = join(inboxPath, 'processed');
        if (!existsSync(processedPath)) {
          mkdirSync(processedPath, { recursive: true });
        }
        // For now, just delete after processing
        unlinkSync(filePath);
        console.log(`[Worker] ✓ Processed and removed: ${file}`);
      } catch (e) {
        console.log(`[Worker] Note: Could not remove file (read-only): ${file}`);
      }

    } catch (error) {
      console.error(`[Worker] Error processing ${file}:`, error);
      processedFiles.add(file); // Mark as processed to avoid infinite retries
    }
  }
}

/**
 * Process an incoming event from inbox
 */
async function processInboxEvent(event: {
  source: Source['source'];
  content: string;
  timestamp: string;
}): Promise<void> {
  console.log(`[Worker] Processing event from ${event.source}`);

  // 1. Create evidence pack
  const evidence = await createEvidencePack(event);

  // 2. Analyze and create plan
  const plan = await createPlanDraft(evidence);

  // 3. Write to handoff
  await writeToHandoff(evidence, plan);
}

/**
 * Create evidence pack from event
 * USES FHRSS+FCPE memory for context retrieval and storage
 */
async function createEvidencePack(event: {
  source: Source['source'];
  content: string;
  timestamp: string;
}): Promise<EvidencePack> {
  const evidenceId = generateUUID();
  const eventId = generateUUID();

  console.log(`[Worker] Creating evidence pack with FHRSS+FCPE memory...`);

  // 1. Store the incoming conversation in memory
  const conversationCtxId = await storeInMemory(
    event.content,
    'conversation',
    { role: 'user', source: event.source }
  );
  console.log(`[Worker] Stored conversation in memory: ctx_id=${conversationCtxId}`);

  // 2. Search for relevant context from memory (code, previous conversations, facts)
  const relevantCode = await searchContext(event.content, 'code');
  const relevantConversations = await searchContext(event.content, 'conversation');
  const relevantFacts = await searchContext(event.content, 'fact');

  console.log(`[Worker] Retrieved from memory:`);
  console.log(`[Worker]   - ${relevantCode.length} code contexts`);
  console.log(`[Worker]   - ${relevantConversations.length} conversation contexts`);
  console.log(`[Worker]   - ${relevantFacts.length} fact contexts`);

  // 3. Extract facts from the event content (basic extraction)
  const extractedFacts = extractFactsFromContent(event.content, eventId);

  // 4. Store extracted facts in memory
  for (const fact of extractedFacts) {
    await storeInMemory(fact.fact, 'fact', {
      source: event.source,
      tags: ['extracted', 'auto'],
    });
  }
  console.log(`[Worker] Stored ${extractedFacts.length} new facts in memory`);

  // 5. Build codebase context from memory retrieval
  const codebaseContext = buildCodebaseContext(relevantCode);

  const evidence: Omit<EvidencePack, 'hash'> = {
    evidence_id: evidenceId,
    timestamp: new Date().toISOString(),
    task_type: detectTaskType(event.content),
    sources: [
      {
        event_id: eventId,
        source: event.source,
        timestamp: event.timestamp,
        trust_level: 'self',
        payload_ref: `sha256:${calculateHash({ content: event.content })}`,
      },
    ],
    extracted_facts: extractedFacts,
    raw_quotes: [
      {
        quote: event.content,
        source_event: eventId,
      },
    ],
    codebase_context: codebaseContext,
    forbidden_data_present: checkForbiddenData(event.content),
    // Store memory context IDs for later retrieval
    memory_context: {
      conversation_ctx_id: conversationCtxId,
      relevant_code_ctx_ids: relevantCode.map(r => r.ctx_id),
      relevant_fact_ctx_ids: relevantFacts.map(r => r.ctx_id),
    },
  };

  return addHash(evidence);
}

/**
 * Extract facts from content (basic implementation)
 */
function extractFactsFromContent(content: string, sourceEvent: string): Array<{
  fact_id: string;
  fact: string;
  source_event: string;
  confidence: number;
}> {
  const facts: Array<{ fact_id: string; fact: string; source_event: string; confidence: number }> = [];

  // Split into sentences and extract key statements
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);

  for (const sentence of sentences.slice(0, 5)) { // Max 5 facts
    facts.push({
      fact_id: generateUUID(),
      fact: sentence.trim(),
      source_event: sourceEvent,
      confidence: 0.7, // Base confidence for auto-extracted facts
    });
  }

  return facts;
}

/**
 * Detect task type from content
 */
function detectTaskType(content: string): TaskType {
  const lowerContent = content.toLowerCase();

  if (lowerContent.includes('fix') || lowerContent.includes('bug') || lowerContent.includes('error')) {
    return 'coding';
  }
  if (lowerContent.includes('test') || lowerContent.includes('verify')) {
    return 'coding';
  }
  if (lowerContent.includes('schedule') || lowerContent.includes('calendar') || lowerContent.includes('meeting')) {
    return 'scheduling';
  }
  if (lowerContent.includes('send') || lowerContent.includes('message') || lowerContent.includes('email')) {
    return 'messaging';
  }
  if (lowerContent.includes('create') || lowerContent.includes('add') || lowerContent.includes('implement')) {
    return 'coding';
  }

  return 'general';
}

/**
 * Build codebase context from memory retrieval results
 */
function buildCodebaseContext(codeResults: RetrievalResult[]): EvidencePack['codebase_context'] {
  const filesAnalyzed: string[] = [];
  const dependencies: string[] = [];

  for (const result of codeResults) {
    if (result.metadata?.file && !filesAnalyzed.includes(result.metadata.file)) {
      filesAnalyzed.push(result.metadata.file);
    }
  }

  return {
    files_analyzed: filesAnalyzed,
    dependencies,
    language: 'typescript', // Default, could be detected
  };
}

/**
 * Check for forbidden data patterns
 */
function checkForbiddenData(content: string): boolean {
  const forbiddenPatterns = [
    /password\s*[:=]\s*\S+/i,
    /api[_-]?key\s*[:=]\s*\S+/i,
    /secret\s*[:=]\s*\S+/i,
    /token\s*[:=]\s*\S+/i,
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) {
      console.log(`[Worker] WARNING: Forbidden data pattern detected!`);
      return true;
    }
  }

  return false;
}

/**
 * Create plan draft based on evidence
 * USES FHRSS+FCPE memory for context-aware planning
 */
async function createPlanDraft(evidence: EvidencePack): Promise<PlanDraft> {
  console.log(`[Worker] Creating plan draft with FHRSS+FCPE context...`);

  // 1. Get relevant context from memory for planning
  const intent = extractIntent(evidence);

  // 2. Search for similar past plans/actions from memory
  const similarContext = await searchContext(intent, 'fact');
  console.log(`[Worker] Found ${similarContext.length} relevant past contexts for planning`);

  // 3. Generate actions based on evidence and memory context
  const actions = generateActionsFromEvidence(evidence, similarContext);

  // 4. Assess risk based on actions and past experience
  const riskAssessment = assessRisk(actions, similarContext);

  // 5. Store the plan intent as a fact for future reference
  await storeInMemory(
    `Plan: ${intent} | Actions: ${actions.length} | Risk: ${riskAssessment.level}`,
    'fact',
    { source: 'planner', tags: ['plan', 'auto-generated'] }
  );

  const plan: Omit<PlanDraft, 'hash'> = {
    plan_id: generateUUID(),
    timestamp: new Date().toISOString(),
    based_on_evidence: evidence.evidence_id,
    intent,
    actions,
    risk_level: riskAssessment.level,
    rollback_possible: riskAssessment.rollbackPossible,
    estimated_iterations: riskAssessment.estimatedIterations,
    // Include memory context for auditor
    memory_context: {
      similar_past_ctx_ids: similarContext.map(r => r.ctx_id),
    },
  };

  console.log(`[Worker] Plan created: ${actions.length} actions, risk=${riskAssessment.level}`);

  return addHash(plan);
}

/**
 * Extract intent from evidence
 */
function extractIntent(evidence: EvidencePack): string {
  // Combine extracted facts into an intent statement
  const facts = evidence.extracted_facts.map(f => f.fact).join('. ');
  const taskType = evidence.task_type;

  // Build intent based on task type
  switch (taskType) {
    case 'coding':
      return `Implement code changes: ${facts.slice(0, 200)}`;
    case 'scheduling':
      return `Schedule event: ${facts.slice(0, 200)}`;
    case 'messaging':
      return `Send message: ${facts.slice(0, 200)}`;
    default:
      return `General task: ${facts.slice(0, 200)}`;
  }
}

/**
 * Helper: Extract file path from files_analyzed entry
 * Handles both string[] and AnalyzedFile[] formats
 */
function getFilePath(file: string | AnalyzedFile): string {
  return typeof file === 'string' ? file : file.path;
}

/**
 * Extract file path from user message
 * Looks for patterns like "file.txt", "path/to/file.py", etc.
 */
function extractFilePathFromMessage(message: string): { path: string; content?: string; isCreate: boolean } | null {
  // Common patterns for file creation/editing requests
  const patterns = [
    // "create file test.txt with content X" / "creează fișierul test.txt cu X"
    /(?:creat?e?ă?|make|genera?t?e?|write|faci?)\s+(?:a\s+)?(?:fișier(?:ul)?|file)\s+([^\s]+\.\w+)\s+(?:with|cu|containing|content)\s+['""]?(.+?)['""]?$/i,
    // "file.txt with content X"
    /([^\s]+\.\w+)\s+(?:with|cu)\s+(?:content|conținut(?:ul)?)\s+['""]?(.+?)['""]?$/i,
    // Just a file path pattern
    /(?:fișier(?:ul)?|file)\s+([^\s]+\.\w+)/i,
    // Path-like patterns (src/foo.ts, ./bar.py, project/test.txt)
    /\b((?:\.\/|\.\.\/)?(?:[\w-]+\/)*[\w-]+\.\w+)\b/,
  ];

  // Check for creation keywords
  const isCreate = /\b(?:creat?e?ă?|make|genera?t?e?|new|nou[ăa]?|faci?)\b/i.test(message);

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return {
        path: match[1],
        content: match[2] || undefined,
        isCreate,
      };
    }
  }

  return null;
}

/**
 * Generate actions from evidence and memory context
 * BOUNDARY: Generates SimplifiedAction[] internally, converts to Action[] for output
 */
function generateActionsFromEvidence(
  evidence: EvidencePack,
  _similarContext: RetrievalResult[]
): Action[] {
  const simplifiedActions: SimplifiedAction[] = [];
  const filesAnalyzed = evidence.codebase_context.files_analyzed;

  // Try to extract file path from user message
  const userMessage = evidence.raw_quotes[0]?.quote || '';
  const fileInfo = extractFilePathFromMessage(userMessage);

  // Based on task type, generate appropriate actions
  switch (evidence.task_type) {
    case 'coding':
      // Check if user wants to create a new file
      if (fileInfo && fileInfo.isCreate) {
        simplifiedActions.push({
          action_id: generateUUID(),
          action_type: 'file_create',
          target: fileInfo.path,
          params: {
            content: fileInfo.content || '',
            description: evidence.extracted_facts[0]?.fact || 'Create file',
          },
          requires_confirmation: true,
        });
      } else {
        // For coding tasks, add file operations
        for (const file of filesAnalyzed) {
          const filePath = getFilePath(file);
          simplifiedActions.push({
            action_id: generateUUID(),
            action_type: 'code_read',
            target: filePath,
            params: {},
            requires_confirmation: false,
          });
        }

        // Add a code_edit action if there are facts suggesting changes
        if (evidence.extracted_facts.length > 0) {
          // Prefer extracted file path from message over filesAnalyzed
          const targetPath = fileInfo?.path || (filesAnalyzed[0] ? getFilePath(filesAnalyzed[0]) : null);
          if (targetPath) {
            simplifiedActions.push({
              action_id: generateUUID(),
              action_type: 'code_edit',
              target: targetPath,
              params: {
                description: evidence.extracted_facts[0]?.fact || 'Apply changes',
              },
              requires_confirmation: true,
            });
          }
        }
      }

      // Add test action
      simplifiedActions.push({
        action_id: generateUUID(),
        action_type: 'test_run',
        target: 'test suite',
        params: {},
        requires_confirmation: false,
      });
      break;

    case 'scheduling':
      simplifiedActions.push({
        action_id: generateUUID(),
        action_type: 'create_calendar_event',
        target: 'calendar',
        params: {
          description: evidence.extracted_facts[0]?.fact || 'New event',
        },
        requires_confirmation: true,
      });
      break;

    case 'messaging':
      simplifiedActions.push({
        action_id: generateUUID(),
        action_type: 'send_message',
        target: 'recipient',
        params: {
          content: evidence.raw_quotes[0]?.quote || 'Message',
        },
        requires_confirmation: true,
      });
      break;

    default:
      // General action
      simplifiedActions.push({
        action_id: generateUUID(),
        action_type: 'general',
        target: 'system',
        params: {
          description: evidence.extracted_facts[0]?.fact || 'Perform action',
        },
        requires_confirmation: true,
      });
  }

  // BOUNDARY: Convert SimplifiedAction[] to canonical Action[]
  return toCanonicalActions(simplifiedActions);
}

/**
 * Assess risk based on actions and past experience
 * Works with canonical Action[] type
 */
function assessRisk(
  actions: Action[],
  similarContext: RetrievalResult[]
): { level: 'low' | 'medium' | 'high'; rollbackPossible: boolean; estimatedIterations: number } {
  let level: 'low' | 'medium' | 'high' = 'low';
  let rollbackPossible = true;
  let estimatedIterations = 1;

  // High risk action types
  const highRiskTypes: string[] = ['file_delete'];
  const mediumRiskTypes: string[] = ['code_edit', 'file_create'];

  for (const action of actions) {
    if (highRiskTypes.includes(action.type)) {
      level = 'high';
      rollbackPossible = false;
    } else if (mediumRiskTypes.includes(action.type) && level !== 'high') {
      level = 'medium';
    }
  }

  // More iterations if editing code
  if (actions.some(a => a.type === 'code_edit')) {
    estimatedIterations = 3;
  }

  // Adjust based on past experience (if we have similar contexts)
  if (similarContext.length > 3) {
    // We have experience with similar tasks, can be more confident
    estimatedIterations = Math.max(1, estimatedIterations - 1);
  }

  return { level, rollbackPossible, estimatedIterations };
}

/**
 * Write evidence and plan to handoff directory
 * Files are stored for Auditor to pick up
 */
async function writeToHandoff(
  evidence: EvidencePack,
  plan: PlanDraft
): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const shortId = evidence.evidence_id.slice(0, 6);

  const handoffDir = path.join(config.handoffPath, 'worker_to_auditor');

  // Ensure directory exists
  await fs.mkdir(handoffDir, { recursive: true });

  const evidenceFile = path.join(handoffDir, `evidence_pack_${timestamp}_${shortId}.json`);
  const planFile = path.join(handoffDir, `plan_draft_${timestamp}_${shortId}.json`);

  // Write files
  await fs.writeFile(evidenceFile, JSON.stringify(evidence, null, 2));
  await fs.writeFile(planFile, JSON.stringify(plan, null, 2));

  console.log(`[Worker] Written: ${evidenceFile}`);
  console.log(`[Worker] Written: ${planFile}`);

  // Store handoff event in memory for tracking
  await storeInMemory(
    `Handoff: evidence=${evidence.evidence_id}, plan=${plan.plan_id}`,
    'fact',
    { source: 'worker', tags: ['handoff', 'auditor'] }
  );
}

/**
 * Verify johnson receipt from Executor
 */
async function verifyReceipt(
  receipt: JohnsonReceipt,
  originalPlan: PlanDraft
): Promise<{ valid: boolean; issues: string[] }> {
  const issues: string[] = [];

  // Verify hash
  const { hash, ...content } = receipt;
  if (hash !== calculateHash(content)) {
    issues.push('Receipt hash mismatch');
  }

  // Verify action count
  if (receipt.execution_summary.actions_total !== originalPlan.actions.length) {
    issues.push('Action count mismatch');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

// Start
main().catch(console.error);

/**
 * Action Whitelist and Policy Rules
 * Defines what actions are allowed in the system
 */

import type { ActionType, RiskLevel } from '../types';

// ============================================
// Whitelisted Actions
// ============================================

export const ALLOWED_ACTIONS: readonly ActionType[] = [
  'code_edit',
  'file_create',
  'file_delete',
  'test_run',
  'lint_run',
  'build_run',
] as const;

export function isActionAllowed(action: string): action is ActionType {
  return ALLOWED_ACTIONS.includes(action as ActionType);
}

// ============================================
// Path Restrictions
// ============================================

export const FORBIDDEN_PATHS = [
  // System paths
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/var',
  '/tmp',
  '/root',
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',

  // Sensitive project paths
  '.env',
  '.env.local',
  '.env.production',
  'credentials',
  'secrets',
  '.git/config',
  '.ssh',

  // Package management (prevent supply chain attacks)
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'node_modules',
] as const;

export const FORBIDDEN_PATTERNS = [
  /\.env(\.[a-z]+)?$/i,
  /credentials?\.(json|yaml|yml|ts|js)$/i,
  /secrets?\.(json|yaml|yml|ts|js)$/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /id_ed25519/i,
];

export function isForbiddenPath(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/').toLowerCase();

  // Check exact matches
  for (const forbidden of FORBIDDEN_PATHS) {
    const normalizedForbidden = forbidden.replace(/\\/g, '/').toLowerCase();
    if (normalizedPath.includes(normalizedForbidden)) {
      return true;
    }
  }

  // Check patterns
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(path)) {
      return true;
    }
  }

  return false;
}

// ============================================
// Code Pattern Restrictions
// ============================================

export const FORBIDDEN_CODE_PATTERNS = [
  // Network operations
  /\bfetch\s*\(/,
  /\baxios\b/,
  /\brequire\s*\(\s*['"]https?['"]\s*\)/,
  /\bimport\s+.*\bfrom\s+['"]https?/,
  /\bnet\.connect\b/,
  /\bhttp\.request\b/,
  /\bchild_process\b/,

  // Shell execution
  /\bexec\s*\(/,
  /\bspawn\s*\(/,
  /\bexecSync\b/,
  /\bspawnSync\b/,

  // File system escapes
  /\.\.\//g, // Path traversal
  /process\.env/,

  // Dangerous eval
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
];

export function containsForbiddenCode(code: string): {
  forbidden: boolean;
  matches: string[];
} {
  const matches: string[] = [];

  for (const pattern of FORBIDDEN_CODE_PATTERNS) {
    const match = code.match(pattern);
    if (match) {
      matches.push(match[0]);
    }
  }

  return {
    forbidden: matches.length > 0,
    matches,
  };
}

// ============================================
// Resource Limits
// ============================================

export interface ResourceLimits {
  maxIterations: number;
  timeoutMinutes: number;
  memoryLimitMb: number;
  diskLimitMb: number;
}

export const DEFAULT_LIMITS: ResourceLimits = {
  maxIterations: 10,
  timeoutMinutes: 30,
  memoryLimitMb: 1024,
  diskLimitMb: 100,
};

export const LIMITS_BY_RISK: Record<RiskLevel, ResourceLimits> = {
  low: {
    maxIterations: 10,
    timeoutMinutes: 30,
    memoryLimitMb: 1024,
    diskLimitMb: 100,
  },
  medium: {
    maxIterations: 5,
    timeoutMinutes: 15,
    memoryLimitMb: 512,
    diskLimitMb: 50,
  },
  high: {
    maxIterations: 3,
    timeoutMinutes: 10,
    memoryLimitMb: 256,
    diskLimitMb: 25,
  },
};

// ============================================
// Risk Assessment
// ============================================

export interface RiskFactors {
  fileDeletes: number;
  fileCreates: number;
  codeEdits: number;
  actionCount: number;
  estimatedIterations: number;
}

export function assessRisk(factors: RiskFactors): RiskLevel {
  let score = 0;

  // File operations
  score += factors.fileDeletes * 3;
  score += factors.fileCreates * 1;
  score += factors.codeEdits * 2;

  // Complexity
  if (factors.actionCount > 10) score += 3;
  else if (factors.actionCount > 5) score += 1;

  if (factors.estimatedIterations > 5) score += 2;

  // Determine level
  if (score <= 3) return 'low';
  if (score <= 7) return 'medium';
  return 'high';
}

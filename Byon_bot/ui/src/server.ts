/**
 * Byon Bot Web UI Server
 *
 * Provides web interface for:
 * - Approval of execution orders
 * - Monitoring agent activity
 * - Viewing audit trail history
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Configuration
const PORT = process.env.UI_PORT || 3000;
const HANDOFF_PATH = process.env.HANDOFF_PATH || join(__dirname, '../../handoff');

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// WebSocket connections for real-time updates
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('[UI] Client connected');

  ws.on('close', () => {
    clients.delete(ws);
    console.log('[UI] Client disconnected');
  });
});

// Broadcast to all clients
function broadcast(data: object): void {
  const message = JSON.stringify(data);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// API Routes

/**
 * Send message to inbox
 */
app.post('/api/inbox', async (req, res) => {
  try {
    const { message, source = 'ui' } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    const inboxPath = join(HANDOFF_PATH, 'inbox');

    // Ensure inbox directory exists
    if (!existsSync(inboxPath)) {
      const { mkdir } = await import('fs/promises');
      await mkdir(inboxPath, { recursive: true });
    }

    // Generate event ID
    const timestamp = Date.now();
    const randomPart = Math.random().toString(36).substring(2, 8);
    const eventId = `evt_${timestamp}_${randomPart}`;

    // Create inbox file
    const filename = `inbox_${eventId}.json`;
    const event = {
      event_id: eventId,
      source,
      content: message,
      timestamp: new Date().toISOString(),
    };

    await writeFile(join(inboxPath, filename), JSON.stringify(event, null, 2));

    res.json({
      success: true,
      eventId,
      message: 'Message sent to inbox',
    });

    // Notify WebSocket clients
    broadcast({ type: 'inbox', event });
  } catch (error) {
    console.error('Inbox error:', error);
    res.status(500).json({ success: false, error: String(error) });
  }
});

/**
 * Get system status
 */
app.get('/api/status', async (req, res) => {
  try {
    const status = {
      agents: {
        worker: { status: 'running', lastActivity: new Date().toISOString() },
        auditor: { status: 'running', lastActivity: new Date().toISOString() },
        executor: { status: 'idle', lastActivity: null },
      },
      handoff: {
        path: HANDOFF_PATH,
        exists: existsSync(HANDOFF_PATH),
      },
      memory: {
        status: 'active',
        type: 'FHRSS+FCPE',
      },
    };
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Get pending approval requests
 */
app.get('/api/approvals', async (req, res) => {
  try {
    const approvalsPath = join(HANDOFF_PATH, 'auditor_to_user');

    if (!existsSync(approvalsPath)) {
      return res.json({ approvals: [] });
    }

    const files = await readdir(approvalsPath);
    const approvals = [];

    for (const file of files) {
      if (file.startsWith('approval_request_') && file.endsWith('.json')) {
        const content = await readFile(join(approvalsPath, file), 'utf-8');
        const data = JSON.parse(content);
        approvals.push({
          id: file.replace('.json', ''),
          filename: file,
          ...data,
        });
      }
    }

    // Sort by timestamp (newest first)
    approvals.sort((a, b) =>
      new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
    );

    res.json({ approvals });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Get a specific approval request
 */
app.get('/api/approvals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const filePath = join(HANDOFF_PATH, 'auditor_to_user', `${id}.json`);

    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'Approval request not found' });
    }

    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    res.json({ approval: { id, ...data } });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Approve an execution order
 */
app.post('/api/approvals/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const requestPath = join(HANDOFF_PATH, 'auditor_to_user', `${id}.json`);

    if (!existsSync(requestPath)) {
      return res.status(404).json({ error: 'Approval request not found' });
    }

    const content = await readFile(requestPath, 'utf-8');
    const request = JSON.parse(content);

    // Create execution order
    const executionOrder = {
      order_id: `exec_${Date.now()}`,
      approval_id: id,
      plan: request.plan,
      approved_at: new Date().toISOString(),
      approved_by: 'user',
      signature: 'TODO_IMPLEMENT_ED25519_SIGNATURE',
    };

    // Write to executor input
    const orderPath = join(
      HANDOFF_PATH,
      'user_to_executor',
      `execution_order_${Date.now()}.json`
    );
    await writeFile(orderPath, JSON.stringify(executionOrder, null, 2));

    // Broadcast update
    broadcast({
      type: 'approval_processed',
      id,
      action: 'approved',
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, order_id: executionOrder.order_id });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Reject an execution order
 */
app.post('/api/approvals/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const requestPath = join(HANDOFF_PATH, 'auditor_to_user', `${id}.json`);

    if (!existsSync(requestPath)) {
      return res.status(404).json({ error: 'Approval request not found' });
    }

    // Create rejection record
    const rejection = {
      approval_id: id,
      rejected_at: new Date().toISOString(),
      rejected_by: 'user',
      reason: reason || 'User rejected the request',
    };

    // Write rejection (could be used by Worker for learning)
    const rejectionPath = join(
      HANDOFF_PATH,
      'user_to_executor',
      `rejection_${Date.now()}.json`
    );
    await writeFile(rejectionPath, JSON.stringify(rejection, null, 2));

    // Broadcast update
    broadcast({
      type: 'approval_processed',
      id,
      action: 'rejected',
      reason,
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Get execution receipts (johnson_receipts)
 */
app.get('/api/receipts', async (req, res) => {
  try {
    const receiptsPath = join(HANDOFF_PATH, 'executor_to_worker');

    if (!existsSync(receiptsPath)) {
      return res.json({ receipts: [] });
    }

    const files = await readdir(receiptsPath);
    const receipts = [];

    for (const file of files) {
      if (file.startsWith('johnson_receipt_') && file.endsWith('.json')) {
        const content = await readFile(join(receiptsPath, file), 'utf-8');
        const data = JSON.parse(content);
        receipts.push({
          id: file.replace('.json', ''),
          filename: file,
          ...data,
        });
      }
    }

    // Sort by timestamp (newest first)
    receipts.sort((a, b) =>
      new Date(b.executed_at || 0).getTime() - new Date(a.executed_at || 0).getTime()
    );

    res.json({ receipts });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Get audit trail history
 */
app.get('/api/history', async (req, res) => {
  try {
    const { date, week, type, status, limit = '50' } = req.query;

    // Import audit functions dynamically
    const auditModule = await import('@byon-bot/shared');

    const options: Record<string, unknown> = {
      limit: parseInt(limit as string, 10),
    };

    if (date) options.day = date;
    if (week) options.week = week;
    if (type) options.doc_type = type;
    if (status) options.status = status;

    const result = await auditModule.queryDocuments(options as any);

    res.json({
      documents: result.documents,
      total_count: result.total_count,
      query_time_ms: result.query_time_ms,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Get audit statistics
 */
app.get('/api/history/stats', async (req, res) => {
  try {
    const auditModule = await import('@byon-bot/shared');
    const stats = auditModule.getAuditStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Delete a draft document (user only)
 */
app.delete('/api/history/:docId', async (req, res) => {
  try {
    const { docId } = req.params;
    const { reason } = req.body;

    const auditModule = await import('@byon-bot/shared');
    const result = auditModule.deleteDocument(docId, 'user', reason);

    if (result.success) {
      broadcast({
        type: 'document_deleted',
        doc_id: docId,
        timestamp: new Date().toISOString(),
      });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Serve index.html for all other routes (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../public/index.html'));
});

// Start server
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║  BYON BOT - Web UI                                        ║
║  http://localhost:${PORT}                                     ║
╠═══════════════════════════════════════════════════════════╣
║  Endpoints:                                               ║
║  - Dashboard:  /                                          ║
║  - Approvals:  /approvals                                 ║
║  - History:    /history                                   ║
║  - API:        /api/*                                     ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

export { app, server };

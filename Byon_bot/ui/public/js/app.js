/**
 * Byon Bot Web UI - Client-side JavaScript
 */

let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Initialize WebSocket connection
 */
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WS] Connected');
    reconnectAttempts = 0;
    updateConnectionStatus(true);
  };

  ws.onclose = () => {
    console.log('[WS] Disconnected');
    updateConnectionStatus(false);

    // Attempt to reconnect
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      console.log(`[WS] Reconnecting... (attempt ${reconnectAttempts})`);
      setTimeout(initWebSocket, 2000 * reconnectAttempts);
    }
  };

  ws.onerror = (error) => {
    console.error('[WS] Error:', error);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWebSocketMessage(data);
    } catch (error) {
      console.error('[WS] Failed to parse message:', error);
    }
  };
}

/**
 * Handle incoming WebSocket messages
 */
function handleWebSocketMessage(data) {
  console.log('[WS] Message:', data);

  switch (data.type) {
    case 'approval_processed':
      showNotification(
        `Approval ${data.id.slice(0, 8)}... ${data.action}`,
        data.action === 'approved' ? 'success' : 'info'
      );
      // Reload relevant data if on the right page
      if (typeof loadApprovals === 'function') {
        loadApprovals();
      }
      if (typeof loadDashboard === 'function') {
        loadDashboard();
      }
      break;

    case 'document_deleted':
      showNotification(`Document ${data.doc_id.slice(0, 8)}... deleted`, 'info');
      if (typeof loadDocuments === 'function') {
        loadDocuments();
        loadStats();
      }
      break;

    case 'new_approval':
      showNotification('New approval request received!', 'info');
      if (typeof loadApprovals === 'function') {
        loadApprovals();
      }
      if (typeof loadPendingApprovals === 'function') {
        loadPendingApprovals();
      }
      break;

    case 'execution_complete':
      showNotification(
        `Execution ${data.status}: ${data.order_id}`,
        data.status === 'success' ? 'success' : 'error'
      );
      if (typeof loadRecentReceipts === 'function') {
        loadRecentReceipts();
      }
      break;

    default:
      console.log('[WS] Unknown message type:', data.type);
  }
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('connection-status');
  const dotEl = document.querySelector('.status-dot');

  if (statusEl) {
    statusEl.textContent = connected ? 'Connected' : 'Disconnected';
  }

  if (dotEl) {
    dotEl.classList.toggle('online', connected);
    dotEl.classList.toggle('offline', !connected);
  }
}

/**
 * Show notification toast
 */
function showNotification(message, type = 'info') {
  // Remove existing notification
  const existing = document.querySelector('.notification');
  if (existing) {
    existing.remove();
  }

  // Create new notification
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;

  document.body.appendChild(notification);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    notification.remove();
  }, 5000);
}

/**
 * Format relative time
 */
function formatTime(isoString) {
  if (!isoString) return '-';

  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString();
}

/**
 * Format date for display
 */
function formatDate(isoString) {
  if (!isoString) return '-';
  return new Date(isoString).toLocaleDateString();
}

/**
 * Format date and time for display
 */
function formatDateTime(isoString) {
  if (!isoString) return '-';
  return new Date(isoString).toLocaleString();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showNotification('Copied to clipboard', 'success');
  } catch (error) {
    console.error('Failed to copy:', error);
    showNotification('Failed to copy', 'error');
  }
}

/**
 * API helper
 */
async function api(endpoint, options = {}) {
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const response = await fetch(endpoint, { ...defaultOptions, ...options });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Export for use in other scripts
window.byonUI = {
  initWebSocket,
  showNotification,
  formatTime,
  formatDate,
  formatDateTime,
  escapeHtml,
  copyToClipboard,
  api,
};

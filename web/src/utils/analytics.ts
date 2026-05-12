/**
 * Analytics utilities for anonymous user tracking.
 * 
 * This module provides:
 * - Anonymous user ID generation (stored in localStorage)
 * - Session management
 * - Analytics headers for API requests
 * 
 * IMPORTANT: No credentials (API keys, PATs) are ever sent to analytics.
 */

const ANALYTICS_USER_ID_KEY = 'cipilot_analytics_user_id';
const ANALYTICS_SESSION_ID_KEY = 'cipilot_analytics_session_id';

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  // Use crypto.randomUUID if available (modern browsers)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get or create anonymous user ID.
 * Stored in localStorage to persist across sessions.
 */
export function getAnonymousUserId(): string {
  let userId = localStorage.getItem(ANALYTICS_USER_ID_KEY);
  
  if (!userId) {
    userId = generateUUID();
    localStorage.setItem(ANALYTICS_USER_ID_KEY, userId);
  }
  
  return userId;
}

/**
 * Get current session ID (created per browser session).
 */
export function getSessionId(): string | null {
  return sessionStorage.getItem(ANALYTICS_SESSION_ID_KEY);
}

/**
 * Set session ID (received from backend after session creation).
 */
export function setSessionId(sessionId: string | number): void {
  sessionStorage.setItem(ANALYTICS_SESSION_ID_KEY, String(sessionId));
}

/**
 * Get analytics headers to include in API requests.
 * These are safe, anonymous identifiers - no credentials.
 */
export function getAnalyticsHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Analytics-User-ID': getAnonymousUserId(),
  };
  
  const sessionId = getSessionId();
  if (sessionId) {
    headers['X-Analytics-Session-ID'] = sessionId;
  }
  
  // Add timezone for location estimation
  try {
    headers['X-Timezone'] = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Ignore if not available
  }
  
  return headers;
}

/**
 * Initialize analytics session with the backend.
 * Should be called once when the app loads.
 */
export async function initAnalyticsSession(apiBaseUrl: string): Promise<void> {
  // Skip if session already exists
  if (getSessionId()) {
    return;
  }
  
  try {
    const response = await fetch(`${apiBaseUrl}/analytics/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAnalyticsHeaders(),
      },
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.session_id) {
        setSessionId(data.session_id);
        console.log('[Analytics] Session initialized:', data.session_id);
      }
    }
  } catch (error) {
    // Analytics should never break the app
    console.warn('[Analytics] Failed to initialize session:', error);
  }
}

/**
 * Clear analytics data (for privacy/logout).
 */
export function clearAnalyticsData(): void {
  localStorage.removeItem(ANALYTICS_USER_ID_KEY);
  sessionStorage.removeItem(ANALYTICS_SESSION_ID_KEY);
}

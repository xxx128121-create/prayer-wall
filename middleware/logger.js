const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

const logPath = path.join(logsDir, 'app.jsonl');

/**
 * Hash an IP address for privacy (we never store raw IPs)
 */
function hashIP(ip) {
    if (!ip) return null;
    return crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
}

/**
 * Log an event in structured JSON format
 * @param {string} eventType - Event type (e.g., 'data.create_prayer', 'admin.approve')
 * @param {Object} data - Event data (will be sanitized)
 */
function logEvent(eventType, data = {}) {
    const event = {
        timestamp: new Date().toISOString(),
        event: eventType,
        ...sanitizeData(data)
    };

    const line = JSON.stringify(event) + '\n';

    fs.appendFileSync(logPath, line, 'utf8');

    // Also log to console in development
    if (process.env.NODE_ENV !== 'production') {
        console.log(`[LOG] ${eventType}`, data.prayerId ? `prayer:${data.prayerId}` : '');
    }
}

/**
 * Sanitize data to remove sensitive information
 */
function sanitizeData(data) {
    const sanitized = { ...data };

    // Never log these fields
    const sensitiveFields = ['password', 'passwordHash', 'content', 'sessionId', 'token'];

    for (const field of sensitiveFields) {
        if (sanitized[field]) {
            sanitized[field] = '[REDACTED]';
        }
    }

    // Hash IP if present
    if (sanitized.ip) {
        sanitized.ipHash = hashIP(sanitized.ip);
        delete sanitized.ip;
    }

    return sanitized;
}

/**
 * Event types used in the application
 */
const EventTypes = {
    // Data events
    CREATE_PRAYER: 'data.create_prayer',

    // Admin events
    ADMIN_LOGIN: 'auth.login',
    ADMIN_LOGIN_FAIL: 'auth.fail',
    ADMIN_LOGOUT: 'auth.logout',
    ADMIN_APPROVE: 'admin.approve',
    ADMIN_REJECT: 'admin.reject',
    ADMIN_EXTEND: 'admin.extend',
    ADMIN_CREATE: 'admin.create',
    ADMIN_DELETE: 'admin.delete',
    ADMIN_PASSWORD_CHANGE: 'admin.password_change',

    // Digest events
    DIGEST_GENERATE: 'digest.generate',
    DIGEST_COPY: 'digest.copy',

    // Security events
    RATE_LIMIT: 'security.rate_limit',
    SENSITIVE_CONTENT_WARNING: 'security.sensitive_content'
};

module.exports = {
    logEvent,
    hashIP,
    EventTypes
};

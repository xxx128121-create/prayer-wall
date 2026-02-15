const { logEvent, hashIP, EventTypes } = require('./logger');

/**
 * Rate limit middleware for prayer submissions
 * Allows 3 submissions per IP per 5 minutes
 */
function submissionRateLimit(db) {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress;
        const ipHash = hashIP(ip);

        // Check recent submissions from this IP
        const result = db.prayerOps.countRecentByIp.get(ipHash);
        const count = result ? result.count : 0;

        if (count >= 3) {
            logEvent(EventTypes.RATE_LIMIT, {
                ip,
                type: 'submission',
                count
            });

            return res.status(429).render('error', {
                title: '請稍後再試',
                message: '你提交得太頻繁了，請等 5 分鐘後再試。',
                csrfToken: req.csrfToken ? req.csrfToken() : ''
            });
        }

        req.ipHash = ipHash;
        next();
    };
}

/**
 * Simple in-memory rate limit for admin login
 * Allows 5 attempts per IP per 15 minutes
 */
const loginAttempts = new Map();

function loginRateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const ipHash = hashIP(ip);
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutes

    // Clean old entries
    const attempts = loginAttempts.get(ipHash) || [];
    const recentAttempts = attempts.filter(time => now - time < windowMs);

    if (recentAttempts.length >= 5) {
        logEvent(EventTypes.RATE_LIMIT, {
            ip,
            type: 'login',
            count: recentAttempts.length
        });

        return res.status(429).render('admin/login', {
            error: '登入嘗試太多次，請等 15 分鐘後再試。',
            csrfToken: req.csrfToken ? req.csrfToken() : ''
        });
    }

    // Record this attempt
    recentAttempts.push(now);
    loginAttempts.set(ipHash, recentAttempts);

    next();
}

/**
 * Clear login attempts on successful login
 */
function clearLoginAttempts(ip) {
    const ipHash = hashIP(ip);
    loginAttempts.delete(ipHash);
}

module.exports = {
    submissionRateLimit,
    loginRateLimit,
    clearLoginAttempts
};

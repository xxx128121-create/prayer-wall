const express = require('express');
const router = express.Router();
const { logEvent, EventTypes } = require('../middleware/logger');
const { submissionRateLimit } = require('../middleware/rate-limit');

// Patterns to detect potentially sensitive content
const sensitivePatterns = [
    { pattern: /\b[\w.-]+@[\w.-]+\.\w{2,}\b/i, type: 'email' },
    { pattern: /\b\d{8,}\b/, type: 'phone' },
    { pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/, type: 'card' }
];

function checkSensitiveContent(content) {
    const warnings = [];
    for (const { pattern, type } of sensitivePatterns) {
        if (pattern.test(content)) {
            warnings.push(type);
        }
    }
    return warnings;
}

module.exports = function (db) {
    // Show submission form
    router.get('/submit', (req, res) => {
        res.render('submit', {
            title: '提交代禱',
            csrfToken: req.csrfToken(),
            success: null,
            error: null,
            warning: null
        });
    });

    // Handle prayer submission
    router.post('/submit', submissionRateLimit(db), (req, res) => {
        const { displayName, content, confirmSensitive } = req.body;

        // Validate content
        if (!content || content.trim().length === 0) {
            return res.render('submit', {
                title: '提交代禱',
                csrfToken: req.csrfToken(),
                success: null,
                error: '請輸入代禱內容',
                warning: null
            });
        }

        if (content.length > 1000) {
            return res.render('submit', {
                title: '提交代禱',
                csrfToken: req.csrfToken(),
                success: null,
                error: '代禱內容不能超過 1000 字',
                warning: null
            });
        }

        // Check for sensitive content
        const warnings = checkSensitiveContent(content);
        if (warnings.length > 0 && !confirmSensitive) {
            logEvent(EventTypes.SENSITIVE_CONTENT_WARNING, {
                ip: req.ip,
                detectedTypes: warnings
            });

            return res.render('submit', {
                title: '提交代禱',
                csrfToken: req.csrfToken(),
                success: null,
                error: null,
                warning: '偵測到可能包含敏感資料（如電郵、電話）。如確認要提交，請勾選下方確認框。',
                content,
                displayName
            });
        }

        // Create prayer
        try {
            // Calculate duration days from expiry date
            let durationDays = 7; // Default
            if (req.body.expiryDate) {
                const expiryDate = new Date(req.body.expiryDate);
                const now = new Date();
                // Reset time part for accurate day calculation
                expiryDate.setHours(0, 0, 0, 0);
                now.setHours(0, 0, 0, 0);

                const diffTime = expiryDate - now;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays > 0) {
                    durationDays = diffDays;
                }
            }

            const result = db.prayerOps.create.run({
                displayName: displayName ? displayName.trim().substring(0, 50) : null,
                content: content.trim(),
                ipHash: req.ipHash,
                durationDays
            });

            // Log the event (without content for privacy)
            logEvent(EventTypes.CREATE_PRAYER, {
                prayerId: result.lastInsertRowid,
                ip: req.ip,
                hasDisplayName: !!displayName,
                durationDays
            });

            // Also log to database audit
            db.auditOps.log.run({
                eventType: EventTypes.CREATE_PRAYER,
                prayerId: result.lastInsertRowid,
                adminUsername: null,
                ipHash: req.ipHash,
                details: JSON.stringify({ hasDisplayName: !!displayName, durationDays })
            });

            res.render('submit', {
                title: '提交代禱',
                csrfToken: req.csrfToken(),
                success: '代禱已提交，等待審批後會公開。感謝你！',
                error: null,
                warning: null
            });
        } catch (err) {
            console.error('Error creating prayer:', err);
            res.render('submit', {
                title: '提交代禱',
                csrfToken: req.csrfToken(),
                success: null,
                error: '提交失敗，請稍後再試',
                warning: null
            });
        }
    });

    return router;
};

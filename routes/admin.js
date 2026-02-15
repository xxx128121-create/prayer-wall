const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { requireAdmin } = require('../middleware/auth');
const { loginRateLimit, clearLoginAttempts } = require('../middleware/rate-limit');
const { logEvent, hashIP, EventTypes } = require('../middleware/logger');

module.exports = function (db) {
    function normalizeExpiryDate(input) {
        if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
        const selected = new Date(input + 'T00:00:00');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (selected < today) return null;
        return input + ' 23:59:59';
    }

    // Login page
    router.get('/login', (req, res) => {
        if (req.session && req.session.admin) {
            return res.redirect('/admin');
        }
        res.render('admin/login', {
            title: 'Admin 登入',
            csrfToken: req.csrfToken(),
            error: null
        });
    });

    // Handle login
    router.post('/login', loginRateLimit, (req, res) => {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.render('admin/login', {
                title: 'Admin 登入',
                csrfToken: req.csrfToken(),
                error: '請輸入帳號和密碼'
            });
        }

        const admin = db.adminOps.getByUsername.get(username);

        if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
            logEvent(EventTypes.ADMIN_LOGIN_FAIL, { username, ip: req.ip });
            db.auditOps.log.run({
                eventType: EventTypes.ADMIN_LOGIN_FAIL,
                prayerId: null,
                adminUsername: username,
                ipHash: hashIP(req.ip),
                details: JSON.stringify({ success: false })
            });
            return res.render('admin/login', {
                title: 'Admin 登入',
                csrfToken: req.csrfToken(),
                error: '帳號或密碼錯誤'
            });
        }

        clearLoginAttempts(req.ip);
        req.session.admin = { id: admin.id, username: admin.username };

        logEvent(EventTypes.ADMIN_LOGIN, { username: admin.username, ip: req.ip });
        db.auditOps.log.run({
            eventType: EventTypes.ADMIN_LOGIN,
            prayerId: null,
            adminUsername: admin.username,
            ipHash: hashIP(req.ip),
            details: JSON.stringify({ success: true })
        });

        const returnTo = req.session.returnTo || '/admin';
        delete req.session.returnTo;
        res.redirect(returnTo);
    });

    // Logout
    router.post('/logout', (req, res) => {
        const username = req.session.admin ? req.session.admin.username : null;
        if (username) {
            logEvent(EventTypes.ADMIN_LOGOUT, { username, ip: req.ip });
        }
        req.session.destroy(() => res.redirect('/'));
    });

    // Dashboard
    router.get('/', requireAdmin, (req, res) => {
        const pendingPrayers = db.prayerOps.getPending.all();
        const approvedPrayers = db.prayerOps.getApproved.all();
        const expiredPrayers = db.prayerOps.getExpired.all();
        const rejectedPrayers = db.prayerOps.getRejected.all();

        res.render('admin/dashboard', {
            title: 'Admin Dashboard',
            csrfToken: req.csrfToken(),
            pendingPrayers,
            approvedPrayers,
            expiredPrayers,
            rejectedPrayers,
            approvedCount: approvedPrayers.length,
            pendingCount: pendingPrayers.length,
            expiredCount: expiredPrayers.length,
            rejectedCount: rejectedPrayers.length
        });
    });

    // Approve prayer
    router.post('/approve/:id', requireAdmin, (req, res) => {
        const prayerId = parseInt(req.params.id, 10);
        const adminUsername = req.session.admin.username;

        const prayer = db.prayerOps.getById.get(prayerId);
        if (!prayer || prayer.status !== 'PENDING') {
            return res.redirect('/admin');
        }

        db.prayerOps.approve.run({ id: prayerId, adminUsername });
        logEvent(EventTypes.ADMIN_APPROVE, { prayerId, adminUsername, ip: req.ip });
        db.auditOps.log.run({
            eventType: EventTypes.ADMIN_APPROVE,
            prayerId,
            adminUsername,
            ipHash: hashIP(req.ip),
            details: null
        });

        res.redirect('/admin');
    });

    // Reject prayer
    router.post('/reject/:id', requireAdmin, (req, res) => {
        const prayerId = parseInt(req.params.id, 10);
        const adminUsername = req.session.admin.username;

        const prayer = db.prayerOps.getById.get(prayerId);
        // Allow rejecting if status is PENDING or APPROVED
        if (!prayer || (prayer.status !== 'PENDING' && prayer.status !== 'APPROVED')) {
            return res.redirect('/admin');
        }

        db.prayerOps.reject.run({ id: prayerId, adminUsername });
        logEvent(EventTypes.ADMIN_REJECT, { prayerId, adminUsername, ip: req.ip });
        db.auditOps.log.run({
            eventType: EventTypes.ADMIN_REJECT,
            prayerId,
            adminUsername,
            ipHash: hashIP(req.ip),
            details: null
        });

        res.redirect('/admin');
    });

    // Extend expiry by 7 days
    router.post('/extend/:id', requireAdmin, (req, res) => {
        const prayerId = parseInt(req.params.id, 10);
        const adminUsername = req.session.admin.username;

        const prayer = db.prayerOps.getById.get(prayerId);
        if (!prayer || prayer.status !== 'APPROVED') {
            return res.redirect('/admin');
        }

        db.prayerOps.extendExpiry.run({ id: prayerId });
        logEvent(EventTypes.ADMIN_EXTEND, { prayerId, adminUsername, ip: req.ip });
        db.auditOps.log.run({
            eventType: 'admin.extend',
            prayerId,
            adminUsername,
            ipHash: hashIP(req.ip),
            details: null
        });

        res.redirect('/admin');
    });

    // Set expiry date (approved)
    router.post('/set-expiry/:id', requireAdmin, (req, res) => {
        const prayerId = parseInt(req.params.id, 10);
        const adminUsername = req.session.admin.username;
        const expiresAt = normalizeExpiryDate(req.body.expiresAt);

        const prayer = db.prayerOps.getById.get(prayerId);
        if (!prayer || prayer.status !== 'APPROVED' || !expiresAt) {
            return res.redirect('/admin');
        }

        db.prayerOps.setExpiryDate.run({ id: prayerId, expiresAt });
        logEvent(EventTypes.ADMIN_SET_EXPIRY, { prayerId, adminUsername, ip: req.ip });
        db.auditOps.log.run({
            eventType: 'admin.set_expiry',
            prayerId,
            adminUsername,
            ipHash: hashIP(req.ip),
            details: JSON.stringify({ expiresAt })
        });

        res.redirect('/admin');
    });

    // Recover rejected prayer with expiry date
    router.post('/recover/:id', requireAdmin, (req, res) => {
        const prayerId = parseInt(req.params.id, 10);
        const adminUsername = req.session.admin.username;
        const expiresAt = normalizeExpiryDate(req.body.expiresAt);

        const prayer = db.prayerOps.getById.get(prayerId);
        if (!prayer || prayer.status !== 'REJECTED' || !expiresAt) {
            return res.redirect('/admin');
        }

        db.prayerOps.recoverWithExpiry.run({ id: prayerId, adminUsername, expiresAt });
        logEvent(EventTypes.ADMIN_RECOVER, { prayerId, adminUsername, ip: req.ip });
        db.auditOps.log.run({
            eventType: 'admin.recover',
            prayerId,
            adminUsername,
            ipHash: hashIP(req.ip),
            details: JSON.stringify({ expiresAt })
        });

        res.redirect('/admin');
    });

    // Edit prayer (pending/approved)
    router.post('/edit/:id', requireAdmin, (req, res) => {
        const prayerId = parseInt(req.params.id, 10);
        const adminUsername = req.session.admin.username;
        const displayName = req.body.displayName ? req.body.displayName.trim().substring(0, 50) : null;
        const content = req.body.content ? req.body.content.trim() : '';

        if (!content || content.length === 0 || content.length > 1000) {
            return res.redirect('/admin');
        }

        const prayer = db.prayerOps.getById.get(prayerId);
        if (!prayer || (prayer.status !== 'PENDING' && prayer.status !== 'APPROVED')) {
            return res.redirect('/admin');
        }

        db.prayerOps.updateContent.run({
            id: prayerId,
            displayName: displayName || null,
            content
        });

        logEvent(EventTypes.ADMIN_EDIT, { prayerId, adminUsername, ip: req.ip });
        db.auditOps.log.run({
            eventType: 'admin.edit',
            prayerId,
            adminUsername,
            ipHash: hashIP(req.ip),
            details: JSON.stringify({ updatedFields: ['display_name', 'content'] })
        });

        res.redirect('/admin');
    });

    // Digest page - generate text summary for WhatsApp
    router.get('/digest', requireAdmin, (req, res) => {
        const approvedPrayers = db.prayerOps.getApproved.all();
        const now = new Date();
        const dateStr = now.toLocaleDateString('zh-HK');

        // Generate digest text
        let digestText = `🙏 教會代禱事項 (${dateStr})\n\n`;
        approvedPrayers.forEach((prayer, index) => {
            const name = prayer.display_name || '匿名';
            // Truncate content to first 50 chars for privacy
            const shortContent = prayer.content.length > 50
                ? prayer.content.substring(0, 50) + '...'
                : prayer.content;
            digestText += `${index + 1}. ${name}: ${shortContent}\n`;
        });
        digestText += `\n願主垂聽我們的禱告 🙏`;

        logEvent(EventTypes.DIGEST_GENERATE, { adminUsername: req.session.admin.username, count: approvedPrayers.length });
        db.auditOps.log.run({
            eventType: 'digest.generate',
            prayerId: null,
            adminUsername: req.session.admin.username,
            ipHash: hashIP(req.ip),
            details: JSON.stringify({ count: approvedPrayers.length })
        });

        res.render('admin/digest', {
            title: '代禱摘要',
            csrfToken: req.csrfToken(),
            digestText,
            prayerCount: approvedPrayers.length,
            dateStr
        });
    });

    // Settings page - manage admins
    router.get('/settings', requireAdmin, (req, res) => {
        const admins = db.adminOps.getAll.all();
        res.render('admin/settings', {
            title: '設定',
            csrfToken: req.csrfToken(),
            admins,
            currentAdminId: req.session.admin.id,
            success: req.query.success || null,
            error: req.query.error || null
        });
    });

    // Add new admin
    router.post('/add-admin', requireAdmin, (req, res) => {
        const { username, password } = req.body;

        if (!username || !password || password.length < 6) {
            return res.redirect('/admin/settings?error=' + encodeURIComponent('帳號和密碼必填，密碼至少 6 位'));
        }

        const existing = db.adminOps.getByUsername.get(username);
        if (existing) {
            return res.redirect('/admin/settings?error=' + encodeURIComponent('帳號已存在'));
        }

        const passwordHash = bcrypt.hashSync(password, 12);
        db.adminOps.create.run({ username, passwordHash });

        logEvent(EventTypes.ADMIN_CREATE, { createdBy: req.session.admin.username, newAdmin: username });
        db.auditOps.log.run({
            eventType: 'admin.create',
            prayerId: null,
            adminUsername: req.session.admin.username,
            ipHash: hashIP(req.ip),
            details: JSON.stringify({ newAdmin: username })
        });

        res.redirect('/admin/settings?success=' + encodeURIComponent(`已新增 Admin: ${username}`));
    });

    // Remove admin
    router.post('/remove-admin/:id', requireAdmin, (req, res) => {
        const adminId = parseInt(req.params.id, 10);

        // Can't remove yourself
        if (adminId === req.session.admin.id) {
            return res.redirect('/admin/settings?error=' + encodeURIComponent('無法移除自己'));
        }

        // Must have at least 1 admin
        const count = db.adminOps.count.get();
        if (count.count <= 1) {
            return res.redirect('/admin/settings?error=' + encodeURIComponent('至少要有一個 Admin'));
        }

        const targetAdmin = db.adminOps.getById.get(adminId);
        if (targetAdmin) {
            db.adminOps.delete.run(adminId);
            logEvent(EventTypes.ADMIN_DELETE, { deletedBy: req.session.admin.username, deletedAdmin: targetAdmin.username });
            db.auditOps.log.run({
                eventType: 'admin.delete',
                prayerId: null,
                adminUsername: req.session.admin.username,
                ipHash: hashIP(req.ip),
                details: JSON.stringify({ deletedAdmin: targetAdmin.username })
            });
        }

        res.redirect('/admin/settings?success=' + encodeURIComponent('已移除 Admin'));
    });

    // Change own password
    router.post('/change-password', requireAdmin, (req, res) => {
        const { currentPassword, newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) {
            return res.redirect('/admin/settings?error=' + encodeURIComponent('新密碼至少 6 位'));
        }

        const admin = db.adminOps.getByUsername.get(req.session.admin.username);
        if (!bcrypt.compareSync(currentPassword, admin.password_hash)) {
            return res.redirect('/admin/settings?error=' + encodeURIComponent('現有密碼錯誤'));
        }

        const passwordHash = bcrypt.hashSync(newPassword, 12);
        db.adminOps.updatePassword.run({ passwordHash, id: admin.id });

        logEvent(EventTypes.ADMIN_PASSWORD_CHANGE, { adminUsername: req.session.admin.username });
        db.auditOps.log.run({
            eventType: 'admin.password_change',
            prayerId: null,
            adminUsername: req.session.admin.username,
            ipHash: hashIP(req.ip),
            details: null
        });

        res.redirect('/admin/settings?success=' + encodeURIComponent('密碼已更新'));
    });

    return router;
};

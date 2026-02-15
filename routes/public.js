const express = require('express');
const router = express.Router();

module.exports = function (db) {
    // Public prayer wall - shows only approved prayers
    router.get('/', async (req, res) => {
        try {
            const prayers = await db.prayerOps.getApproved.all();

            res.render('index', {
                title: '祈禱牆',
                prayers,
                csrfToken: req.csrfToken()
            });
        } catch (err) {
            console.error('Error loading prayers:', err);
            res.status(500).render('error', {
                title: '伺服器錯誤',
                message: '發生了一些問題，請稍後再試',
                csrfToken: req.csrfToken ? req.csrfToken() : ''
            });
        }
    });

    // Display mode - full screen projection view
    router.get('/display', async (req, res) => {
        try {
            const prayers = await db.prayerOps.getApproved.all();

            res.render('display', {
                title: '祈禱牆 - 投影模式',
                prayers
            });
        } catch (err) {
            console.error('Error loading display prayers:', err);
            res.status(500).render('error', {
                title: '伺服器錯誤',
                message: '發生了一些問題，請稍後再試',
                csrfToken: req.csrfToken ? req.csrfToken() : ''
            });
        }
    });

    return router;
};

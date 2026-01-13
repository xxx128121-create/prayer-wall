const express = require('express');
const router = express.Router();

module.exports = function (db) {
    // Public prayer wall - shows only approved prayers
    router.get('/', (req, res) => {
        const prayers = db.prayerOps.getApproved.all();

        res.render('index', {
            title: '祈禱牆',
            prayers,
            csrfToken: req.csrfToken()
        });
    });

    return router;
};

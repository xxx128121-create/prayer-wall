/**
 * Authentication middleware for admin routes
 */
function requireAdmin(req, res, next) {
    if (req.session && req.session.admin) {
        return next();
    }

    // Store the original URL to redirect back after login
    req.session.returnTo = req.originalUrl;
    res.redirect('/admin/login');
}

/**
 * Middleware to add admin info to all views
 */
function addAdminToLocals(req, res, next) {
    res.locals.admin = req.session ? req.session.admin : null;
    next();
}

module.exports = {
    requireAdmin,
    addAdminToLocals
};

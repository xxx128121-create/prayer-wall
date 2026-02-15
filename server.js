require('dotenv').config();

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const csrf = require('csurf');
const path = require('path');

// Initialize database (async - sql.js needs to load WASM)
const dbReady = require('./db/init');

dbReady.then((db) => {
  db.initializeAdmin();

  // Run cleanup on startup and every 24 hours
  db.cleanupOldData();
  setInterval(() => db.cleanupOldData(), 24 * 60 * 60 * 1000);

  // Initialize Express app
  const app = express();

  // Security middleware
  app.use(helmet({
      contentSecurityPolicy: {
          directives: {
              defaultSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
              scriptSrc: ["'self'", "'unsafe-inline'"],
              fontSrc: ["'self'", "https://fonts.gstatic.com"],
              imgSrc: ["'self'", "data:"]
          }
      }
  }));

  // Body parsing
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // Static files
  app.use(express.static(path.join(__dirname, 'public')));

  // Session configuration
  app.use(session({
      secret: process.env.SESSION_SECRET || 'prayer-wall-secret-change-this',
      resave: false,
      saveUninitialized: false,
      cookie: {
          secure: process.env.NODE_ENV === 'production',
          httpOnly: true,
          maxAge: 24 * 60 * 60 * 1000 // 24 hours
      }
  }));

  // CSRF protection
  app.use(csrf());

  // View engine
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  // Add common variables to all views
  const { addAdminToLocals } = require('./middleware/auth');
  app.use(addAdminToLocals);

  // Routes
  app.use('/', require('./routes/public')(db));
  app.use('/', require('./routes/submit')(db));
  app.use('/admin', require('./routes/admin')(db));

  // Error view
  app.get('/error', (req, res) => {
      res.render('error', {
          title: 'éŒ¯èª¤',
          message: 'ç™¼ç”Ÿäº†ä¸€äº›å•é¡Œ',
          csrfToken: req.csrfToken()
      });
  });

  // 404 handler
  app.use((req, res) => {
      res.status(404).render('error', {
          title: 'æ‰¾ä¸åˆ°é é¢',
          message: 'ä½ è¦æ‰¾çš„é é¢ä¸å­˜åœ¨',
          csrfToken: req.csrfToken()
      });
  });

  // Error handler
  app.use((err, req, res, next) => {
      console.error('Error:', err);

      // CSRF token errors
      if (err.code === 'EBADCSRFTOKEN') {
          return res.status(403).render('error', {
              title: 'å®‰å…¨éŒ¯èª¤',
              message: 'è¡¨å–®å·²éŽæœŸï¼Œè«‹é‡æ–°æ•´ç†é é¢å†è©¦',
              csrfToken: ''
          });
      }

      res.status(500).render('error', {
          title: 'ä¼ºæœå™¨éŒ¯èª¤',
          message: 'ç™¼ç”Ÿäº†ä¸€äº›å•é¡Œï¼Œè«‹ç¨å¾Œå†è©¦',
          csrfToken: req.csrfToken ? req.csrfToken() : ''
      });
  });

  // Start server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
      console.log(`\nPrayer Wall server running\n- http://localhost:${PORT}\n- Admin: http://localhost:${PORT}/admin/login\n`);
  });
}).catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});




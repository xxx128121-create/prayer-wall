# Prayer Wall - Next Steps

**Created:** 2026-02-12

---

## 📋 Pending Tasks

### Task #9: Migrate database from SQLite to Google Sheets
**Status:** Pending
**Priority:** High

**What needs to be done:**

1. **Setup Google Cloud (15 min)**
   - Go to https://console.cloud.google.com
   - Create new project "Prayer Wall" (use personal Google account initially)
   - Enable Google Sheets API
   - Create Service Account
   - Download credentials JSON file

2. **Create Google Sheet (10 min)**
   - Create spreadsheet: "Prayer Wall Database"
   - Add 4 tabs:
     - `Pending` - New submissions awaiting approval
     - `Approved` - Approved prayers (shown on website)
     - `Expired` - Expired prayers (no longer shown)
     - `Rejected` - Rejected prayers
   - Set up column headers in each tab:
     - id | display_name | content | created_at | approved_at | approved_by | expires_at | ip_hash
   - Share sheet with service account email (from step 1)

3. **Code Implementation (1-2 hours)**
   - Install package: `npm install googleapis`
   - Create `db/sheets-client.js` to replace SQLite
   - Update routes: `routes/admin.js`, `routes/public.js`, `routes/submit.js`
   - Add credentials to `.env`:
     ```env
     GOOGLE_SHEET_ID=your-sheet-id-here
     GOOGLE_SERVICE_ACCOUNT_EMAIL=xxx@project.iam.gserviceaccount.com
     GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
     ```
   - Test all CRUD operations

4. **Migration to Church Account (Later)**
   - Can be done anytime by:
     1. Creating new Service Account in church's Google Cloud
     2. Sharing existing sheet with new service account
     3. Updating `.env` credentials
   - **No data loss** - same sheet, different credentials

---

### Task #10: Document Google Sheets API setup
**Status:** Pending
**Priority:** Medium

Create `GOOGLE_SHEETS_SETUP.md` with:
- Detailed Google Cloud setup steps with screenshots
- Service Account creation guide
- How to get Sheet ID from URL
- How to format credentials for `.env`
- Troubleshooting common issues

---

### Task #11: Test Google Sheets integration
**Status:** Pending
**Priority:** High (after Task #9 complete)

**Test checklist:**
- [ ] Submit prayer → appears in Pending tab
- [ ] Approve prayer → moves to Approved tab
- [ ] Reject prayer → moves to Rejected tab
- [ ] Prayer expires → moves to Expired tab
- [ ] Edit prayer content in admin
- [ ] Set custom expiry date
- [ ] Recover rejected prayer
- [ ] Rate limiting still works
- [ ] Multiple concurrent requests
- [ ] Display mode shows approved prayers

---

## 🎯 Quick Start (When You Resume)

1. **Review current state:**
   ```bash
   cd "/media/x/My Passport/Prayer Wall"
   ls -l
   ```

2. **Check existing tasks:**
   - Use task list in Claude Code: `/tasks`

3. **Continue implementation:**
   - Start with Task #9 (Google Sheets migration)
   - Follow the steps above

---

## 📝 Project Context

**Current State:**
- ✅ Website fully functional with SQLite database
- ✅ Display mode working (paginated Lennon Wall)
- ✅ Design upgraded (glassmorphism, animations)
- ✅ Code cleaned (removed AI slop)
- ✅ Documentation complete (USER_MANUAL.md, DEPLOYMENT.md)

**Next Major Change:**
- 🔄 Migrate from SQLite to Google Sheets for easier church staff management

**Why Google Sheets?**
- Church staff can view/manage prayers directly in spreadsheet
- No database backups needed (Google handles it)
- Easy to grant access to multiple admins
- Can use spreadsheet formulas/filters for analysis

**Key Decision:**
- Starting with personal Google account
- Will transfer to church account later (easy - just update `.env`)

---

## 💡 Tips for Implementation

### Google Sheets API Best Practices:
- Use `batchUpdate` for multiple row operations (faster)
- Cache sheet data to reduce API calls
- Handle rate limits gracefully (429 errors)
- Use append for new rows, update for modifications

### Sheet Structure Tips:
- Use row 1 for headers
- Start data from row 2
- Use `id` column as unique identifier
- Consider adding `row_number` for faster lookups

### Error Handling:
- Add retry logic for API failures
- Fall back gracefully if Sheets unavailable
- Log all Sheets API errors

---

## 📚 Resources

**Google Sheets API:**
- https://developers.google.com/sheets/api/quickstart/nodejs
- https://googleapis.dev/nodejs/googleapis/latest/sheets/index.html

**Service Account Setup:**
- https://cloud.google.com/iam/docs/service-accounts-create

**npm Package:**
- https://www.npmjs.com/package/googleapis

---

## ⚠️ Important Notes

1. **Keep SQLite backup** until Google Sheets is fully tested
2. **Don't delete** `db/init.js` immediately - keep as reference
3. **Test thoroughly** before deploying to production
4. **Document credentials** in a secure password manager
5. **Share sheet** with church admins (view-only or edit)

---

**Last Updated:** 2026-02-12
**Status:** Ready to implement Google Sheets integration

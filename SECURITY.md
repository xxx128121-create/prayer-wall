# 安全設計文件 Security Design

## 資料分類

| 分類 | 內容 | 存取權限 |
|------|------|----------|
| Public | 已批准代禱（精簡版） | 所有人 |
| Internal | Pending / Rejected 代禱 | Admin only |
| Sensitive | Admin session / audit log | System only |

## 安全措施

### 密碼保護
- Admin 密碼用 bcrypt hash（cost factor 12）
- 絕不儲存明文密碼

### Session 管理
- HTTPOnly cookie
- Secure flag（production）
- 24 小時過期

### Rate Limiting
- 提交代禱：同一 IP，5 分鐘內最多 3 次
- Admin 登入：同一 IP，15 分鐘內最多 5 次

### IP 隱私
- 只儲存 IP 的 SHA256 hash
- 用於 rate limiting，無法還原原 IP

### XSS 防護
- EJS template auto-escape
- Helmet.js security headers

### CSRF 防護
- 所有 POST form 都有 CSRF token

## Audit Log

所有敏感操作都會記錄：

| Event | 記錄內容 |
|-------|----------|
| data.create_prayer | prayer_id, ip_hash |
| admin.login | username, success/fail |
| admin.approve | prayer_id, admin_username |
| admin.reject | prayer_id, admin_username |

**注意：Log 不會記錄代禱內容，保護私隱。**

## 緊急應對

### 如發現未授權存取
1. 停止 server：`Ctrl+C`
2. 檢查 `logs/app.jsonl` 搵可疑活動
3. 改 `.env` 嘅 `SESSION_SECRET`
4. 重新啟動

### 如需清除敏感資料
1. 備份 `db/prayer-wall.db`
2. 刪除個 db file
3. 重新啟動（會建立新 database）

# 教會祈禱牆 Prayer Wall

一個安全、可審批的 Web 祈禱牆系統。

## 功能

- ✅ 會眾可匿名或署名提交代禱
- ✅ Admin 審批後代禱先會公開
- ✅ 所有操作有 audit log
- ✅ 手機友好設計
- ✅ 無需安裝 App

## 快速開始

### 1. 安裝

確保已安裝 [Node.js](https://nodejs.org/) (建議 v18 或以上)

```bash
# 安裝依賴
npm install
```

### 2. 設定

複製 `.env.example` 為 `.env`，然後修改：

```bash
# Windows
copy .env.example .env

# Mac/Linux
cp .env.example .env
```

**重要設定：**
- `SESSION_SECRET`: 改成一個長嘅隨機字串
- `ADMIN_USERNAME`: Admin 帳號
- `ADMIN_PASSWORD`: Admin 密碼（第一次啟動後會 hash 存入 database）

### 3. 啟動

```bash
npm start
```

打開瀏覽器：`http://localhost:3000`

## 使用說明

### 會眾

1. 用手機掃 QR code 或直接開 link
2. 點「提交代禱」
3. 填寫代禱內容（可選擇匿名或署名）
4. 等待 Admin 審批

### Admin

1. 去 `/admin/login`
2. 輸入帳號密碼
3. 查看 pending 代禱
4. Approve 或 Reject

## 備份

Database 係一個 file：`db/prayer-wall.db`

定期 copy 呢個 file 就可以完整備份。

```powershell
# Windows - 備份到桌面
copy db\prayer-wall.db %USERPROFILE%\Desktop\prayer-wall-backup.db
```

## 搬遷

如果要搬去新 server：

1. Copy 成個 `prayer-wall` folder
2. 確保 `.env` 設定正確
3. 執行 `npm install`
4. 執行 `npm start`

## 查看 Log

所有操作記錄喺 `logs/app.jsonl`：

```powershell
# 查看最新 20 行
Get-Content logs\app.jsonl -Tail 20
```

## 安全設計

- 所有新提交預設 private（PENDING）
- 只有 Admin 可以 approve
- 密碼用 bcrypt hash
- 有 rate limit 防濫用
- 前端無 secrets

詳見 [SECURITY.md](SECURITY.md)

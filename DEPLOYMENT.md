# 部署指南 (Deployment Guide)

## 免費部署到 Render.com

Render 提供免費的 Node.js 應用托管服務，非常適合部署這個祈禱牆應用。

### 準備工作

1. **創建 GitHub 帳號**（如果還沒有）
   - 訪問 https://github.com 並註冊

2. **創建 Render 帳號**
   - 訪問 https://render.com 並使用 GitHub 帳號登入

### 步驟 1: 將代碼推送到 GitHub

在項目目錄執行以下命令：

```bash
cd "/media/x/My Passport/Prayer Wall"

# 初始化 Git（如果還未初始化）
git init

# 添加所有文件
git add .

# 創建第一次提交
git commit -m "Initial commit: Prayer Wall application"

# 在 GitHub 上創建一個新倉庫（私有或公開）
# 然後連接到遠程倉庫
git remote add origin https://github.com/你的用戶名/prayer-wall.git
git branch -M main
git push -u origin main
```

### 步驟 2: 在 Render 上創建 Web Service

1. 登入 Render Dashboard: https://dashboard.render.com

2. 點擊 **"New +"** → **"Web Service"**

3. 連接你的 GitHub 倉庫：
   - 選擇你剛才創建的 `prayer-wall` 倉庫
   - 點擊 **"Connect"**

4. 配置服務：
   - **Name**: `prayer-wall`（或你喜歡的名字）
   - **Region**: 選擇離你最近的地區（如 Singapore）
   - **Branch**: `main`
   - **Root Directory**: 留空
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`

5. 添加環境變數（Environment Variables）：
   點擊 **"Add Environment Variable"** 並添加：
   ```
   ADMIN_USERNAME = admin
   ADMIN_PASSWORD = your_secure_password_here
   SESSION_SECRET = your_random_secret_key_here
   NODE_ENV = production
   PORT = 10000
   ```

6. 點擊 **"Create Web Service"**

### 步驟 3: 等待部署完成

- Render 會自動開始構建和部署
- 大約需要 2-5 分鐘
- 部署完成後，你會看到一個 URL，例如：`https://prayer-wall.onrender.com`

### 步驟 4: 訪問你的網站

打開 Render 提供的 URL，你的祈禱牆就上線了！

管理員登入地址：`https://你的網站.onrender.com/admin/login`

---

## 免費部署到 Railway.app（備選方案）

如果你想嘗試 Railway：

1. 訪問 https://railway.app 並用 GitHub 登入
2. 點擊 **"New Project"** → **"Deploy from GitHub repo"**
3. 選擇你的 `prayer-wall` 倉庫
4. 添加環境變數（同上）
5. 部署完成！

---

## 免費部署到 Fly.io（備選方案）

### 安裝 Fly CLI

```bash
curl -L https://fly.io/install.sh | sh
```

### 登入 Fly.io

```bash
flyctl auth login
```

### 部署應用

```bash
cd "/media/x/My Passport/Prayer Wall"

# 初始化 Fly 應用
flyctl launch

# 設置環境變數
flyctl secrets set ADMIN_USERNAME=admin
flyctl secrets set ADMIN_PASSWORD=your_password
flyctl secrets set SESSION_SECRET=your_secret

# 部署
flyctl deploy
```

---

## 重要提示

### 免費方案限制

- **Render Free Tier**:
  - 15 分鐘不活動後會自動休眠
  - 首次訪問需要 30-60 秒喚醒
  - 適合中小型教會使用

- **Railway Free Tier**:
  - 每月 500 小時免費運行時間
  - 5GB 存儲空間

- **Fly.io Free Tier**:
  - 3 個應用
  - 每月 160GB 流量

### 數據備份

**重要**: 免費方案的數據庫文件可能在重啟時丟失。建議：

1. 定期從管理後台導出祈禱事項
2. 考慮升級到付費方案以獲得持久存儲
3. 或使用外部數據庫（如 PostgreSQL on Supabase）

### 自定義域名（可選）

如果你有自己的域名：

1. 在 Render Dashboard 中選擇你的服務
2. 點擊 **"Settings"** → **"Custom Domain"**
3. 添加你的域名（如 `prayer.yourchurch.org`）
4. 按照指示在你的域名提供商處添加 DNS 記錄

---

## 更新應用

當你修改代碼後，只需：

```bash
git add .
git commit -m "Update: 你的更新說明"
git push
```

Render 會自動檢測到更新並重新部署！

---

## 故障排除

### 應用無法啟動

1. 檢查 Render 日誌：Dashboard → 你的服務 → Logs
2. 確保所有環境變數都已正確設置
3. 檢查 `package.json` 中的 `start` 腳本

### 管理員無法登入

1. 檢查環境變數 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD`
2. 重新部署應用

### 數據丟失

免費方案可能會在重啟時丟失數據。解決方案：
- 定期備份
- 升級到付費方案
- 使用外部數據庫

---

## 需要幫助？

- Render 文檔: https://render.com/docs
- Railway 文檔: https://docs.railway.app
- Fly.io 文檔: https://fly.io/docs

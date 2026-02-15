# Prayer Wall 最簡部署（超簡版）

目標：用最少步驟上線，不用手動填一堆設定。

## 一次部署（Render Blueprint）

### 1) 先把專案放上 GitHub（做一次就好）

在 `Prayer Wall` 資料夾執行：

```bash
git add .
git commit -m "Deploy prayer wall"
git push
```

### 2) 在 Render 用 Blueprint 部署

1. 打開 https://dashboard.render.com
2. 點 **New +** → **Blueprint**
3. 選你的 `prayer-wall` repo
4. 點 **Apply**

Render 會自動讀取專案內的 `render.yaml`，不需要你再填 Build/Start 指令。

### 3) 只設定兩個值

部署後到 Environment，改這兩個：

- `ADMIN_USERNAME`（例如 `admin`）
- `ADMIN_PASSWORD`（請用強密碼）

`SESSION_SECRET` 會由 Render 自動產生，不用手填。

## 完成後

- 網站：`https://你的服務名稱.onrender.com`
- 管理登入：`https://你的服務名稱.onrender.com/admin/login`

## 之後更新（同樣超簡單）

```bash
git add .
git commit -m "update"
git push
```

Render 會自動重新部署。

## 注意

本專案目前使用本地檔案資料庫（`db/prayer-wall.db`）。若平台重建或重啟，資料可能遺失。請定期備份。

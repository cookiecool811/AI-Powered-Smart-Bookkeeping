# AI 智能记账

一个基于 Flask + SQLite + OpenPyXL + 智谱 GLM-4.7-Flash 的 AI 记账 Web 项目。

## 功能

- 自然语言输入消费
- GLM-4.7-Flash 自动识别金额、日期、消费描述、支付方式
- AI 自动分类：餐饮、交通、购物、住房、娱乐、医疗、教育、通讯、旅行、生活缴费、数码电子、其他
- 自动保存账单
- 全部 / 月度 / 年度消费汇总
- 消费分类统计与图表
- 后台自动生成 Excel
- 一键下载 Excel
- 删除账单后自动重新生成 Excel
- Flask Web UI，PyCharm 可直接运行
- Render 可直接部署

## 1. PyCharm 本地运行

建议 Python 3.11~3.13。

```bash
python -m venv .venv
```

Windows：
```bash
.venv\Scripts\activate
```

安装：
```bash
pip install -r requirements.txt
```

设置环境变量：

Windows PowerShell：
```powershell
$env:ZHIPUAI_API_KEY="你的API_KEY"
```

或者复制 `.env.example` 为 `.env`，再通过 PyCharm/系统环境变量加载。

启动：
```bash
python app.py
```

打开：
http://127.0.0.1:5000

## 2. Render 部署

1. 将整个项目上传到 GitHub。
2. Render -> New -> Web Service。
3. 连接 GitHub 仓库。
4. Build Command：
```bash
pip install -r requirements.txt
```
5. Start Command：
```bash
gunicorn app:app
```
6. Environment Variables：
```text
ZHIPUAI_API_KEY=你的API_KEY
ZHIPUAI_MODEL=glm-4.7-flash
```

不要把真实 API Key 写进 GitHub。

## 3. 数据持久化说明

本项目默认使用 SQLite，适合本地 PyCharm 使用。

Render 免费 Web Service 的本地文件系统不适合作为长期数据库。因此如果你希望线上长期保存账单，建议下一版接 PostgreSQL，并将 `DATABASE_URL` 配置到 Render。

Excel 可以按需生成和下载。

## 4. 示例

输入：

“今天中午吃饭花了 35 元，坐地铁 4 元，晚上看电影 42 元。”

AI 会拆成三笔：

- 餐饮 ¥35
- 交通 ¥4
- 娱乐 ¥42

并立即更新统计和 Excel。

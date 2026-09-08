import os
import json
import re
import sqlite3
import smtplib
from io import BytesIO
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from datetime import datetime
from pathlib import Path
from flask import Flask, jsonify, render_template, request, send_file
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from zhipuai import ZhipuAI
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "expenses.db"
EXPORT_DIR = BASE_DIR / "exports"
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)

CATEGORIES = [
    "餐饮", "交通", "购物", "住房", "娱乐", "医疗",
    "教育", "通讯", "旅行", "生活缴费", "数码电子", "其他"
]

SYSTEM_PROMPT = f"""
你是一个专业的中文AI记账助手。
你的任务是把用户自然语言中的消费记录解析成结构化账单。
只返回合法JSON，不要Markdown，不要解释。

分类必须从以下类别中选择：
{", ".join(CATEGORIES)}

JSON格式：
{{
  "items": [
    {{
      "amount": 12.5,
      "category": "餐饮",
      "description": "午餐",
      "date": "YYYY-MM-DD",
      "payment_method": "未知",
      "confidence": 0.95
    }}
  ],
  "reply": "简短说明识别结果"
}}

规则：
1. amount 必须是正数。
2. 如果用户没有明确日期，使用今天。
3. 一句话可能包含多笔消费，必须全部提取。
4. 如果没有金额，不要猜测，items 返回空数组。
5. 日期可以理解“今天、昨天、前天、上周”等表达。
6. 分类要根据消费语义判断。
7. confidence 为0到1之间的小数。
"""

def db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = db()
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount REAL NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        expense_date TEXT NOT NULL,
        payment_method TEXT DEFAULT '未知',
        confidence REAL DEFAULT 0,
        created_at TEXT NOT NULL
    )
    """)
    conn.commit()
    cur.close()
    conn.close()

def get_client():
    key = os.getenv("ZHIPUAI_API_KEY")
    if not key:
        raise RuntimeError("未配置 ZHIPUAI_API_KEY 环境变量")
    return ZhipuAI(api_key=key)

def parse_ai_json(text):
    text = text.strip()
    text = re.sub(r"^```json\s*", "", text)
    text = re.sub(r"^```\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return json.loads(text)

def ai_parse(user_text):
    client = get_client()
    today = datetime.now().strftime("%Y-%m-%d")
    prompt = f"今天是 {today}。请解析下面的消费记录：\n{user_text}"
    response = client.chat.completions.create(
        model=os.getenv("ZHIPUAI_MODEL", "glm-4.7-flash"),
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt}
        ],
        temperature=0.1,
        max_tokens=2000
    )
    content = response.choices[0].message.content
    data = parse_ai_json(content)
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        raise ValueError("AI返回格式异常")
    return data

def save_items(items):
    conn = db()
    cur = conn.cursor()
    now = datetime.now().isoformat(timespec="seconds")
    saved = []
    for item in items:
        amount = float(item["amount"])
        if amount <= 0:
            continue
        category = item.get("category", "其他")
        if category not in CATEGORIES:
            category = "其他"
        description = str(item.get("description", "未命名消费"))
        date = str(item.get("date") or datetime.now().strftime("%Y-%m-%d"))
        payment = str(item.get("payment_method", "未知"))
        confidence = max(0, min(1, float(item.get("confidence", 0))))
        cur.execute("""
            INSERT INTO expenses
            (amount, category, description, expense_date, payment_method, confidence, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (amount, category, description, date, payment, confidence, now))
        new_id = cur.lastrowid
        saved.append({
            "id": new_id,
            "amount": amount,
            "category": category,
            "description": description,
            "date": date,
            "payment_method": payment,
            "confidence": confidence
        })
    conn.commit()
    cur.close()
    conn.close()
    return saved

def query_expenses(start_date=None, end_date=None):
    conn = db()
    cur = conn.cursor()
    sql = """
        SELECT id, amount, category, description,
               expense_date AS date, payment_method, confidence
        FROM expenses WHERE 1=1
    """
    params = []
    if start_date:
        sql += " AND expense_date >= ?"
        params.append(start_date)
    if end_date:
        sql += " AND expense_date <= ?"
        params.append(end_date)
    sql += " ORDER BY expense_date DESC, id DESC"
    cur.execute(sql, params)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]

def resolve_date_range(range_type, start=None, end=None):
    today = datetime.now().strftime("%Y-%m-%d")
    if range_type == "month":
        return today[:7] + "-01", today
    if range_type == "year":
        return today[:4] + "-01-01", today
    if range_type == "custom":
        return (start or None), (end or None)
    return None, None

def range_label(range_type, start_date=None, end_date=None):
    if range_type == "month":
        return datetime.now().strftime("%Y年%m月")
    if range_type == "year":
        return datetime.now().strftime("%Y年")
    if range_type == "custom" and start_date and end_date:
        return f"{start_date}至{end_date}"
    return "全部"

def create_workbook(start_date=None, end_date=None):
    rows = query_expenses(start_date, end_date)
    wb = Workbook()
    ws = wb.active
    ws.title = "消费明细"

    headers = ["日期", "分类", "描述", "金额", "支付方式"]
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="4F46E5")
        cell.alignment = Alignment(horizontal="center")

    for r in rows:
        ws.append([
            r["date"], r["category"], r["description"],
            r["amount"], r["payment_method"]
        ])

    total = round(sum(r["amount"] for r in rows), 2)
    ws.append(["合计", "", "", total, ""])
    for cell in ws[ws.max_row]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill("solid", fgColor="EEF2FF")

    for col, width in {"A":15, "B":14, "C":28, "D":14, "E":16}.items():
        ws.column_dimensions[col].width = width
    ws.freeze_panes = "A2"

    monthly = {}
    yearly = {}
    category = {}

    for r in rows:
        d = r["date"]
        month = d[:7]
        year = d[:4]
        monthly[month] = monthly.get(month, 0) + r["amount"]
        yearly[year] = yearly.get(year, 0) + r["amount"]
        category[r["category"]] = category.get(r["category"], 0) + r["amount"]

    def summary_sheet(name, mapping, first, second):
        sh = wb.create_sheet(name)
        sh.append([first, second])
        for c in sh[1]:
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", fgColor="0F766E")
        for k in sorted(mapping.keys(), reverse=True):
            sh.append([k, round(mapping[k], 2)])
        sh.column_dimensions["A"].width = 20
        sh.column_dimensions["B"].width = 18

    summary_sheet("月度汇总", monthly, "月份", "消费总额")
    summary_sheet("年度汇总", yearly, "年份", "消费总额")
    summary_sheet("分类汇总", category, "消费分类", "消费总额")
    return wb

def build_excel():
    wb = create_workbook()
    filename = EXPORT_DIR / "AI记账消费报表.xlsx"
    wb.save(filename)
    return filename

def send_excel_email(start_date=None, end_date=None):
    host = os.getenv("SMTP_HOST")
    port = int(os.getenv("SMTP_PORT", "465"))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    mail_to = os.getenv("MAIL_TO", "")
    recipients = [x.strip() for x in mail_to.split(",") if x.strip()]
    if not all([host, user, password]) or not recipients:
        raise RuntimeError("未配置邮箱 SMTP 信息，请在 .env 中填写 SMTP_HOST / SMTP_USER / SMTP_PASSWORD / MAIL_TO")
    wb = create_workbook(start_date, end_date)
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    msg = MIMEMultipart()
    msg["From"] = user
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = f"AI记账消费报表 - {datetime.now().strftime('%Y-%m-%d')}"
    msg.attach(MIMEText("您好，附件是您的 AI 记账消费报表，请查收。", "plain", "utf-8"))
    part = MIMEBase("application", "vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    part.set_payload(buf.read())
    encoders.encode_base64(part)
    part.add_header("Content-Disposition", "attachment", filename="AI记账消费报表.xlsx")
    msg.attach(part)
    if port == 465:
        server = smtplib.SMTP_SSL(host, port, timeout=30)
    else:
        server = smtplib.SMTP(host, port, timeout=30)
        server.starttls()
    server.login(user, password)
    server.sendmail(user, recipients, msg.as_string())
    server.quit()

@app.route("/")
def index():
    return render_template("index.html")

@app.get("/api/expenses")
def api_expenses():
    return jsonify({"items": query_expenses()})

@app.get("/api/stats")
def api_stats():
    rows = query_expenses()
    total = sum(r["amount"] for r in rows)
    month = datetime.now().strftime("%Y-%m")
    year = datetime.now().strftime("%Y")
    month_total = sum(r["amount"] for r in rows if r["date"].startswith(month))
    year_total = sum(r["amount"] for r in rows if r["date"].startswith(year))
    category = {}
    for r in rows:
        category[r["category"]] = category.get(r["category"], 0) + r["amount"]
    top = sorted(category.items(), key=lambda x: x[1], reverse=True)[:8]
    return jsonify({
        "total": round(total, 2),
        "month_total": round(month_total, 2),
        "year_total": round(year_total, 2),
        "count": len(rows),
        "category": [{"name": k, "value": round(v, 2)} for k, v in top]
    })

@app.get("/api/summary")
def api_summary():
    range_type = request.args.get("range", "all")
    start = request.args.get("start")
    end = request.args.get("end")
    start_date, end_date = resolve_date_range(range_type, start, end)
    rows = query_expenses(start_date, end_date)
    total = round(sum(r["amount"] for r in rows), 2)
    return jsonify({
        "total": total,
        "count": len(rows),
        "range_label": range_label(range_type, start_date, end_date)
    })

@app.post("/api/parse")
def api_parse():
    data = request.get_json(silent=True) or {}
    text = str(data.get("text", "")).strip()
    if not text:
        return jsonify({"error": "请输入消费描述"}), 400
    try:
        result = ai_parse(text)
        items = save_items(result["items"])
        return jsonify({"reply": result.get("reply", "已完成记账"), "items": items})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.delete("/api/expenses/<int:expense_id>")
def api_delete(expense_id):
    conn = db()
    cur = conn.cursor()
    cur.execute("DELETE FROM expenses WHERE id=?", (expense_id,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({"ok": True})

@app.get("/download/excel")
def download_excel():
    range_type = request.args.get("range", "all")
    start = request.args.get("start")
    end = request.args.get("end")
    start_date, end_date = resolve_date_range(range_type, start, end)
    wb = create_workbook(start_date, end_date)
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"AI记账消费报表_{range_label(range_type, start_date, end_date)}.xlsx"
    return send_file(buf, as_attachment=True, download_name=filename,
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

@app.post("/api/send-email")
def api_send_email():
    data = request.get_json(silent=True) or {}
    range_type = data.get("range", "all")
    start = data.get("start")
    end = data.get("end")
    start_date, end_date = resolve_date_range(range_type, start, end)
    try:
        send_excel_email(start_date, end_date)
        return jsonify({"ok": True, "message": "报表已发送到邮箱"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.get("/health")
def health():
    return jsonify({"status": "ok"})

init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)

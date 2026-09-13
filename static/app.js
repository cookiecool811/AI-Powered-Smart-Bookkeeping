let doughnutChart, lineChart;
let lastAddedIds = [];
let allExpenses = [];
let currentPeriod = "week";
let currentView = "expense";
let latestStats = null;
let selectedMonth = "";

const CATEGORY_ICONS = {
  "餐饮":"🍔","交通":"🚗","购物":"🛍️","住房":"🏠","娱乐":"🎮",
  "医疗":"💊","教育":"📚","通讯":"📱","旅行":"✈️","生活缴费":"💡",
  "数码电子":"💻","其他":"📌",
  "工资":"💰","奖金":"🎁","投资收益":"📈","兼职":"💼","红包":"🧧","退款":"↩️","其他收入":"💵"
};
const CHART_COLORS = ["#FFD93D","#FF9F43","#EE5A6F","#54A0FF","#5F27CD","#00D2D3","#FF6B6B","#48DBFB","#FECA57","#1DD1A1","#C8D6E5","#8395A7"];

const money = n => "¥" + Number(n || 0).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});
const getIcon = c => CATEGORY_ICONS[c] || "📌";
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}

function groupByDate(items){
  const g = {};
  items.forEach(it => {
    if(!g[it.date]) g[it.date] = {items:[], expense:0, income:0};
    g[it.date].items.push(it);
    if(it.type === "income") g[it.date].income += Number(it.amount);
    else g[it.date].expense += Number(it.amount);
  });
  return Object.keys(g).sort().reverse().map(d => ({date:d, ...g[d]}));
}

function formatDate(ds){
  const d = new Date(ds + "T00:00:00");
  const wd = ["星期日","星期一","星期二","星期三","星期四","星期五","星期六"];
  return `${d.getMonth()+1}月${d.getDate()}日 ${wd[d.getDay()]}`;
}

// ===== 加载数据 =====
async function load(){
  const [s,e] = await Promise.all([
    fetch("/api/stats").then(r=>r.json()),
    fetch("/api/expenses").then(r=>r.json())
  ]);
  allExpenses = e.items;
  latestStats = s;

  if(!selectedMonth){
    selectedMonth = new Date().toISOString().slice(0,7);
    document.querySelector("#monthPicker").value = selectedMonth;
  }
  renderByMonth();
  renderCharts(s, e.items);
  updateDiscover();
}

function updateDiscover(){
  const now = new Date();
  const monthStr = String(now.getMonth()+1).padStart(2,"0");
  document.querySelector("#billMonth").textContent = monthStr;
  document.querySelector("#budgetTitle").textContent = `${monthStr}月总预算`;

  const monthItems = allExpenses.filter(x => x.date.startsWith(now.getFullYear()+"-"+monthStr));
  const inc = monthItems.filter(x => x.type === "income").reduce((a,b)=>a+Number(b.amount),0);
  const exp = monthItems.filter(x => (x.type||"expense") === "expense").reduce((a,b)=>a+Number(b.amount),0);
  document.querySelector("#billIncome").textContent = inc.toFixed(2);
  document.querySelector("#billExpense").textContent = exp.toFixed(2);
  document.querySelector("#billBalance").textContent = (inc - exp).toFixed(2);

  // 预算
  const budgetKey = "budget_" + now.getFullYear() + "_" + monthStr;
  const budget = parseFloat(localStorage.getItem(budgetKey)) || 0;
  const remain = Math.max(0, budget - exp);
  const percent = budget > 0 ? Math.round((remain / budget) * 100) : 0;
  document.querySelector("#budgetRemain").textContent = remain.toFixed(2);
  document.querySelector("#budgetTotal").textContent = budget.toFixed(2);
  document.querySelector("#budgetSpent").textContent = exp.toFixed(2);
  document.querySelector("#ringPercent").textContent = percent + "%";
  const circumference = 2 * Math.PI * 50;
  const offset = circumference * (1 - percent / 100);
  document.querySelector("#ringProgress").style.strokeDashoffset = offset;
}

document.querySelector("#budgetSetBtn").addEventListener("click", function(){
  const now = new Date();
  const budgetKey = "budget_" + now.getFullYear() + "_" + String(now.getMonth()+1).padStart(2,"0");
  const current = localStorage.getItem(budgetKey) || "";
  const val = prompt("请输入本月预算金额：", current);
  if(val !== null && !isNaN(val) && val >= 0){
    localStorage.setItem(budgetKey, val);
    updateDiscover();
  }
});

function renderByMonth(){
  const filtered = allExpenses.filter(x => x.date.startsWith(selectedMonth));
  const inc = filtered.filter(x => x.type === "income").reduce((a,b)=>a+Number(b.amount),0);
  const exp = filtered.filter(x => (x.type||"expense") === "expense").reduce((a,b)=>a+Number(b.amount),0);
  document.querySelector("#monthIncome").textContent = money(inc);
  document.querySelector("#monthExpense").textContent = money(exp);
  renderRecords(filtered);
}

function renderRecords(items){
  const c = document.querySelector("#recordsList");
  if(!items.length){
    c.innerHTML = `<div class="empty-state"><div class="empty-icon-big">📄</div><p>暂无数据</p></div>`;
    return;
  }
  const groups = groupByDate(items);
  c.innerHTML = groups.map(g => {
    let totalText = "";
    if(g.expense > 0) totalText += `支出 ${money(g.expense)}`;
    if(g.income > 0) totalText += (totalText ? "  " : "") + `收入 ${money(g.income)}`;
    return `
    <div class="date-group">
      <div class="date-header"><span class="date-text">${formatDate(g.date)}</span><span class="date-total">${totalText}</span></div>
      ${g.items.map(it => {
        const isIncome = it.type === "income";
        return `
        <div class="record-item">
          <div class="record-icon">${getIcon(it.category)}</div>
          <div class="record-info">
            <div class="record-desc">${escapeHtml(it.description)}</div>
            <div class="record-cat">${it.category} · ${escapeHtml(it.payment_method)}</div>
          </div>
          <div class="record-amount ${isIncome ? 'income' : ''}">${isIncome ? '+' : '-'}${Number(it.amount).toFixed(2)}</div>
          <button class="record-delete" onclick="removeExpense(${it.id})">✕</button>
        </div>`;
      }).join("")}
    </div>`;
  }).join("");
}

// ===== 图表 =====
function renderCharts(stats, items){
  const cats = currentView === "income" ? (stats.income_category || []) : (stats.category || []);
  document.querySelector("#categoryRank").innerHTML = cats.length
    ? cats.slice(0,8).map((x,i) => `
      <div class="rank-item">
        <div class="rank-num">${i+1}</div>
        <span>${getIcon(x.name)}</span>
        <div class="rank-name">${x.name}</div>
        <div class="rank-amount">${money(x.value)}</div>
      </div>`).join("")
    : `<div class="empty-state"><p>暂无数据</p></div>`;

  // 环形图
  if(doughnutChart) doughnutChart.destroy();
  doughnutChart = new Chart(document.querySelector("#doughnutChart"),{
    type:"doughnut",
    data:{labels:cats.map(x=>x.name),datasets:[{data:cats.map(x=>x.value),backgroundColor:CHART_COLORS}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:"65%",plugins:{legend:{position:"right",labels:{boxWidth:10,font:{size:11}}}}}
  });

  renderLineChart(items);
}

function renderLineChart(items){
  const now = new Date();
  let labels = [], filtered = [];

  if(currentPeriod === "week"){
    for(let i=6;i>=0;i--){
      const d = new Date(now); d.setDate(d.getDate()-i);
      labels.push(`${d.getMonth()+1}-${d.getDate()}`);
    }
    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate()-6);
    filtered = items.filter(x => new Date(x.date+"T00:00:00") >= weekAgo);
    document.querySelector("#periodLabel").textContent = "本周";
  } else if(currentPeriod === "month"){
    const days = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
    for(let i=1;i<=days;i++) labels.push(`${i}日`);
    filtered = items.filter(x => x.date.startsWith(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`));
    document.querySelector("#periodLabel").textContent = "本月";
  } else {
    for(let m=1;m<=12;m++) labels.push(`${m}月`);
    filtered = items.filter(x => x.date.startsWith(String(now.getFullYear())));
    document.querySelector("#periodLabel").textContent = "本年";
  }

  // 按收入/支出过滤
  filtered = filtered.filter(x => currentView === "income" ? x.type === "income" : (x.type || "expense") === "expense");

  // 聚合
  const totals = {};
  filtered.forEach(x => {
    let key;
    if(currentPeriod === "year") key = x.date.substring(5,7) + "月";
    else if(currentPeriod === "month") key = parseInt(x.date.substring(8,10)) + "日";
    else key = `${new Date(x.date+"T00:00:00").getMonth()+1}-${new Date(x.date+"T00:00:00").getDate()}`;
    totals[key] = (totals[key]||0) + Number(x.amount);
  });
  const data = labels.map(l => totals[l] || 0);
  const sum = data.reduce((a,b)=>a+b,0);
  const avg = data.filter(v=>v>0).length ? sum/data.filter(v=>v>0).length : 0;

  document.querySelector("#periodTotal").textContent = money(sum);
  document.querySelector("#periodAvg").textContent = money(avg);

  const lineColor = currentView === "income" ? "#27AE60" : "#F0C419";
  const fillColor = currentView === "income" ? "rgba(39,174,96,.15)" : "rgba(255,217,61,.15)";
  if(lineChart) lineChart.destroy();
  lineChart = new Chart(document.querySelector("#lineChart"),{
    type:"line",
    data:{labels,datasets:[{data,borderColor:lineColor,backgroundColor:fillColor,fill:true,tension:.3,pointRadius:4,pointBackgroundColor:"#fff",pointBorderColor:lineColor,pointBorderWidth:2}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:"#f0f0f0"},ticks:{font:{size:10}}},x:{grid:{display:false},ticks:{font:{size:10}}}}}
  });
}

// ===== AI 记账 =====
async function submitExpense(){
  const input=document.querySelector("#input"), btn=document.querySelector("#submit"), msg=document.querySelector("#message");
  const text=input.value.trim();
  if(!text){msg.textContent="请输入消费内容";msg.style.color="#E74C3C";return}
  btn.disabled=true; btn.textContent="AI 分析中…"; msg.textContent=""; msg.style.color="#27AE60";
  try{
    const r=await fetch("/api/parse",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text})});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"请求失败");
    msg.textContent=`✓ ${data.reply || "已完成记账"}`;
    lastAddedIds = (data.items || []).map(x => x.id);
    input.value="";
    await load();
    // 自动导出本次
    await autoSendCurrent();
  }catch(e){msg.textContent="× "+e.message; msg.style.color="#E74C3C"}
  finally{btn.disabled=false;btn.textContent="智能记账"}
}

async function autoSendCurrent(){
  if(!lastAddedIds.length) return;
  const msg=document.querySelector("#message");
  try{
    const r=await fetch("/api/send-email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({range:"current",ids:lastAddedIds})});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"发送失败");
    msg.textContent += "（本次报表已发送到邮箱）";
  }catch(e){ msg.textContent += "（邮件发送失败："+e.message+"）"; }
}

async function removeExpense(id){
  if(!confirm("确定删除这条账单吗？")) return;
  await fetch("/api/expenses/"+id,{method:"DELETE"});
  await load();
}

// ===== 手动导出 =====
function getRangeParams(){
  const range = document.querySelector("#rangeSelect").value;
  const p = {range};
  if(range === "custom"){
    p.start = document.querySelector("#startDate").value;
    p.end = document.querySelector("#endDate").value;
  }
  return p;
}

async function sendEmail(){
  const btn=document.querySelector("#exportBtn");
  const p = getRangeParams();
  if(p.range === "custom" && (!p.start || !p.end)){ alert("请选择自定义起止日期"); return; }
  btn.disabled=true; btn.textContent="发送中…";
  try{
    const r=await fetch("/api/send-email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"发送失败");
    alert("✓ 报表已发送到邮箱，请查收");
  }catch(e){ alert("× 邮件发送失败："+e.message); }
  finally{ btn.disabled=false; btn.textContent="确认导出"; }
}

// ===== Tab 切换 =====
function switchTab(tab){
  document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-page").forEach(p => p.classList.remove("active"));
  document.querySelector("#page-" + tab).classList.add("active");
  const btn = document.querySelector(`.nav-item[data-tab="${tab}"]`);
  if(btn) btn.classList.add("active");
  window.scrollTo(0,0);
}

document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});
document.querySelector(".nav-add").addEventListener("click", () => switchTab("ai"));

// ===== 事件绑定 =====
document.querySelector("#submit").addEventListener("click", submitExpense);
document.querySelector("#exportBtn").addEventListener("click", sendEmail);
document.querySelector("#rangeSelect").addEventListener("change", function(){
  document.querySelector("#customRange").style.display = this.value === "custom" ? "flex" : "none";
});

// 图表周期切换
document.querySelectorAll(".period-tab").forEach(tab => {
  tab.addEventListener("click", function(){
    document.querySelectorAll(".period-tab").forEach(t => t.classList.remove("active"));
    this.classList.add("active");
    currentPeriod = this.dataset.period;
    renderLineChart(allExpenses);
  });
});

// 支出/收入下拉切换
const typeToggle = document.querySelector("#typeToggle");
const typeDropdown = document.querySelector("#typeDropdown");
typeToggle.addEventListener("click", function(e){
  e.stopPropagation();
  typeDropdown.classList.toggle("show");
});
document.addEventListener("click", function(){
  typeDropdown.classList.remove("show");
});
document.querySelectorAll(".type-option").forEach(opt => {
  opt.addEventListener("click", function(e){
    e.stopPropagation();
    currentView = this.dataset.type;
    document.querySelector("#typeLabel").textContent = currentView === "income" ? "收入" : "支出";
    document.querySelector("#checkExpense").textContent = currentView === "expense" ? "✓" : "";
    document.querySelector("#checkIncome").textContent = currentView === "income" ? "✓" : "";
    typeDropdown.classList.remove("show");
    if(latestStats) renderCharts(latestStats, allExpenses);
  });
});

document.querySelector("#input").addEventListener("keydown", e => {
  if((e.ctrlKey||e.metaKey)&&e.key==="Enter") submitExpense();
});

// 月份切换
document.querySelector("#monthPicker").addEventListener("change", function(){
  selectedMonth = this.value;
  renderByMonth();
});

load();

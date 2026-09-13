let chart;
let lastAddedIds = [];

const CATEGORY_ICONS = {
  "餐饮":"🍔","交通":"🚗","购物":"🛍️","住房":"🏠","娱乐":"🎮",
  "医疗":"💊","教育":"📚","通讯":"📱","旅行":"✈️","生活缴费":"💡",
  "数码电子":"💻","其他":"📌"
};

const money = n => "¥" + Number(n || 0).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

function getIcon(cat){ return CATEGORY_ICONS[cat] || "📌"; }

// 按日期分组
function groupByDate(items){
  const groups = {};
  items.forEach(it => {
    const d = it.date;
    if(!groups[d]) groups[d] = {items:[], total:0};
    groups[d].items.push(it);
    groups[d].total += Number(it.amount);
  });
  return Object.keys(groups).sort().reverse().map(d => ({date:d, ...groups[d]}));
}

function formatDate(dateStr){
  const d = new Date(dateStr + "T00:00:00");
  const weekdays = ["星期日","星期一","星期二","星期三","星期四","星期五","星期六"];
  return `${d.getMonth()+1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
}

async function load(){
  const [s,e] = await Promise.all([
    fetch("/api/stats").then(r=>r.json()),
    fetch("/api/expenses").then(r=>r.json())
  ]);

  // 头部本月支出
  document.querySelector("#monthExpense").textContent = money(s.month_total);

  // 设置页统计
  document.querySelector("#totalCount").textContent = s.count + " 笔";
  document.querySelector("#totalAmount").textContent = money(s.total);

  // 分类图表
  const max = Math.max(...s.category.map(x=>x.value),1);
  document.querySelector("#categoryList").innerHTML = s.category.length
    ? s.category.map(x=>`
      <div>
        <div class="cat-row"><span>${getIcon(x.name)} ${x.name}</span><b>${money(x.value)}</b></div>
        <div class="bar"><i style="width:${x.value/max*100}%"></i></div>
      </div>`).join("")
    : '<p style="text-align:center;color:#999;padding:20px">暂无消费数据</p>';

  if(chart) chart.destroy();
  chart = new Chart(document.querySelector("#chart"),{
    type:"doughnut",
    data:{labels:s.category.map(x=>x.name),datasets:[{data:s.category.map(x=>x.value),backgroundColor:["#FFD93D","#FF9F43","#EE5A6F","#54A0FF","#5F27CD","#00D2D3","#FF6B6B","#48DBFB","#FECA57","#1DD1A1","#C8D6E5","#8395A7"]}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:"65%",plugins:{legend:{position:"right",labels:{boxWidth:10,font:{size:11}}}}}
  });

  // 账单列表（按日期分组）
  renderRecords(e.items);
}

function renderRecords(items){
  const container = document.querySelector("#recordsList");
  if(!items.length){
    container.innerHTML = '<div class="empty-state">还没有账单，点下方 ＋ 开始记账吧</div>';
    return;
  }
  const groups = groupByDate(items);
  container.innerHTML = groups.map(g => `
    <div class="date-group">
      <div class="date-header">
        <span class="date-text">${formatDate(g.date)}</span>
        <span class="date-total">支出 ${money(g.total)}</span>
      </div>
      ${g.items.map(it => `
        <div class="record-item">
          <div class="record-icon">${getIcon(it.category)}</div>
          <div class="record-info">
            <div class="record-desc">${escapeHtml(it.description)}</div>
            <div class="record-cat">${it.category} · ${escapeHtml(it.payment_method)}</div>
          </div>
          <div class="record-amount">-${Number(it.amount).toFixed(2)}</div>
          <button class="record-delete" onclick="removeExpense(${it.id})">✕</button>
        </div>
      `).join("")}
    </div>
  `).join("");
}

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
    input.value="";
    lastAddedIds = (data.items || []).map(x => x.id);
    await load();
  }catch(e){msg.textContent="× "+e.message; msg.style.color="#E74C3C"}
  finally{btn.disabled=false;btn.textContent="智能记账"}
}

async function removeExpense(id){
  if(!confirm("确定删除这条账单吗？")) return;
  await fetch("/api/expenses/"+id,{method:"DELETE"});
  await load();
}

function getRangeParams(){
  const range = document.querySelector("#rangeSelect").value;
  const params = {range};
  if(range === "custom"){
    params.start = document.querySelector("#startDate").value;
    params.end = document.querySelector("#endDate").value;
  }
  return params;
}

document.querySelector("#rangeSelect").addEventListener("change", function(){
  document.querySelector("#customRange").style.display = this.value === "custom" ? "flex" : "none";
});

async function sendEmail(){
  const btn=document.querySelector("#exportBtn");
  const p = getRangeParams();
  if(p.range === "custom" && (!p.start || !p.end)){ alert("请选择自定义起止日期"); return; }
  if(p.range === "current" && !lastAddedIds.length){ alert("暂无本次新增记录，请先记账"); return; }
  if(p.range === "current"){ p.ids = lastAddedIds; }
  btn.disabled=true; btn.textContent="发送中…";
  try{
    const r=await fetch("/api/send-email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"发送失败");
    alert("✓ 报表已发送到邮箱，请查收");
  }catch(e){ alert("× 邮件发送失败："+e.message); }
  finally{ btn.disabled=false; btn.textContent="确认导出"; }
}

// 底部导航切换
document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", function(){
    const tab = this.dataset.tab;
    document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
    this.classList.add("active");
    document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
    document.querySelector("#tab-" + tab).classList.add("active");
  });
});

// 中央 ＋ 按钮：聚焦 AI 输入
document.querySelector("#addBtn").addEventListener("click", function(){
  document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
  document.querySelector("#tab-list").classList.add("active");
  document.querySelector(".nav-item[data-tab='list']").classList.add("active");
  document.querySelector("#input").focus();
  window.scrollTo({top:0, behavior:"smooth"});
});

document.querySelector("#submit").addEventListener("click",submitExpense);
document.querySelector("#exportBtn").addEventListener("click",sendEmail);

// 查询功能
document.querySelector("#queryRange").addEventListener("change", function(){
  document.querySelector("#queryCustomRange").style.display = this.value === "custom" ? "flex" : "none";
});

async function runQuery(){
  const range = document.querySelector("#queryRange").value;
  const params = {range};
  if(range === "custom"){
    params.start = document.querySelector("#queryStartDate").value;
    params.end = document.querySelector("#queryEndDate").value;
    if(!params.start || !params.end){ alert("请选择自定义起止日期"); return; }
  }
  const qs = new URLSearchParams(params).toString();
  try{
    const r = await fetch("/api/summary?" + qs);
    const data = await r.json();
    document.querySelector("#queryRangeLabel").textContent = data.range_label;
    document.querySelector("#queryTotal").textContent = money(data.total);
    document.querySelector("#queryCount").textContent = data.count + " 笔";
  }catch(e){ alert("查询失败: " + e.message); }
}
document.querySelector("#queryBtn").addEventListener("click",runQuery);

document.querySelector("#input").addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==="Enter") submitExpense();
});

// 更新头部月份
(function(){
  const now = new Date();
  document.querySelector("#monthLabel").textContent = `${now.getFullYear()}年 ${String(now.getMonth()+1).padStart(2,"0")}月 ▾`;
})();

runQuery();
load();

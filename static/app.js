let chart;

const money = n => "¥" + Number(n || 0).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});

async function load() {
  const [s,e] = await Promise.all([
    fetch("/api/stats").then(r=>r.json()),
    fetch("/api/expenses").then(r=>r.json())
  ]);
  document.querySelector("#total").textContent = money(s.total);
  document.querySelector("#month").textContent = money(s.month_total);
  document.querySelector("#year").textContent = money(s.year_total);
  document.querySelector("#count").textContent = `${s.count} 笔记录`;

  const max = Math.max(...s.category.map(x=>x.value),1);
  document.querySelector("#categoryList").innerHTML = s.category.length
    ? s.category.map(x=>`<div><div class="cat-row"><span>${x.name}</span><b>${money(x.value)}</b></div><div class="bar"><i style="width:${x.value/max*100}%"></i></div></div>`).join("")
    : '<p>暂无消费数据</p>';

  if(chart) chart.destroy();
  chart = new Chart(document.querySelector("#chart"),{
    type:"doughnut",
    data:{labels:s.category.map(x=>x.name),datasets:[{data:s.category.map(x=>x.value)}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:"68%",plugins:{legend:{position:"right",labels:{boxWidth:10,font:{size:11}}}}}
  });

  document.querySelector("#recordsBody").innerHTML = e.items.length
    ? e.items.map(x=>`<tr>
      <td>${x.date}</td><td>${escapeHtml(x.description)}</td>
      <td><span class="pill">${x.category}</span></td>
      <td>${escapeHtml(x.payment_method)}</td>
      <td class="amount">¥${Number(x.amount).toFixed(2)}</td>
      <td><button class="delete-btn" onclick="removeExpense(${x.id})">删除</button></td>
    </tr>`).join("")
    : '<tr><td colspan="6" style="text-align:center;color:#999;padding:35px">还没有账单，先告诉 AI 一笔消费吧</td></tr>';
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

async function submitExpense(){
  const input=document.querySelector("#input"), btn=document.querySelector("#submit"), msg=document.querySelector("#message");
  const text=input.value.trim();
  if(!text){msg.textContent="请输入消费内容";return}
  btn.disabled=true; btn.textContent="AI 分析中…"; msg.textContent="";
  try{
    const r=await fetch("/api/parse",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text})});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"请求失败");
    msg.textContent=`✓ ${data.reply || "已完成记账"}`;
    input.value="";
    await load();
    await sendEmail();
  }catch(e){msg.textContent="× "+e.message}
  finally{btn.disabled=false;btn.textContent="智能记账 →"}
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
  const msg=document.querySelector("#message");
  const p = getRangeParams();
  if(p.range === "custom" && (!p.start || !p.end)){ return; }
  try{
    const r=await fetch("/api/send-email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"发送失败");
    if(msg) msg.textContent += "（报表已发送到邮箱）";
  }catch(e){ if(msg) msg.textContent += "（邮件发送失败："+e.message+"）"; }
}

document.querySelector("#submit").addEventListener("click",submitExpense);

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
runQuery();
document.querySelector("#input").addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==="Enter") submitExpense();
});
load();

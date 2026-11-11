const $=id=>document.getElementById(id);
const socket=window.io?io():null;
function loadJson(key,fallback){try{const value=JSON.parse(localStorage.getItem(key)||"null");return value??fallback}catch(err){console.warn("Invalid local data:",key,err);return fallback}}
let room="CLASS10", index=0, showAnswer=false, timer=null, remaining=30, editing=null, remoteReady=false;
let questions=loadJson("sc_questions",null)||[
{ id:1,cls:"Class 6",subject:"Science",chapter:"प्रकाश संश्लेषण",hi:"पौधे अपना भोजन किस प्रक्रिया से बनाते हैं?",en:"By which process do plants make their food?",opts:["श्वसन / Respiration","प्रकाश संश्लेषण / Photosynthesis","वाष्पोत्सर्जन / Transpiration","पाचन / Digestion"],answer:1,explain:"हरे पौधे सूर्य के प्रकाश की सहायता से भोजन बनाते हैं।"},
{ id:2,cls:"Class 7",subject:"Science",chapter:"मानव शरीर",hi:"मानव शरीर में रक्त को पंप कौन करता है?",en:"Which organ pumps blood in the human body?",opts:["फेफड़े / Lungs","मस्तिष्क / Brain","हृदय / Heart","गुर्दे / Kidneys"],answer:2,explain:"हृदय रक्त को पूरे शरीर में पंप करता है।"},
{ id:3,cls:"Class 8",subject:"Maths",chapter:"बीजगणित",hi:"यदि x + 5 = 12, तो x का मान क्या होगा?",en:"If x + 5 = 12, what is the value of x?",opts:["5","6","7","8"],answer:2,explain:"x = 12 - 5 = 7"},
{ id:4,cls:"Class 9",subject:"Science",chapter:"गति",hi:"वेग का SI मात्रक क्या है?",en:"What is the SI unit of velocity?",opts:["मीटर / m","मीटर/सेकंड / m/s","सेकंड / s","किलोमीटर / km"],answer:1,explain:"वेग = विस्थापन / समय, इसलिए SI मात्रक m/s है।"},
{ id:5,cls:"Class 10",subject:"Science",chapter:"विद्युत",hi:"विद्युत धारा का SI मात्रक क्या है?",en:"What is the SI unit of electric current?",opts:["वोल्ट / Volt","ओम / Ohm","एम्पियर / Ampere","वाट / Watt"],answer:2,explain:"विद्युत धारा का SI मात्रक एम्पियर है।"},
{ id:6,cls:"Class 10",subject:"Maths",chapter:"त्रिकोणमिति",hi:"sin 30° का मान कितना होता है?",en:"What is the value of sin 30°?",opts:["0","1/2","√3/2","1"],answer:1,explain:"sin 30° = 1/2"},
{ id:7,cls:"Class 8",subject:"Social Science",chapter:"भारत",hi:"भारत का संविधान कब लागू हुआ?",en:"When did the Constitution of India come into effect?",opts:["15 अगस्त 1947","26 जनवरी 1950","2 अक्टूबर 1950","26 नवंबर 1949"],answer:1,explain:"भारतीय संविधान 26 जनवरी 1950 को लागू हुआ।"},
{ id:8,cls:"Class 6",subject:"English",chapter:"Grammar",hi:"'Child' का plural क्या है?",en:"What is the plural of 'child'?",opts:["Childs","Childes","Children","Childrens"],answer:2,explain:"Child का irregular plural Children है।"}
];
if(!Array.isArray(questions))questions=[];
let selectedQuestionIds = new Set();
function persist(){
 localStorage.setItem("sc_questions",JSON.stringify(questions));
 $("totalCount").textContent=questions.length;
 selectedQuestionIds=new Set([...selectedQuestionIds].filter(id=>questions.some(q=>String(q.id)===id)));
 renderList();renderController();broadcast();
 if(typeof updateDashboardOverview==="function")updateDashboardOverview();
 const adminKey=localStorage.getItem("sc_admin_key")||"";
 if(remoteReady&&adminKey){
  fetch("/api/questions",{method:"PUT",headers:{"Content-Type":"application/json","X-Admin-Key":adminKey},body:JSON.stringify({questions})})
   .then(r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r.json()})
   .catch(err=>{console.warn("Cloud question save failed:",err);toast("Cloud save failed — Admin Key जाँचें")});
 }
}
function toast(t){let el=$("toast");el.textContent=t;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2200)}
let controllerFilter={cls:"all",subjects:[],chapters:[]};
function getControllerQuestions(){
 return questions.filter(q=>(controllerFilter.cls==="all"||q.cls===controllerFilter.cls)&&(!controllerFilter.subjects.length||controllerFilter.subjects.includes(q.subject))&&(!controllerFilter.chapters.length||controllerFilter.chapters.includes(q.chapter)));
}
function current(){const list=getControllerQuestions();return list.length?list[Math.max(0,Math.min(index,list.length-1))]:null}
function state(){const list=getControllerQuestions();return {questions:list,index,showAnswer,room,language:$("displayLanguage")?.value||"both",progress:$("showProgress")?.checked!==false};}
function broadcast(){if(socket)socket.emit("class-state",{room,state:state()});}
if(socket){
 socket.on("connect",()=>{$("connectionStatus").textContent="Connected";socket.emit("join-room",room)});
 socket.on("joined",()=>{$("connectionStatus").textContent="Connected"});
 socket.on("class-state",s=>{if(!s)return;if(Array.isArray(s.questions)){questions=s.questions;localStorage.setItem("sc_questions",JSON.stringify(questions));remoteReady=true}$("totalCount").textContent=questions.length;index=Math.max(0,Math.min(Number(s.index)||0,Math.max(0,questions.length-1)));showAnswer=!!s.showAnswer;renderController();renderList()});
 socket.on("disconnect",()=>{$("connectionStatus").textContent="Offline"});
}
async function bootstrapRemote(){
 try{
  const response=await fetch("/api/questions",{cache:"no-store"});
  if(response.ok){
   const data=await response.json();
   if(Array.isArray(data.questions)&&data.questions.length){questions=data.questions;localStorage.setItem("sc_questions",JSON.stringify(questions))}
   remoteReady=true;
  }
 }catch(error){console.warn("Cloud question load unavailable:",error)}
 $("totalCount").textContent=questions.length;renderList();renderController();
 if(socket&&socket.connected)socket.emit("join-room",room);
}
function showPage(id){document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===id));document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.page===id));if(id==="controller")renderController()}
document.querySelectorAll("[data-page]").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.page)));
if($("quickAi"))$("quickAi").onclick=()=>showPage("ai");
function move(n){
 const list=getControllerQuestions();
 if(n>0&&$("questionOrder")?.value==="random"&&list.length>1){let next=index;while(next===index)next=Math.floor(Math.random()*list.length);index=next}
 else index=Math.max(0,Math.min(list.length-1,index+n));
 showAnswer=false;renderController();broadcast();resetTimer()
}
function fillSelect(select,values,placeholder,selected=[]){
 if(!select)return;
 const previous=selected.length?selected:Array.from(select.selectedOptions||[]).map(o=>o.value);
 select.innerHTML=(select.multiple?"":'<option value="all">'+placeholder+'</option>')+values.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join("");
 if(select.multiple){Array.from(select.options).forEach(o=>o.selected=previous.includes(o.value))}
 else select.value=values.includes(previous[0])?previous[0]:"all";
}
function updateControllerOptions(){
 const cls=$("controllerClass"),subs=$("controllerSubjects"),chaps=$("controllerChapters");
 if(!cls||!subs||!chaps)return;
 const oldClass=cls.value||controllerFilter.cls;
 const classes=[...new Set(questions.map(q=>q.cls).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
 fillSelect(cls,classes,"All Classes",[oldClass]);
 controllerFilter.cls=cls.value||"all";
 const scoped=questions.filter(q=>controllerFilter.cls==="all"||q.cls===controllerFilter.cls);
 const subjects=[...new Set(scoped.map(q=>q.subject).filter(Boolean))].sort();
 fillSelect(subs,subjects,"",controllerFilter.subjects);
 const activeSubjects=Array.from(subs.selectedOptions).map(o=>o.value);
 const chapters=[...new Set(scoped.filter(q=>!activeSubjects.length||activeSubjects.includes(q.subject)).map(q=>q.chapter).filter(Boolean))].sort();
 fillSelect(chaps,chapters,"",controllerFilter.chapters);
 controllerFilter.subjects=activeSubjects;
 controllerFilter.chapters=Array.from(chaps.selectedOptions).map(o=>o.value);
}
function renderController(){
 updateControllerOptions();
 const list=getControllerQuestions(),q=current();
 if(!q){$("controllerQuestion").textContent="इस selection में कोई प्रश्न नहीं है। Class, Subject या Chapter बदलें।";$("currentNumber").textContent="0 / 0";$("revealBtn").textContent="Show Answer";$("roomCode").value=room;$("controllerFilterSummary").textContent="No matching questions";return}
 index=Math.max(0,Math.min(index,list.length-1));
 $("controllerQuestion").textContent=[q.hi,q.en].filter(Boolean).join(" / ");
 $("currentNumber").textContent=(index+1)+" / "+list.length;
 $("revealBtn").textContent=showAnswer?"Answer Shown":"Show Answer";
 $("roomCode").value=room;
 $("controllerFilterSummary").textContent=list.length+" questions selected • "+(controllerFilter.cls==="all"?"All classes":controllerFilter.cls)+" • "+(controllerFilter.subjects.length?controllerFilter.subjects.join(", "):"All subjects")+" • "+(controllerFilter.chapters.length?controllerFilter.chapters.join(", "):"All chapters");
}
$("controllerClass").onchange=()=>{controllerFilter.cls=$("controllerClass").value;controllerFilter.subjects=[];controllerFilter.chapters=[];updateControllerOptions();renderController()};
$("controllerSubjects").onchange=()=>{controllerFilter.subjects=Array.from($("controllerSubjects").selectedOptions).map(o=>o.value);controllerFilter.chapters=[];updateControllerOptions();renderController()};
$("controllerChapters").onchange=()=>{controllerFilter.chapters=Array.from($("controllerChapters").selectedOptions).map(o=>o.value);renderController()};
$("applyControllerFilter").onclick=()=>{controllerFilter.cls=$("controllerClass").value;controllerFilter.subjects=Array.from($("controllerSubjects").selectedOptions).map(o=>o.value);controllerFilter.chapters=Array.from($("controllerChapters").selectedOptions).map(o=>o.value);index=0;showAnswer=false;renderController();broadcast();resetTimer();toast(getControllerQuestions().length+" questions loaded on TV")};
$("resetControllerFilter").onclick=()=>{controllerFilter={cls:"all",subjects:[],chapters:[]};$("controllerClass").value="all";Array.from($("controllerSubjects").options).forEach(o=>o.selected=false);Array.from($("controllerChapters").options).forEach(o=>o.selected=false);index=0;showAnswer=false;renderController();broadcast();resetTimer()};
$("prevBtn").onclick=()=>move(-1);$("nextBtn").onclick=()=>move(1);$("revealBtn").onclick=()=>{showAnswer=true;renderController();broadcast()};$("resetBtn").onclick=()=>{showAnswer=false;renderController();broadcast()};
function updateFilterOptions(){
 const classSelect=$("classFilter"),subjectSelect=$("subjectFilter"),chapterSelect=$("chapterFilter");
 if(!classSelect||!subjectSelect||!chapterSelect)return;
 const currentClass=classSelect.value||"all",currentSubject=subjectSelect.value||"all",currentChapter=chapterSelect.value||"all";
 const classes=[...new Set(questions.map(q=>String(q.cls||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
 const subjects=[...new Set(questions.filter(q=>currentClass==="all"||q.cls===currentClass).map(q=>String(q.subject||"").trim()).filter(Boolean))].sort();
 const chapters=[...new Set(questions.filter(q=>(currentClass==="all"||q.cls===currentClass)&&(currentSubject==="all"||q.subject===currentSubject)).map(q=>String(q.chapter||"").trim()).filter(Boolean))].sort();
 classSelect.innerHTML='<option value="all">All Classes</option>'+classes.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join("");
 subjectSelect.innerHTML='<option value="all">All Subjects</option>'+subjects.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join("");
 chapterSelect.innerHTML='<option value="all">All Chapters</option>'+chapters.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join("");
 classSelect.value=classes.includes(currentClass)?currentClass:"all";
 subjectSelect.value=subjects.includes(currentSubject)?currentSubject:"all";
 chapterSelect.value=chapters.includes(currentChapter)?currentChapter:"all";
}
function getFilteredQuestions(){
 const c=$("classFilter")?.value||"all", s=$("subjectFilter")?.value||"all";
 const term=($("searchQuestion")?.value||"").trim().toLocaleLowerCase();
 const chapter=$("chapterFilter")?.value||"all";
 return questions.filter(q=>{
  const haystack=[q.hi,q.en,q.chapter,q.subject,...(Array.isArray(q.opts)?q.opts:(Array.isArray(q.options)?q.options:[]))].join(" ").toLocaleLowerCase();
  return (c==="all"||q.cls===c)&&(s==="all"||q.subject===s)&&(!term||haystack.includes(term))&&(chapter==="all"||String(q.chapter||"")===chapter);
 });
}
function renderList(){
 updateFilterOptions();
 const filtered=getFilteredQuestions().slice();
 const sort=$("questionSort")?.value||"recent";
 const textCompare=(a,b)=>String(a||"").localeCompare(String(b||""),undefined,{numeric:true,sensitivity:"base"});
 filtered.sort((a,b)=>sort==="oldest"?Number(a.id)-Number(b.id):sort==="class"?textCompare(a.cls,b.cls)||textCompare(a.subject,b.subject):sort==="subject"?textCompare(a.subject,b.subject)||textCompare(a.chapter,b.chapter):sort==="chapter"?textCompare(a.chapter,b.chapter)||textCompare(a.subject,b.subject):Number(b.id)-Number(a.id));
 const list=$("questionList");
 if(!list)return;
 if($("questionResultCount"))$("questionResultCount").textContent="Showing "+filtered.length+" of "+questions.length+" questions";
 const selectedVisible=filtered.filter(q=>selectedQuestionIds.has(String(q.id))).length;
 const allVisibleSelected=filtered.length>0&&selectedVisible===filtered.length;
 const bulk=$("bulkActions");
 if(bulk){
  bulk.classList.toggle("hidden",filtered.length===0);
  $("selectedCount").textContent=selectedQuestionIds.size+" selected";
 }
 $("selectAllFiltered").checked=allVisibleSelected;
 $("selectAllFiltered").indeterminate=selectedVisible>0&&!allVisibleSelected;
 list.innerHTML=filtered.map(q=>`<div class="q-row"><label class="row-select"><input type="checkbox" data-select="${esc(q.id)}" ${selectedQuestionIds.has(String(q.id))?"checked":""} aria-label="Select question"></label><div class="q-main"><b>${esc(q.hi||q.en||"Untitled question")}</b><small>${esc(q.cls)} • ${esc(q.subject)} • ${esc(q.chapter)}</small></div><div class="q-actions"><button data-edit="${esc(q.id)}">Edit</button><button data-del="${esc(q.id)}">Delete</button></div></div>`).join("")||"<p class='empty-state'>No questions found. फ़िल्टर बदलकर देखें या नया प्रश्न जोड़ें।</p>";
 list.querySelectorAll("[data-select]").forEach(b=>b.onchange=()=>{
  const id=String(b.dataset.select);if(b.checked)selectedQuestionIds.add(id);else selectedQuestionIds.delete(id);renderList();
 });
 list.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{
  const id=String(b.dataset.del);if(!confirm("क्या आप यह प्रश्न delete करना चाहते हैं?"))return;
  questions=questions.filter(q=>String(q.id)!==id);selectedQuestionIds.delete(id);index=Math.min(index,Math.max(0,questions.length-1));persist();
 });
 list.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>editQuestion(b.dataset.edit));
}
function esc(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
["classFilter","subjectFilter","questionSort"].forEach(id=>$(id)?.addEventListener("change",renderList));
$("searchQuestion").addEventListener("input",renderList);
$("chapterFilter").addEventListener("change",renderList);
if($("clearFilters"))$("clearFilters").onclick=()=>{
 $("classFilter").value="all";$("subjectFilter").value="all";$("chapterFilter").value="all";$("searchQuestion").value="";if($("questionSort"))$("questionSort").value="recent";
 selectedQuestionIds.clear();renderList();
};
if($("selectAllFiltered"))$("selectAllFiltered").onchange=e=>{getFilteredQuestions().forEach(q=>{const id=String(q.id);if(e.target.checked)selectedQuestionIds.add(id);else selectedQuestionIds.delete(id)});renderList()};
if($("deleteSelected"))$("deleteSelected").onclick=()=>{const ids=new Set(selectedQuestionIds);if(!ids.size)return;if(!confirm(`${ids.size} selected questions delete करें? यह action वापस नहीं होगा।`))return;questions=questions.filter(q=>!ids.has(String(q.id)));selectedQuestionIds.clear();index=Math.min(index,Math.max(0,questions.length-1));persist();toast("Selected questions deleted")};
function clearForm(){editing=null;["qChapter","qHi","qEn","optA","optB","optC","optD","qExplanation"].forEach(id=>$(id).value="");$("qAnswer").value="0";$("editorTitle").textContent="Add Question"}
function setSelectValue(select,value){
 const v=String(value||"");
 if(v&&!Array.from(select.options).some(o=>o.value===v)){
  const opt=document.createElement("option");opt.value=v;opt.textContent=v;select.appendChild(opt);
 }
 select.value=v||select.options[0]?.value||"";
}
function editQuestion(id){
 let q=questions.find(x=>String(x.id)===String(id));if(!q)return;
 editing=q.id;
 setSelectValue($("qClass"),q.cls||"Class 6");setSelectValue($("qSubject"),q.subject||"Science");$("qChapter").value=q.chapter||"";$("qHi").value=q.hi||"";$("qEn").value=q.en||"";
 // Support both current and older question-bank field names.
 const opts=Array.isArray(q.opts)?q.opts:(Array.isArray(q.options)?q.options:[q.A,q.B,q.C,q.D]);
 ["optA","optB","optC","optD"].forEach((field,i)=>$(field).value=String(opts[i]??""));
 $("qAnswer").value=String(Number.isInteger(+q.answer)?Math.max(0,Math.min(3,+q.answer)):0);$("qExplanation").value=q.explain||q.explanation||"";
 $("editorTitle").textContent="Edit Question";$("editor").classList.remove("hidden");$("editor").scrollIntoView({behavior:"smooth"});
}
$("addQuestion").onclick=()=>{$("editor").classList.remove("hidden");clearForm()};$("closeEditor").onclick=()=>$("editor").classList.add("hidden");
$("saveQuestion").onclick=()=>{
 const q={id:editing||Date.now(),cls:$("qClass").value.trim(),subject:$("qSubject").value.trim(),chapter:$("qChapter").value.trim(),hi:$("qHi").value.trim(),en:$("qEn").value.trim(),opts:["optA","optB","optC","optD"].map(id=>$(id).value.trim()),answer:+$("qAnswer").value,explain:$("qExplanation").value.trim()};
 if(!q.hi&&!q.en){toast("Question लिखें");return}
 if(!q.chapter){toast("Chapter का नाम भरें");$("qChapter").focus();return}
 const missing=q.opts.findIndex(v=>!v);if(missing>=0){const field="opt"+String.fromCharCode(65+missing);toast("Option "+String.fromCharCode(65+missing)+" खाली है");$(field).focus();return}
 const fingerprint=v=>[v.cls,v.subject,v.chapter,(v.hi||v.en).trim().toLocaleLowerCase()].join("|");
 const duplicate=questions.find(v=>String(v.id)!==String(editing)&&fingerprint(v)===fingerprint(q));
 if(duplicate){toast("यह question पहले से मौजूद है");return}
 if(editing)questions=questions.map(x=>String(x.id)===String(editing)?q:x);else questions.push(q);
 index=Math.max(0,getControllerQuestions().length-1);persist();$("editor").classList.add("hidden");toast(editing?"Question updated":"Question saved")
}
function openTv(){window.open("/tv.html","_blank","noopener")}
$("startTv").onclick=openTv;$("quickTv").onclick=openTv;$("openController").onclick=()=>showPage("controller");$("quickController").onclick=()=>showPage("controller");
$("joinRoom").onclick=()=>{room=$("roomCode").value.trim().toUpperCase()||"CLASS10";if(socket)socket.emit("join-room",room);$("roomStatus").textContent="Room: "+room;broadcast();toast("Room connected: "+room)};
function resetTimer(){remaining=+$("duration").value;renderTimer()}
function renderTimer(){$("timerDisplay").textContent="00:"+String(remaining).padStart(2,"0")}
$("duration").onchange=resetTimer;
$("timerStart").onclick=()=>{if(timer)return;timer=setInterval(()=>{remaining--;renderTimer();if(remaining<=0){if($("autoReveal").checked&&!showAnswer){showAnswer=true;broadcast();remaining=5}else{move(1);return}}},1000)};
$("timerPause").onclick=()=>{clearInterval(timer);timer=null};$("timerReset").onclick=()=>{clearInterval(timer);timer=null;resetTimer()};resetTimer();
$("saveSettings").onclick=()=>{
 localStorage.setItem("sc_language",$("displayLanguage").value);
 localStorage.setItem("sc_order",$("questionOrder").value);
 const adminKey=$("adminApiKey")?.value.trim()||"";
 if(adminKey)localStorage.setItem("sc_admin_key",adminKey);else localStorage.removeItem("sc_admin_key");
 broadcast();toast("Settings saved");
};
$("displayLanguage").value=localStorage.getItem("sc_language")||"both";$("questionOrder").value=localStorage.getItem("sc_order")||"normal";if($("adminApiKey"))$("adminApiKey").value=localStorage.getItem("sc_admin_key")||"";
window.addEventListener("keydown",e=>{if(document.activeElement.matches("input,textarea,select"))return;if(e.key==="ArrowRight")move(1);if(e.key==="ArrowLeft")move(-1);if(e.key==="Enter"||e.key===" ") {showAnswer=!showAnswer;broadcast();}});
renderList();renderController();bootstrapRemote();
// Upgrade v2: CSV import/export and student performance
let scores=loadJson("sc_scores",[]);
function updateDashboardOverview(){
 const classes=new Set(questions.map(q=>String(q.cls||"").trim()).filter(Boolean));
 const correct=scores.filter(x=>x.correct).length;
 if($("dashboardClassCount"))$("dashboardClassCount").textContent=classes.size;
 if($("dashboardAttempts"))$("dashboardAttempts").textContent=scores.length;
 if($("dashboardAccuracy"))$("dashboardAccuracy").textContent=(scores.length?Math.round(correct/scores.length*100):0)+"%";
 if($("dashboardRecent")){
  const recent=[...scores].sort((a,b)=>String(b.time||"").localeCompare(String(a.time||""))).slice(0,5);
  $("dashboardRecent").innerHTML=recent.length?recent.map(x=>"<div class=\"recent-row\"><span><b>"+esc(x.name||"Student")+"</b><small>"+esc(x.question||"Question attempt")+"</small></span><strong class=\""+(x.correct?"is-correct":"is-wrong")+"\">"+(x.correct?"Correct":"Incorrect")+"</strong></div>").join(""):"<p class=\"muted\">अभी कोई activity नहीं है। Controller में score दर्ज करें।</p>";
 }
}
function saveScores(){localStorage.setItem("sc_scores",JSON.stringify(scores));renderScores()}
function renderScores(){
 const period=$("scorePeriod")?.value||"all";const cutoff=period==="all"?0:Date.now()-Number(period)*86400000;const visible=scores.filter(x=>!cutoff||!Number.isFinite(Date.parse(x.time||""))||Date.parse(x.time)>=cutoff);
 const correct=visible.filter(x=>x.correct).length, wrong=visible.length-correct;
 if($("attemptCount"))$("attemptCount").textContent=visible.length;
 if($("correctCount"))$("correctCount").textContent=correct;
 if($("wrongCount"))$("wrongCount").textContent=wrong;
 if($("accuracyCount"))$("accuracyCount").textContent=(visible.length?Math.round(correct/visible.length*100):0)+"%";
 const grouped={};scores.forEach(x=>{let k=x.name||"Unnamed";grouped[k]??={correct:0,wrong:0};grouped[k][x.correct?"correct":"wrong"]++});
 if($("scoreboard"))$("scoreboard").innerHTML=Object.keys(grouped).length?`<table><thead><tr><th>Student</th><th>Correct</th><th>Incorrect</th><th>Score</th></tr></thead><tbody>${Object.entries(grouped).map(([n,v])=>`<tr><td>${esc(n)}</td><td>${v.correct}</td><td>${v.wrong}</td><td><b>${v.correct}</b></td></tr>`).join("")}</tbody></table>`:"<p class='muted'>अभी कोई score दर्ज नहीं है। Controller में बच्चे का नाम लिखकर Correct या Incorrect दबाएँ।</p>";
 updateDashboardOverview();
}
function recordScore(correct){
 const name=$("studentName")?.value.trim();
 if(!name){toast("पहले बच्चे का नाम लिखें");return}
 const q=current();scores.push({name,correct,question:q?.hi||"",class:q?.cls||"",subject:q?.subject||"",time:new Date().toISOString()});
 saveScores();updateDashboardOverview();toast(correct?"Correct answer दर्ज हुआ (+1)":"Incorrect answer दर्ज हुआ");
}
if($("markCorrect"))$("markCorrect").onclick=()=>recordScore(true);
if($("markWrong"))$("markWrong").onclick=()=>recordScore(false);
if($("clearScores"))$("clearScores").onclick=()=>{if(confirm("सभी score records हटाएँ?")){scores=[];saveScores();toast("Score records cleared")}};
if($("scorePeriod"))$("scorePeriod").onchange=renderScores;
if($("exportScores"))$("exportScores").onclick=()=>{const rows=[["Student","Correct","Question","Class","Subject","Time"],...scores.map(x=>[x.name,x.correct?"Yes":"No",x.question,x.class,x.subject,x.time])];const csv=rows.map(r=>r.map(csvCell).join(",")).join(nl);const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download="smart-classroom-performance.csv";link.click();URL.revokeObjectURL(url)};
function csvCell(v){return '"'+String(v??"").replace(/"/g,'""')+'"'}
if($("exportCsv"))$("exportCsv").onclick=()=>{
 const header=["class","subject","chapter","hi","en","A","B","C","D","answer","explain"];
 const rows=[header,...questions.map(q=>{
  const opts=Array.isArray(q.opts)?q.opts:(Array.isArray(q.options)?q.options:[q.A,q.B,q.C,q.D]);
  return [q.cls,q.subject,q.chapter,q.hi,q.en,...[0,1,2,3].map(i=>opts[i]??""),q.answer,q.explain??q.explanation??""];
 })];
 const csv="\uFEFF"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n");
 const a=document.createElement("a"),url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 a.href=url;a.download="smart-classroom-questions.csv";a.click();URL.revokeObjectURL(url);
};
function parseCsv(text){
 const rows=[];let row=[],cell="",quoted=false;
 text=String(text||"").replace(/^\uFEFF/,"");
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'&&quoted&&text[i+1]==='"'){cell+='"';i++}
  else if(c==='"'){quoted=!quoted}
  else if(c===','&&!quoted){row.push(cell);cell=""}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>String(x).trim()))rows.push(row);row=[];cell=""}
  else cell+=c;
 }
 row.push(cell);if(row.some(x=>String(x).trim()))rows.push(row);
 if(quoted)throw new Error("CSV में double quote बंद नहीं है");
 return rows;
}
if($("importCsvBtn"))$("importCsvBtn").onclick=()=>$("importCsv").click();
if($("importCsv"))$("importCsv").onchange=async e=>{
 const file=e.target.files[0];if(!file)return;
 try{
  const rows=parseCsv(await file.text());if(rows.length<2)throw new Error("CSV में प्रश्न नहीं मिले");
  const headers=rows.shift().map(x=>String(x).replace(/^\uFEFF/,"").trim().toLowerCase());
  const col=name=>headers.indexOf(name);
  const aliases={class:["class","cls"],subject:["subject"],chapter:["chapter"],hi:["hi","question_hi","hindi"],en:["en","question_en","english"],A:["a","option a","option_a"],B:["b","option b","option_b"],C:["c","option c","option_c"],D:["d","option d","option_d"],answer:["answer","correct answer","correct_answer"],explain:["explain","explanation"]};
  const findCol=name=>{for(const key of aliases[name]||[name]){const i=col(key);if(i>=0)return i}return -1};
  const get=(r,name)=>{const i=findCol(name);return i>=0?String(r[i]??"").trim():""};
  const required=["A","B","C","D"],missing=required.filter(k=>findCol(k)<0);
  if(missing.length)throw new Error("Option columns missing: "+missing.join(", "));
  const imported=rows.map((r,i)=>{
   const rawAnswer=get(r,"answer");let answer=Number(rawAnswer);
   const answerText=String(rawAnswer).trim().toUpperCase();
   if(["A","B","C","D"].includes(answerText))answer=["A","B","C","D"].indexOf(answerText);
   else if(!Number.isFinite(answer)||!Number.isInteger(answer)||answer<0||answer>3)
    throw new Error(`Row ${i+2}: answer 0–3 या A/B/C/D होना चाहिए`);
   return {id:Date.now()+i,cls:get(r,"class")||"Class 6",subject:get(r,"subject")||"Science",chapter:get(r,"chapter")||"General",hi:get(r,"hi"),en:get(r,"en"),opts:["A","B","C","D"].map(k=>get(r,k)),answer,explain:get(r,"explain")};
  }).filter(q=>q.hi||q.en);
  if(!imported.length)throw new Error("CSV में valid questions नहीं मिले");
  const emptyOptions=imported.filter(q=>q.opts.some(v=>!v));
  if(emptyOptions.length)throw new Error(emptyOptions.length+" प्रश्नों में कुछ options खाली हैं। CSV header A, B, C, D जाँचें।");
  questions.push(...imported);persist();toast(imported.length+" questions imported");
 }catch(err){toast("Import failed: "+err.message);console.error(err)}finally{e.target.value=""}
};
renderScores();
updateDashboardOverview();

/* Gemini AI question generator */
let aiGeneratedQuestions = [];
if ($("aiGenerate")) $("aiGenerate").onclick = async () => {
 const status=$("aiStatus"), preview=$("aiPreview"), button=$("aiGenerate");
 const adminKey=localStorage.getItem("sc_admin_key")||"";
 if(!adminKey){toast("पहले Settings में Cloud Admin API Key सेव करें");showPage("settings");return}
 const payload={cls:$("aiClass").value,subject:$("aiSubject").value.trim(),chapter:$("aiChapter").value.trim(),count:+$("aiCount").value,difficulty:$("aiDifficulty").value,language:$("aiLanguage").value};
 if(!payload.subject||!payload.chapter){toast("Subject और Chapter भरें");return}
 button.disabled=true;button.textContent="Generating...";status.textContent="Gemini सवाल तैयार कर रहा है...";preview.innerHTML="";$("aiSave").classList.add("hidden");
 try{
  const response=await fetch("/api/ai/generate",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Key":adminKey},body:JSON.stringify(payload)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||"Generation failed");
  aiGeneratedQuestions=data.questions||[];
  preview.innerHTML=aiGeneratedQuestions.map((q,i)=>"<article class='q-row'><div><b>"+(i+1)+". "+esc(q.hi||q.en)+"</b><small>"+esc(q.en||"")+"</small><small>"+q.opts.map((o,j)=>String.fromCharCode(65+j)+". "+esc(o)).join(" · ")+"</small><small>Correct: "+String.fromCharCode(65+q.answer)+" — "+esc(q.explain)+"</small></div></article>").join("");
  status.textContent=aiGeneratedQuestions.length+" सवाल तैयार हैं। Save करने से पहले Preview जाँच लें।";
  $("aiSave").classList.remove("hidden");
 }catch(error){status.textContent=error.message;toast("Gemini: "+error.message)}
 finally{button.disabled=false;button.textContent="✨ Generate Questions"}
};
if ($("aiSave")) $("aiSave").onclick = async () => {
 if(!aiGeneratedQuestions.length)return;
 const existing=new Set(questions.map(q=>[q.cls,q.subject,q.chapter,(q.hi||q.en).trim().toLowerCase()].join("|")));
 const additions=aiGeneratedQuestions.filter(q=>{const key=[q.cls,q.subject,q.chapter,(q.hi||q.en).trim().toLowerCase()].join("|");if(existing.has(key))return false;existing.add(key);return true});
 if(!additions.length){toast("ये सभी सवाल पहले से मौजूद हैं");return}
 questions.push(...additions);index=questions.length-1;persist();
 $("aiStatus").textContent=additions.length+" नए सवाल Question Bank में जोड़ दिए गए।";
 $("aiPreview").innerHTML="";$("aiSave").classList.add("hidden");aiGeneratedQuestions=[];
 toast(additions.length+" AI questions added");
};

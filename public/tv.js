const $=id=>document.getElementById(id);
let state={questions:[],index:0,showAnswer:false,language:"both",progress:true};
let room=new URLSearchParams(location.search).get("room")||"CLASS10";
const socket=window.io?io():null;
if(socket){socket.on("connect",()=>{socket.emit("join-room",room);$("tvTimer").textContent="REMOTE: CONNECTED";});socket.on("disconnect",()=>{$("tvTimer").textContent="REMOTE: OFFLINE";});socket.on("class-state",s=>{state=s;render();});}
function escHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function render(){const q=state.questions?.[state.index];if(!q){$("tvQuestion").textContent="मोबाइल Controller से सवाल शुरू करें";$("tvQuestionEn").textContent="";$("tvOptions").innerHTML="";$("tvAnswer").classList.add("hidden");$("tvCounter").textContent="NO QUESTIONS";$("tvProgress").style.width="0%";return;}
$("tvClass").textContent=(q.cls||"CLASS")+" • "+(q.subject||"");$("tvChapter").textContent="CHAPTER • "+(q.chapter||"GENERAL");$("tvCounter").textContent=`QUESTION ${String(state.index+1).padStart(2,"0")} / ${state.questions.length}`;$("tvProgress").style.width=state.progress===false?"0%":((state.index+1)/state.questions.length*100)+"%";
const lang=state.language||"both";$("tvQuestion").textContent=lang==="en"?(q.en||q.hi):(q.hi||q.en);$("tvQuestionEn").textContent=lang==="both"?(q.en||""):"";const opts=Array.isArray(q.opts)?q.opts:(Array.isArray(q.options)?q.options:[q.A,q.B,q.C,q.D]);
$("tvOptions").innerHTML=opts.map((o,i)=>`<div class="tv-option ${state.showAnswer&&i===Number(q.answer)?"is-correct":""}"><b>${"ABCD"[i]}.</b><span>${escHtml(o)}</span>${state.showAnswer&&i===Number(q.answer)?"<strong class=\"correct-mark\">✓</strong>":""}</div>`).join("");
$("tvAnswer").classList.toggle("hidden",!state.showAnswer);$("tvAnswer").textContent=state.showAnswer?`✓ सही उत्तर / Correct Answer: ${"ABCD"[q.answer]||"—"}${q.explain?" — "+q.explain:""}`:"";}
function send(){if(socket&&socket.connected)socket.emit("class-state",{room,state});render();}
function toggleFullscreen(){if(!document.fullscreenElement){document.documentElement.requestFullscreen?.().catch(()=>{});}else{document.exitFullscreen?.();}}
$("tvFullscreen")?.addEventListener("click",toggleFullscreen);
function updateClock(){const el=$("tvClock");if(el)el.textContent=new Intl.DateTimeFormat(undefined,{hour:"2-digit",minute:"2-digit"}).format(new Date());}
updateClock();setInterval(updateClock,30000);
function handleRemote(e){const code=e.keyCode||e.which,key=e.key;if(key==="f"||key==="F"){e.preventDefault();toggleFullscreen();return;}const left=key==="ArrowLeft"||code===37,right=key==="ArrowRight"||code===39,ok=key==="Enter"||key===" "||code===13,up=key==="ArrowUp"||code===38,down=key==="ArrowDown"||code===40,back=code===461;
if(left||right||ok||up||down||back){e.preventDefault();e.stopPropagation();if(left){state.index=Math.max(0,state.index-1);state.showAnswer=false;}else if(right){state.index=Math.min((state.questions||[]).length-1,state.index+1);state.showAnswer=false;}else if(ok||up){state.showAnswer=!state.showAnswer;}else{state.showAnswer=false;}$("tvTimer").textContent=`REMOTE KEY: ${code} • ${left?"PREVIOUS":right?"NEXT":ok?"ANSWER":up?"SHOW":down?"HIDE":"BACK"}`;send();}}
document.addEventListener("keydown",handleRemote,true);window.addEventListener("load",()=>{document.body.focus();render();});document.addEventListener("visibilitychange",()=>{if(!document.hidden)document.body.focus();});render();

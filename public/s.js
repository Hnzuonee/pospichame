(()=>{const b=document.getElementById("cta"),m=document.getElementById("msg");let busy=false,ok=false;
function t(s){m.textContent=s||""}
function loadTs(cb){if(window.turnstile){cb();return}
  const s=document.createElement("script"); s.src="https://challenges.cloudflare.com/turnstile/v0/api.js"; s.async=true; s.defer=true;
  s.onload=cb; s.onerror=()=>{busy=false;t("Ověření není dostupné. Zkus později.")}; document.head.appendChild(s);
}
function ensureWidget(){let w=document.getElementById("w"); if(!w){
  w=document.createElement("div"); w.id="w"; w.className="cf-turnstile";
  w.setAttribute("data-sitekey","0x4AAAAAAB3aoUBtDi_jhPAf");
  w.setAttribute("data-size","flexible");
  w.setAttribute("data-callback","__tsOK");
  w.setAttribute("data-error-callback","__tsErr");
  w.setAttribute("data-timeout-callback","__tsErr");
  w.style.position="absolute"; w.style.left="-9999px"; w.style.opacity="0"; document.body.appendChild(w);
}}
window.__tsOK=async function(token){
  try{
    const res=await fetch("/v",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({t:token})});
    if(!res.ok){let d=null;try{d=await res.json()}catch{} busy=false;t(d&&d.error?"Server: "+d.error:"Server chyba ("+res.status+")"); if(window.turnstile) turnstile.reset("#w"); return;}
    const d=await res.json(); if(!d||!d.k){busy=false;t("Chybí ticket. Zkus to znovu."); if(window.turnstile) turnstile.reset("#w"); return;}
    ok=true; window.location.href="/g?ticket="+encodeURIComponent(d.k);
  }catch(e){busy=false;t("Síťová chyba. Zkus to znovu."); if(window.turnstile) turnstile.reset("#w");}
};
window.__tsErr=function(){busy=false;t("Chyba ověření. Zkus to prosím znovu.")};

b.addEventListener("click",()=>{ if(busy||ok) return; busy=true; b.disabled=true; t("Ověřuji…");
  loadTs(()=>{ try{ ensureWidget(); if(window.turnstile){ turnstile.reset("#w"); } else { busy=false; b.disabled=false; t("Ověření není dostupné. Zkus později."); } }
  catch(e){ busy=false; b.disabled=false; t("Chyba při spuštění ověření."); } });
});
})();

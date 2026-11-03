// Offline, bounded requirements extractor. Never generates fake business details or publishes.
const MAX=2500;
const clean=s=>String(s||'').trim().replace(/\s+/g,' ');
const patterns={
  restaurant:/restaurant|cafe|coffee shop|مطعم|مقهى|كافيه/i,
  portfolio:/portfolio|personal site|سيرة ذاتية|بورتفوليو|معرض أعمال/i,
  store:/shop|store|ecommerce|متجر|تسوق/i,
  business:/company|agency|business|شركة|مؤسسة/i
};
const features={
  menu:/menu|قائمة الطعام|المنيو|قائمة الأكل/i,
  whatsapp:/whatsapp|واتساب|واتس آب/i,
  booking:/booking|reservation|حجز/i,
  gallery:/gallery|photos|صور|معرض/i,
  contact:/contact|تواصل|اتصل/i,
  blog:/blog|مدونة/i,
  payment:/payment|checkout|دفع|سداد/i,
  bilingual:/bilingual|arabic and english|عربي.*إنجليزي|العربية.*الإنجليزية|لغتين/i
};
function buildBrief(request){
 if(typeof request!=='string'||request.trim().length<3||request.length>MAX||/[\u0000-\u001f]/.test(request))throw Error('Invalid request');
 const text=clean(request);
 const industry=Object.entries(patterns).find(([,p])=>p.test(text))?.[0]||'general';
 const detected=Object.entries(features).filter(([,p])=>p.test(text)).map(([name])=>name);
 const arabic=/[\u0600-\u06ff]/.test(text);
 const languages=detected.includes('bilingual')?['ar','en']:[arabic?'ar':'en'];
 const pages=[{slug:'home',title:'Home'}];
 if(detected.includes('menu'))pages.push({slug:'menu',title:'Menu'});
 if(detected.includes('gallery'))pages.push({slug:'gallery',title:'Gallery'});
 if(detected.includes('contact')||detected.includes('whatsapp'))pages.push({slug:'contact',title:'Contact'});
 if(detected.includes('blog'))pages.push({slug:'blog',title:'Blog'});
 const approvalGates=['Public deployment requires approval'];
 if(detected.includes('payment'))approvalGates.push('Payment integration requires verified provider and approval');
 if(detected.includes('booking'))approvalGates.push('Live reservation integration requires verified booking provider');
 return {schemaVersion:1,mode:'OFFLINE_BRIEF_ONLY',request:text,industry,languages,
  features:detected,pages,requirements:{responsive:true,accessible:true,seoBasics:true,rtl:languages.includes('ar')},
  missingDetails:['Business/project name','Approved contact information','Brand assets or permission to use placeholders'],
  approvalGates,networkCalls:0,paidCalls:0,published:false};
}
export {buildBrief};

export type OmdaTaskCategory = 'website' | 'spreadsheet' | 'job_search' | 'email_draft' | 'research' | 'general';
export type OmdaPlanLocale = 'ar' | 'en';

export interface OmdaPlanStep {
  id: string;
  title: string;
  detail: string;
  status: 'ready' | 'approval_required';
  externalSideEffect: boolean;
}

export interface OmdaTaskPlan {
  planId: string;
  createdAt: string;
  mode: 'plan_only';
  requestSummary: string;
  categories: OmdaTaskCategory[];
  steps: OmdaPlanStep[];
  guardrails: {
    providerCalls: false;
    externalWrites: false;
    publicPublishing: false;
    approvalRequiredFor: string[];
  };
}

type StepCopy = Omit<OmdaPlanStep, 'id'>;
type CategoryCopy = { label: string; steps: StepCopy[] };

const COPY: Record<OmdaTaskCategory, CategoryCopy> = {
  website: {
    label: 'Website',
    steps: [
      { title: 'Define pages and content', detail: 'Turn the requested site into a page map, content outline and responsive layout requirements.', status: 'ready', externalSideEffect: false },
      { title: 'Build a local preview', detail: 'Generate HTML and CSS files for review; do not publish them to a public host.', status: 'ready', externalSideEffect: false },
      { title: 'Check quality and accessibility', detail: 'Check mobile layout, keyboard access, links, metadata and Arabic right-to-left rendering where needed.', status: 'ready', externalSideEffect: false },
      { title: 'Publish the website', detail: 'Public deployment is held until the user explicitly approves the target and release.', status: 'approval_required', externalSideEffect: true },
    ],
  },
  spreadsheet: {
    label: 'Spreadsheet',
    steps: [
      { title: 'Validate the workbook structure', detail: 'Confirm columns, row shapes, cell types and bounded input size.', status: 'ready', externalSideEffect: false },
      { title: 'Generate an Excel or CSV artifact', detail: 'Create a downloadable workbook using text-safe cells and escaped content.', status: 'ready', externalSideEffect: false },
      { title: 'Verify the artifact', detail: 'Check the generated file format, size and representative cell values before offering it.', status: 'ready', externalSideEffect: false },
    ],
  },
  job_search: {
    label: 'Job search',
    steps: [
      { title: 'Set role and eligibility filters', detail: 'Use the requested location, role level, experience and work-authorization constraints.', status: 'ready', externalSideEffect: false },
      { title: 'Research official vacancy sources', detail: 'Collect current vacancy details and official application URLs; mark unavailable evidence instead of guessing.', status: 'ready', externalSideEffect: false },
      { title: 'Deduplicate and assess fit', detail: 'Compare requirements with the supplied CV facts and separate strong, partial and ineligible matches.', status: 'ready', externalSideEffect: false },
      { title: 'Prepare application drafts', detail: 'Prepare tailored CV or email drafts. Sending and job submission remain approval-gated.', status: 'approval_required', externalSideEffect: true },
    ],
  },
  email_draft: {
    label: 'Email',
    steps: [
      { title: 'Draft the message', detail: 'Prepare a factual message in the requested language and tone without inventing qualifications.', status: 'ready', externalSideEffect: false },
      { title: 'Validate recipient and attachments', detail: 'Check the intended recipient and referenced files before creating a draft.', status: 'ready', externalSideEffect: false },
      { title: 'Save for review', detail: 'Keep the message as a draft; do not send it automatically.', status: 'ready', externalSideEffect: false },
      { title: 'Send the email', detail: 'Sending requires explicit approval of the final recipient and message.', status: 'approval_required', externalSideEffect: true },
    ],
  },
  research: {
    label: 'Research',
    steps: [
      { title: 'Define the research scope', detail: 'Identify the question, time window and evidence standard.', status: 'ready', externalSideEffect: false },
      { title: 'Collect and compare sources', detail: 'Prefer primary and official sources; record publication dates and unresolved gaps.', status: 'ready', externalSideEffect: false },
      { title: 'Produce an evidence-backed result', detail: 'Summarize findings with source links and distinguish facts from estimates.', status: 'ready', externalSideEffect: false },
    ],
  },
  general: {
    label: 'General task',
    steps: [
      { title: 'Break the request into deliverables', detail: 'Identify the expected outcome, inputs, dependencies and acceptance checks.', status: 'ready', externalSideEffect: false },
      { title: 'Order the work safely', detail: 'Separate reversible local work from actions that change external systems.', status: 'ready', externalSideEffect: false },
      { title: 'Prepare a verifiable result', detail: 'Define the files, evidence and tests needed to mark the task complete.', status: 'ready', externalSideEffect: false },
    ],
  },
};

const RULES: Array<{ category: Exclude<OmdaTaskCategory, 'general'>; pattern: RegExp }> = [
  { category: 'website', pattern: /\b(website|web site|landing page|web page|online store|e-?commerce)\b|موقع|صفحة\s*(ويب|إلكترونية)|متجر|مطعم/i },
  { category: 'spreadsheet', pattern: /\b(excel|xlsx|spreadsheet|workbook|csv)\b|إكسل|اكسل|جدول|ملف\s*(إكسل|اكسل|جدول)/i },
  { category: 'job_search', pattern: /\b(job search|find jobs|vacanc(y|ies)|career|resume|cv|recruitment)\b|وظائف|وظيفة|شواغر|سيرة\s*ذاتية|تقديم\s*(على|لوظيفة)/i },
  { category: 'email_draft', pattern: /\b(e-?mail|message draft|write an email)\b|بريد|إيميل|ايميل|رسالة\s*(بريد|إلكترونية)/i },
  { category: 'research', pattern: /\b(research|look up|find information|compare sources)\b|ابحث|بحث|تحقق|قارن\s*المصادر/i },
];

export function planOmdaTask(request: string, locale: OmdaPlanLocale = 'en'): OmdaTaskPlan {
  if (typeof request !== 'string') throw new TypeError('Request must be text');
  const normalized = request.normalize('NFKC').trim();
  if (normalized.length < 5) throw new RangeError('Request must contain at least 5 characters');
  if (normalized.length > 4000) throw new RangeError('Request must not exceed 4000 characters');

  const categories: OmdaTaskCategory[] = RULES
    .filter(rule => rule.pattern.test(normalized))
    .map(rule => rule.category);
  if (categories.length === 0) categories.push('general');

  const steps: OmdaPlanStep[] = [];
  for (const category of categories) {
    const prefix = category + '-';
    COPY[category].steps.forEach((step, index) => {
      const title = locale === 'ar' ? translateTitle(category, index) : step.title;
      const detail = locale === 'ar' ? translateDetail(category, index) : step.detail;
      steps.push({ ...step, id: prefix + String(index + 1), title, detail });
    });
  }

  return {
    planId: 'omda-plan-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    mode: 'plan_only',
    requestSummary: normalized.slice(0, 220),
    categories,
    steps,
    guardrails: {
      providerCalls: false,
      externalWrites: false,
      publicPublishing: false,
      approvalRequiredFor: ['send_email', 'submit_job_application', 'publish_website', 'publish_video'],
    },
  };
}

function translateTitle(category: OmdaTaskCategory, index: number): string {
  const titles: Record<OmdaTaskCategory, string[]> = {
    website: ['تحديد الصفحات والمحتوى', 'إنشاء معاينة محلية', 'فحص الجودة وإمكانية الوصول', 'نشر الموقع'],
    spreadsheet: ['التحقق من بنية الجدول', 'إنشاء ملف Excel أو CSV', 'التحقق من الملف الناتج'],
    job_search: ['تحديد الوظائف وشروط الأهلية', 'البحث في المصادر الرسمية', 'إزالة التكرار وتقييم المطابقة', 'تجهيز مسودات التقديم'],
    email_draft: ['كتابة مسودة الرسالة', 'التحقق من المستلم والمرفقات', 'حفظ المسودة للمراجعة', 'إرسال البريد'],
    research: ['تحديد نطاق البحث', 'جمع المصادر ومقارنتها', 'إعداد نتيجة مدعومة بالأدلة'],
    general: ['تقسيم الطلب إلى نتائج قابلة للتسليم', 'ترتيب العمل بأمان', 'تجهيز نتيجة قابلة للتحقق'],
  };
  return titles[category][index] ?? 'خطوة عمل';
}

function translateDetail(category: OmdaTaskCategory, index: number): string {
  const details: Record<OmdaTaskCategory, string[]> = {
    website: ['تحويل طلب الموقع إلى خريطة صفحات ومخطط محتوى ومتطلبات تصميم متجاوب.', 'إنشاء ملفات HTML وCSS للمعاينة دون نشرها على استضافة عامة.', 'فحص الهاتف ولوحة المفاتيح والروابط والبيانات الوصفية واتجاه RTL عند الحاجة.', 'يتوقف النشر العام حتى يوافق المستخدم صراحة على الوجهة والإصدار.'],
    spreadsheet: ['تأكيد الأعمدة وشكل الصفوف وأنواع الخلايا وحدود حجم المدخلات.', 'إنشاء ملف قابل للتنزيل بخلايا نصية آمنة ومحتوى مهروب.', 'فحص صيغة الملف وحجمه وعينات من قيم الخلايا قبل تسليمه.'],
    job_search: ['استخدام الموقع والمسمى والمستوى والخبرة وشروط تصريح العمل المطلوبة.', 'جمع تفاصيل الوظائف الحالية وروابط التقديم الرسمية وعدم تخمين الأدلة الناقصة.', 'مقارنة المتطلبات بحقائق السيرة الذاتية وفصل المطابقات القوية والجزئية وغير المؤهلة.', 'تجهيز مسودات مخصصة؛ يظل الإرسال والتقديم مشروطين بالموافقة.'],
    email_draft: ['إعداد رسالة واقعية باللغة والنبرة المطلوبتين دون اختراع مؤهلات.', 'التحقق من المستلم المقصود والملفات المشار إليها قبل إنشاء المسودة.', 'الاحتفاظ بالرسالة كمسودة وعدم إرسالها تلقائيًا.', 'يتطلب الإرسال موافقة صريحة على المستلم والرسالة النهائية.'],
    research: ['تحديد السؤال والفترة الزمنية ومعيار الأدلة.', 'تفضيل المصادر الأولية والرسمية وتسجيل التواريخ والفجوات.', 'تلخيص النتائج بروابط المصادر وفصل الحقائق عن التقديرات.'],
    general: ['تحديد النتيجة والمدخلات والاعتماديات ومعايير القبول.', 'فصل العمل المحلي القابل للتراجع عن الإجراءات التي تغيّر أنظمة خارجية.', 'تحديد الملفات والأدلة والاختبارات المطلوبة لإعلان الاكتمال.'],
  };
  return details[category][index] ?? 'تنفيذ الخطوة والتحقق من نتيجتها.';
}

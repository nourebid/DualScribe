# مراجعة DualScribe وإضافة Groq

المراجعة: 17 سبتمبر 2026. المصدر: https://github.com/nourebid/DualScribe، على commit `3c3dd57dc9b446ceb3ee846caabe9ad42c2c9465`.

تم تنفيذ التعديل في نسخة محلية مستقلة، وتجهيزه على فرع `GroqDev` لرفعه إلى GitHub بطلب المستخدم. لم يُنشر التطبيق.

## النتيجة والقرار

يمكن إضافة Groq بأقل تدخل عن طريق وسيط أمام نفس endpoint الحالي `/api/transcribe`، مع إبقاء مسار Gemini كما هو. النسخة المنفذة تتيح اختيار **Groq · Whisper Large V3 Turbo** من قائمة الموديلات، وترجع نفس `TranscriptionResult` الذي تستخدمه الواجهة والسجل والتصدير. بقي Gemini هو الاختيار الافتراضي للتوافق مع السلوك السابق.

الاختلاف الوظيفي المهم: نتائج Groq هنا تقسيمات نصية بتوقيتات، وليست تعريفًا للمتحدثين. تعرض الواجهة `Speaker unknown` وتوضح غياب speaker identification. لا يمكن المحافظة على تمييز المتحدثين المزعوم في مسار Gemini بمجرد تبديل API؛ يلزم مكوّن diarization منفصل إذا كان ذلك شرطًا أساسيًا.

## المعمارية الموجودة

```text
React / Vite / Tailwind
  TranscriptionView: اختيار ملف → FileReader → Base64
  services/gemini.ts: POST JSON /api/transcribe
             ↓
Express: server.ts
  Gemini: مفتاح المستخدم من SQLite أو directApiKey
  → GoogleGenAI.models.generateContent(audio inlineData + prompt)
  → parsing + retries/fallbacks → TranscriptionResult
             ↓
App.tsx: حفظ النتيجة عبر /api/transcriptions → SQLite sawtify.db
         العرض والسجل + PDF باستخدام jsPDF + Word باستخدام docx
```

قاعدة البيانات تحتوي `users` و`transcriptions`. الصوت لا يُحفظ على القرص في المسار الحالي؛ النص واللغة واسم الملف يُحفظون في السجل. لا يوجد اتصال بقاعدة بيانات Google أو Firebase. لا توجد خدمة summary مستقلة، أو استخراج action items فعلي، رغم عبارة الزر القديمة “Transcribe & Extract Notes”. ولا يوجد microphone recorder أو WebSocket أو SSE أو استدعاء streaming؛ الرفع والاستجابة كاملان، والتقدم بعد قراءة الملف محاكاة زمنية.

## كل مواضع الاعتماد على Google/Gemini

الأرقام التالية تخص النسخة المحلية المعدّلة؛ أسماء الدوال هي المرجع المستقر.

| الملف / الموضع | الاعتماد الحالي ودوره |
|---|---|
| `server.ts:6` | الاستيراد الوحيد لـ`GoogleGenAI`؛ جميع اتصالات Google تتم في الخادم. |
| `server.ts`، تهيئة SQLite والهجرات | حقل `users.gemini_api_key`، مع masking عند إرجاع حالة المفتاح في login وMFA وprofile. |
| `server.ts:387`، `normalizeModelName` | افتراضي Gemini وإعادة تعيين أسماء موديلات؛ ليس registry ديناميكيًا للموديلات المتاحة. |
| `server.ts:411`، `isTransientOrHighDemandError` | تفسير أخطاء Google 429/503 والرسائل النصية لتحديد retry/fallback. |
| `server.ts:434`، `detectAudioMimeType` | تحليل MIME والامتداد وmagic bytes لتجهيز `inlineData`؛ مشترك من حيث الفكرة لكنه مستخدم في مسار Gemini فقط. |
| `server.ts:505–728` | `extractRawTextFromResponse`, `hasAudibleSpeech`, `isJsonModeError`, `modelSupportsJsonMode`, `extractGeminiErrorMessage`, `detectLanguageFromText`, `parseTranscriptionResult`، ومعها `repairJson` عند السطر 64: تكييف مخرجات Gemini وJSON والنص وتعريفات المتحدثين. |
| `server.ts:729`، `generateTranscriptionWithRetry` | الاستدعاء الفعلي للصوت عبر `ai.models.generateContent`؛ inline audio + prompt عربي/إنجليزي + JSON schema عند دعمها؛ محاولتان لكل موديل، وتغيير الوضع عند رفض JSON، والانتقال إلى fallback عند الفشل أو غياب الكلام. |
| `server.ts:879`، `POST /api/user/api-key` | التحقق من مفتاح Gemini بطلب نصي “Ping” إلى عدة موديلات ثم تخزينه. هذه مكالمة Google إضافية لكنها لا تعالج صوتًا. |
| `server.ts:954,965` | حذف المفتاح وقراءة حالته؛ profile يرجع نسخة masked، لا المفتاح الكامل. |
| `server.ts:985`، `POST /api/transcribe` | اختيار مفتاح Gemini المخزّن قبل المفتاح المباشر، بناء العميل، اختيار الموديل، MIME، قائمة fallback ثم معالجة الأخطاء. |
| `src/services/gemini.ts`، `transcribeAudio` | wrapper لـfetch إلى الخادم؛ الاسم مرتبط بـGemini لكنه لا يستدعي Google مباشرة. كان يكرر تعريف أنواع النتائج. |
| `src/components/TranscriptionView.tsx` | default/model selector، منع التفريغ دون مفتاح Gemini، `handleTranscribe`، MIME/base64، نصوص الحالة، أزرار retry/alternate models/no-speech، والـkey banner. |
| `src/components/ApiKeyModal.tsx` | إدخال مفتاح Google ورابط AI Studio، validation/save عبر الخادم. بقي خاصًا بـGemini. |
| `src/components/SettingsView.tsx` | حالة مفتاح Gemini وإدارته وحذفه؛ عُدّل النص الذي كان يقول إن Gemini هو المزود الوحيد. |
| `src/App.tsx` و`src/types.ts` | `hasApiKey` و`maskedApiKey` وتحديثهما، modal وشارة Gemini؛ بيانات المستخدم في localStorage ليست جلسة موثّقة. |
| `package.json` وlockfiles | اعتماد `@google/genai`؛ بقاؤه مطلوب للتبديل إلى Gemini. |
| `.env.example` | كان يذكر `GEMINI_API_KEY` رغم عدم قراءة هذا المتغير في مسار transcription. صُححت التعليمات بدل افتراض أنه مفتاح مستخدم بالفعل. |
| `vite.config.ts` | يستدعي `loadEnv` لكن لا يعرّف قيم API keys في bundle؛ لم أجد حقنًا لمفتاح Google في كود المتصفح عبر Vite. |

لا توجد مكالمات Google أخرى لمعالجة الصوت في الملفات المتتبعة. عناوين نماذج Gemini الأساسية الموجودة بالكود تظهر في [كتالوج Google الحالي](https://ai.google.dev/gemini-api/docs/models)، لكن توافر موديل للحساب وصحة استخدامه مع SDK لا يُثبتان بلا اختبار API. التعليق الذي يعتبر جميع نسخ 3.5/3.6/3.7 قديمة أو غير موجودة أوسع من الكتالوج الحالي؛ أبقيت سياسة aliases خارج نطاق تعديل Groq.

## التعديل المنفذ على مستوى الملفات والدوال

| الملف | التغيير |
|---|---|
| `server/groq.ts`، `transcribeWithGroq` | adapter مستقل باستخدام `fetch/FormData/Blob` المدمجة، دون SDK جديد. يتحقق من المفتاح وBase64 والحجم والصيغة، ويرسل multipart إلى Groq، ثم يحوّل `verbose_json` إلى الأنواع الحالية. |
| `server/groq.ts`، `GroqError` | أخطاء مستقرة وآمنة: missing/invalid key، 400/415/413، 429 مع `Retry-After`، 502 و504. مهلة 120 ثانية. لا تُعاد أجسام أخطاء المزود ولا تُسجل المفاتيح أو الصوت. |
| `server/transcriptionRoute.ts`، `groqTranscriptionMiddleware` | `provider=groq` ينهي الطلب في Groq. `gemini` أو غياب provider ينتقل إلى handler السابق. provider غير معروف يُرفض. لا fallback تلقائي بين المزودين. |
| `server.ts` | import واحد ووسيط أمام handler القائم؛ بالإضافة إلى حذف استدعاء `fileURLToPath(import.meta.url)` ومتغيرين غير مستخدمين كانا يكسران تشغيل build بصيغة CommonJS. |
| `src/transcriptionConfig.ts` | اسم الموديل الثابت، حد 25,000,000 بايت، قائمة الامتدادات ونوع provider مشترك. |
| `src/services/gemini.ts`، `transcribeAudio` | إضافة provider كمعامل أخير اختياري افتراضيه Gemini؛ تمرير `retryAfter`، وأنواع النتائج من `types.ts`. احتُفظ بالاسم لتجنب إعادة تسمية imports بلا حاجة. |
| `src/components/TranscriptionView.tsx` | اختيار Groq، مفتاح مؤقت في React state فقط، فحص الملف قبل FileReader، توجيه المفتاح للمزود الصحيح، أخطاء Groq لا تفتح modal Gemini، وتوقيتات وعرض واضح لغياب diarization. معالجة النتيجة الفارغة وإتاحة إعادة المحاولة. |
| `src/types.ts` | إضافة اختيارية `speakerDiarization?: boolean`؛ السجل القديم متوافق دون هجرة. |
| `src/App.tsx`, `SettingsView.tsx` | تصحيح نصوص حالة المفتاح لتناسب وجود Groq. |
| `.env.example`, `.gitignore` | شرح BYOK الفعلي، وعدم وضع أسرار في `VITE_*`، واستبعاد SQLite من Git. |
| `package.json`, `package-lock.json` | test script باستخدام الأدوات الموجودة؛ إصلاح عدم تزامن lockfile السابق. لم تُضف مكتبة تشغيل لإضافة Groq. بقي `bun.lock` القديم دون تحديث؛ استخدم npm لهذه النسخة. |
| `tests/groq.test.ts`, `tests/routing.test.ts` | اختبارات adapter وتوجيه HTTP، تشمل النص المختلط والمفاتيح والحجم والأخطاء وعدم التحويل إلى Gemini. |

البديل التالي لو زاد حجم الاستخدام: الانتقال إلى multipart من المتصفح أيضًا، مع parser محدود وتخزين مؤقت/job queue. لم أنفّذه لأنه يوسّع التغيير ويحتاج سياسة معالجة ملفات طويلة وتنظيفها.

## حدود الملفات والـstreaming

بحسب [توثيق Groq للصوت](https://console.groq.com/docs/speech-to-text): Turbo متعدد اللغات بسعر $0.04/ساعة؛ الرفع المباشر حتى 25MB، وملفات حتى 100MB في Dev عبر URL. الصيغ المعلنة تشمل WAV/FLAC/MP3/M4A/MP4/OGG/WebM/MPEG/MPGA؛ raw AAC ليست ضمنها. توجد timestamps للكلمات أو المقاطع، والحد الأدنى للفوترة 10 ثوانٍ. يدعم prompt للسياق حتى 224 token، وليس تعليمات chat.

التنفيذ يستخدم رفعًا مباشرًا وحدًا محافظًا 25MB حتى على الحساب المدفوع؛ لا URL fetching ولا تحويل صيغة تلقائي ولا chunking. MIME/extension checks ليست decoder أو ضمانًا لصحة محتوى الملف؛ Groq يتحقق من إمكانية قراءته. يُرفض raw AAC لتجنب تمريره باعتباره MP3؛ مسار Gemini القديم نفسه يحتوي فحص MP3 sync قبل AAC وقد يخطئ في تصنيف AAC.

Base64 يضيف نحو 33% إلى الحجم: ملف 25MB يصبح نحو 33.33MB قبل JSON. حد Express الحالي `50mb` يسمح بذلك عادة، لكن ذاكرة الطلب أعلى بسبب نسخ string/buffer/blob، وقد يمنع reverse proxy طلبًا أصغر. يجب اختبار حد الاستضافة والمهلة قبل النشر. حد Gemini ليس حد Express: [توثيق Google](https://ai.google.dev/gemini-api/docs/audio) يحدد 20MB لإجمالي طلب inline، ويوصي Files API للأكبر؛ المسار الحالي لا يطبّق ذلك ولا يستخدم Files API.

[حدود Groq المجانية المنشورة](https://console.groq.com/docs/rate-limits): 20 طلبًا/دقيقة، 2000/يوم، 7200 ثانية صوت/ساعة، و28800/يوم. الحدود على مستوى المنظمة، والقيم الفعلية تُراجع في لوحة الحساب. وجود 8 ساعات يوميًا لا يلغي حد ساعتين صوت في الساعة. لا retries تلقائية هنا لتجنب تكرار الرفع والتكلفة؛ تُعرض رسالة 429 ووقت الانتظار إن وُجد.

التكامل الحالي file-in/result-out؛ لا يفترض أن streaming الخاص بـchat يطبّق على Whisper. لإضافة تجربة شبه حية لاحقًا: اجمع نوافذ صوت قابلة للفك، ثم transcribe لكل نافذة، مع timestamps عالمية وإزالة التكرار. تقسيم bytes أو Base64 عشوائيًا لا ينتج ملفات صوت مستقلة صالحة. للملفات الطويلة: فك الصوت، downmix مناسب، ضغط، تقسيم عند صمت مع overlap قصير، ثم دمج وإزالة تكرار الحدود. كل ذلك مرحلة لاحقة.

## العربي والإنجليزي في نفس الجملة

هذه توصية تصميم واختبار، وليست ضمان جودة للموديل:

- استخدام `/audio/transcriptions`، وعدم استخدام endpoint الترجمة.
- ترك `language` فارغًا في النسخة الأولى؛ لا يوجد خيار لغتين في المعامل الحالي. جرّب auto مقابل `ar` على عيناتك قبل فرض لغة.
- إبقاء النص كما أعاده المزود دون ترجمة أو كتابة الكلمات الإنجليزية بحروف عربية أو “تحسين” النتيجة بـLLM.
- عدم إضافة prompt عام مليء بمصطلحات HR لكل الملفات. لو احتجت glossary للأسماء، جرّب سياقًا قصيرًا مرتبطًا بالتسجيل وراجع هل يسبب كلمات غير منطوقة.
- `language` الذي يعيده المزود قد يذكر لغة واحدة فقط؛ التطبيق يضع `Arabic / English` عندما يحتوي النص على حروف من المجموعتين. هذا وصف للكتابة وليس كشفًا دقيقًا للهجة أو جودة التفريغ.
- المقاطع ليست متحدثين، ولا يصح اختراع `Speaker 1/2` من تبدّل اللغة أو مواضع الوقفات.
- قبل الاعتماد: 10–20 مقطعًا مرجعيًا تشمل مصري/إنجليزي داخل الجملة، أسماء وأرقام ونفي، كلام متداخل وصمت وضوضاء؛ قارن حذف الكلمات وترجمتها بالخطأ والأسماء والتوقيت والكمون والتكلفة. قِس WER/CER مع سياسة واضحة لتطبيع العربي، وافحص المصطلحات الإنجليزية يدويًا.

## إدارة المفاتيح والأمان: الموجود وما لم يصلحه هذا التعديل

المشكلة الأكبر ليست تكلفة Google: لا توجد session/cookie/token موثّقة تربط الطلب بالمستخدم. `userId` من العميل يُستخدم مباشرة في قراءة المفتاح والتفريغ والسجل، وتعديل/حذف المفتاح. يمكن بذلك استهلاك مفتاح مستخدم آخر أو الوصول إلى سجله دون إثبات هوية. masking يحجب العرض فقط ولا يحمي عمليات الخادم.

`gemini_api_key` مخزّن plaintext في SQLite. localStorage يحتوي هوية وحالة مفتاح، وليس اعتماد دخول صالحًا. مسار تغيير كلمة المرور يقبل `userId + newPassword` دون التحقق من reset token أو جلسة؛ reset-password يرجع token في الرد، وMFA verification لا يرتبط بتحدٍّ مثبت بعد كلمة المرور. هذه نتائج مراجعة كود، وليست اختبار اختراق على النسخة المنشورة.

إضافة Groq لا توسع هذا التخزين: المفتاح في ذاكرة صفحة التفريغ، يُرسل عبر خادم التطبيق ثم إلى Groq، لا يستخدم مفتاح Gemini المخزّن، ولا يقرأ مفتاحًا عامًا من environment، ولا يُحفظ في DB أو localStorage. لكنه يظل ظاهرًا لصاحب المتصفح ولخادم التطبيق أثناء الطلب؛ لذلك يلزم HTTPS وعدم تسجيل request bodies لدى الاستضافة. الخروج من الواجهة أو إعادة تحميلها يمسح الـstate، وليس ضمانًا لمحو الذاكرة المادي.

قبل استضافة متعددة المستخدمين: إضافة جلسات موثقة وملكية للموارد في جميع endpoints، ربط MFA بتحدٍّ قصير العمر، reset token آمن يُسلّم خارج الاستجابة ويُستهلك مرة واحدة، حماية/rate limits للدخول والرفع، ثم تشفير مفاتيح BYOK المخزنة بمفتاح خارج SQLite مع rotation. لا تضف مفتاح Groq مشتركًا عامًا إلى المسار الحالي قبل ذلك. أُبقيت هذه المعالجة كمرحلة منفصلة حتى لا يتحول تبديل transcription إلى إعادة بناء نظام الحسابات.

## التشغيل والتحقق

من مجلد النسخة المعدلة، باستخدام Node.js 24 الذي اختُبرت عليه:

```bash
npm ci
npm test
npm run lint
npm run build
NODE_ENV=production npm start
```

للتطوير: `npm run dev`. افتح `http://localhost:3000` في بيئة محلية موثوقة، سجّل حسابًا محليًا، ارفع ملفًا، واختر Groq من القائمة. أدخل مفتاحك في حقل Groq المؤقت داخل التطبيق، لا في المحادثة. للعودة إلى Gemini اختر موديله واستخدم إعدادات مفتاح Gemini الحالية.

التحقق المنفّذ: 6 اختبارات ناجحة، TypeScript ناجح، build ناجح، تشغيل production فعلي وفحص HTTP للـhealth والواجهة ومسار Groq بدون مفتاح وprovider غير معروف وحراسة مفتاح Gemini القديمة. تحذير حجم JavaScript bundle الكبير موجود؛ ليس فشل بناء. لم تُجرَ تجربة متصفح كاملة أو مكالمات حقيقية إلى Gemini/Groq أو قياسات دقة صوتية. لم يُختبر تصدير PDF/DOCX بصريًا؛ المكتبات ومسارهما لم يتغيرا، وتوافق شكل البيانات فُحص برمجيًا.

تتضمن المخرجات patch قابلًا للتطبيق على commit المذكور، وZIP للمصدر دون node_modules أو database أو مفاتيح. النسخة العاملة الكاملة موجودة محليًا؛ ليست إصدارًا جاهزًا للنشر العام قبل معالجة ثغرات الحسابات أعلاه.

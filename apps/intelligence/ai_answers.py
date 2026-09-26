"""
Deterministic answer layer for the AI / RAG chatbot.

This module does NOT replace the existing RAG backend:

  * knowledge questions still go through the existing ChromaDB retriever in
    ``apps.ai_engine.rag.retriever`` (``retrieve_relevant_context``),
  * activity questions are answered from the existing database aggregations,
  * when there is not enough real data, an honest "not enough data" message is
    returned instead of an invented statistic.

Only the *wording* of the deterministic activity answers is localized, so the
selected UI language is honoured without touching the RAG engine.
"""

SUPPORTED_LANGS = ('en', 'te', 'hi', 'ta', 'kn', 'ml')

# ── Localized duration unit words ───────────────────────────────────────────
UNITS = {
    'en': {'hour': 'hour', 'hours': 'hours', 'minute': 'minute', 'minutes': 'minutes',
           'second': 'second', 'seconds': 'seconds', 'and': 'and', 'none': 'no tracked time'},
    'te': {'hour': 'గంట', 'hours': 'గంటలు', 'minute': 'నిమిషం', 'minutes': 'నిమిషాలు',
           'second': 'సెకను', 'seconds': 'సెకన్లు', 'and': 'మరియు', 'none': 'సమయం నమోదు కాలేదు'},
    'hi': {'hour': 'घंटा', 'hours': 'घंटे', 'minute': 'मिनट', 'minutes': 'मिनट',
           'second': 'सेकंड', 'seconds': 'सेकंड', 'and': 'और', 'none': 'कोई समय दर्ज नहीं'},
    'ta': {'hour': 'மணி நேரம்', 'hours': 'மணி நேரம்', 'minute': 'நிமிடம்', 'minutes': 'நிமிடங்கள்',
           'second': 'வினாடி', 'seconds': 'விநாடிகள்', 'and': 'மற்றும்', 'none': 'நேரம் பதிவாகவில்லை'},
    'kn': {'hour': 'ಗಂಟೆ', 'hours': 'ಗಂಟೆಗಳು', 'minute': 'ನಿಮಿಷ', 'minutes': 'ನಿಮಿಷಗಳು',
           'second': 'ಸೆಕೆಂಡ್', 'seconds': 'ಸೆಕೆಂಡುಗಳು', 'and': 'ಮತ್ತು', 'none': 'ಸಮಯ ದಾಖಲಾಗಿಲ್ಲ'},
    'ml': {'hour': 'മണിക്കൂർ', 'hours': 'മണിക്കൂർ', 'minute': 'മിനിറ്റ്', 'minutes': 'മിനിറ്റ്',
           'second': 'സെക്കൻഡ്', 'seconds': 'സെക്കൻഡുകൾ', 'and': 'കൂടാതെ', 'none': 'സമയം രേഖപ്പെടുത്തിയിട്ടില്ല'},
}


def normalize_lang(lang):
    code = str(lang or 'en').strip().lower()[:2]
    return code if code in SUPPORTED_LANGS else 'en'


def human_duration(seconds, lang='en'):
    """Localized duration text built from real numeric values."""
    words = UNITS[normalize_lang(lang)]
    total = max(0, int(round(seconds or 0)))
    if total == 0:
        return words['none']
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    parts = []
    if hours:
        parts.append(f"{hours} {words['hour'] if hours == 1 else words['hours']}")
    if minutes:
        parts.append(f"{minutes} {words['minute'] if minutes == 1 else words['minutes']}")
    if secs and not hours:
        parts.append(f"{secs} {words['second'] if secs == 1 else words['seconds']}")
    return f" {words['and']} ".join(parts)





# ── Localized answer templates ──────────────────────────────────────────────
# Placeholders are filled with REAL values from the database.
TEMPLATES = {
    'en': {
        'greeting': 'Hi! I can summarize your focus activity or explain concepts from your reference notes. Try "How much coding time did I have?" or "What is Python inheritance?".',
        'most_activity': 'Today your longest activity was **{name}** for **{duration}**.',
        'coding_time': 'You recorded **{duration}** of coding / development time today.',
        'distracting_site': 'Your most distracting website today was **{name}** for **{duration}**.',
        'distracting_app': 'Your most distracting app today was **{name}** for **{duration}**.',
        'distraction_time': 'You recorded **{duration}** of distraction time today.',
        'switches': 'You had **{count} context switches** today.',
        'focus_score': 'Your current focus score is **{score} out of 100** ({label}).',
        'streak': 'Your current streak is **{count} days**, with **{total} active days** tracked in total.',
        'idle_time': 'You had **{duration}** of neutral or idle tracked time today.',
        'productive_time': 'You recorded **{duration}** of productive time today.',
        'summary': 'Today: **{productive}** productive, **{distracting}** distracted, **{count}** switches.',
        'idle_none': 'You had **no** idle or neutral tracked time today.',
        'productive_none': 'You had **no** productive time recorded today.',
        'distraction_none': 'You had **no** distraction time recorded today.',
        'none_word': 'none',
        'insufficient': "I don't have enough activity data to answer that yet.",
        'knowledge_empty': "I don't have matching reference material for that question yet.",
        'knowledge_source': 'Reference material used',
        'label_high': 'High focus',
        'label_moderate': 'Moderate',
        'label_low': 'Needs focus',
        'traceable': 'This answer uses only your collected tracker data.',
    },
    'te': {
        'greeting': 'నమస్తే! మీ ఫోకస్ కార్యకలాపాలను సంగ్రహించగలను లేదా మీ సూచన నోట్స్ నుండి భావనలను వివరించగలను. "ఈరోజు నా కోడింగ్ సమయం ఎంత?" లేదా "Python వారసత్వం అంటే ఏమిటి?" అని అడగండి.',
        'streak': 'మీ ప్రస్తుత స్ట్రీక్ **{count} రోజులు**, మొత్తం **{total} క్రియాశీల రోజులు** నమోదయ్యాయి.',
        'most_activity': 'ఈరోజు మీరు అత్యధిక సమయం **{name}** కోసం **{duration}** వెచ్చించారు.',
        'coding_time': 'ఈరోజు మీరు కోడింగ్ / అభివృద్ధి కోసం **{duration}** నమోదు చేసారు.',
        'distracting_site': 'ఈరోజు మిమ్మల్ని అత్యధికంగా ఆపే వెబ్‌సైట్ **{name}**, సమయం **{duration}**.',
        'distracting_app': 'ఈరోజు మిమ్మల్ని అత్యధికంగా ఆపే యాప్ **{name}**, సమయం **{duration}**.',
        'distraction_time': 'ఈరోజు **{duration}** అడ్డంకి సమయం నమోదైంది.',
        'switches': 'ఈరోజు మీకు **{count} సందర్భ మార్పులు** ఉన్నాయి.',
        'focus_score': 'మీ ప్రస్తుత ఫోకస్ స్కోరు **100లో {score}** ({label}).',
        'idle_time': 'ఈరోజు **{duration}** నిష్క్రియ లేదా తటస్థ సమయం నమోదైంది.',
        'productive_time': 'ఈరోజు మీరు **{duration}** ఉత్పాదక సమయం నమోదు చేసారు.',
        'summary': 'ఈరోజు: **{productive}** ఉత్పాదకం, **{distracting}** అడ్డంకి, **{count}** మార్పులు.',
        'idle_none': 'ఈరోజు **నిష్క్రియ సమయం ఏదీ** నమోదుకాలేదు.',
        'productive_none': 'ఈరోజు **ఉత్పాదక సమయం ఏదీ** నమోదుకాలేదు.',
        'distraction_none': 'ఈరోజు **అడ్డంకి సమయం ఏదీ** నమోదుకాలేదు.',
        'none_word': 'ఏదీ లేదు',
        'insufficient': 'దీనికి సమాధానం ఇవ్వడానికి ఇంకా సరిపడా కార్యకలాప డేటా లేదు.',
        'knowledge_empty': 'ఆ ప్రశ్నకు సరిపోయే సూచన పదార్థం ఇంకా లేదు.',
        'knowledge_source': 'ఉపయోగించిన సూచన పదార్థం',
        'label_high': 'అధిక ఏకాగ్రత',
        'label_moderate': 'మధ్యస్థం',
        'label_low': 'ఏకాగ్రత అవసరం',
        'traceable': 'ఈ సమాధానం మీ ట్రాకర్ డేటా ఆధారంగా మాత్రమే.',
    },
    'hi': {
        'greeting': 'नमस्ते! मैं आपकी फोकस गतिविधि का सारांश दे सकता हूँ या आपके संदर्भ नोट्स से अवधारणाएँ समझा सकता हूँ। पूछें "आज मेरा कोडिंग समय कितना था?" या "Python इनहेरिटेंस क्या है?"।',
        'streak': 'आपकी वर्तमान स्ट्रीक **{count} दिन** है, कुल **{total} सक्रिय दिन** दर्ज हुए हैं।',
        'most_activity': 'आज आपकी सबसे लंबी गतिविधि **{name}** रही, अवधि **{duration}**।',
        'coding_time': 'आज आपने कोडिंग / विकास कार्य के लिए **{duration}** दर्ज किया।',
        'distracting_site': 'आज आपको सबसे अधिक विचलित करने वाली वेबसाइट **{name}** थी, अवधि **{duration}**।',
        'distracting_app': 'आज आपको सबसे अधिक विचलित करने वाला ऐप **{name}** था, अवधि **{duration}**।',
        'distraction_time': 'आज **{duration}** विचलन समय दर्ज हुआ।',
        'switches': 'आज आपके **{count} कॉन्टेक्स्ट स्विच** हुए।',
        'focus_score': 'आपका वर्तमान फोकस स्कोर **100 में से {score}** है ({label})।',
        'idle_time': 'आज **{duration}** निष्क्रिय या तटस्थ समय दर्ज हुआ।',
        'productive_time': 'आज आपने **{duration}** उत्पादक समय दर्ज किया।',
        'summary': 'आज: **{productive}** उत्पादक, **{distracting}** विचलन, **{count}** स्विच।',
        'idle_none': 'आज **कोई निष्क्रिय समय** दर्ज नहीं हुआ।',
        'productive_none': 'आज **कोई उत्पादक समय** दर्ज नहीं हुआ।',
        'distraction_none': 'आज **कोई विचलन समय** दर्ज नहीं हुआ।',
        'none_word': 'कुछ नहीं',
        'insufficient': 'इसका उत्तर देने के लिए अभी पर्याप्त गतिविधि डेटा नहीं है।',
        'knowledge_empty': 'इस प्रश्न के लिए अभी कोई मेल खाती संदर्भ सामग्री नहीं है।',
        'knowledge_source': 'प्रयुक्त संदर्भ सामग्री',
        'label_high': 'उच्च फोकस',
        'label_moderate': 'मध्यम',
        'label_low': 'फोकस आवश्यक',
        'traceable': 'यह उत्तर केवल आपके ट्रैक किए गए डेटा पर आधारित है।',
    },
    'ta': {
        'greeting': 'வணக்கம்! உங்கள் கவனச் செயல்பாட்டை சுருக்கமாகச் சொல்லலாம் அல்லது உங்கள் குறிப்புகளிலிருந்து கருத்துகளை விளக்கலாம். "இன்று என் கோடிங் நேரம் எவ்வளவு?" அல்லது "Python பரம்பரை என்பது என்ன?" எனக் கேளுங்கள்.',
        'streak': 'உங்கள் தற்போதைய தொடர் **{count} நாட்கள்**, மொத்தம் **{total} செயலில் உள்ள நாட்கள்** பதிவாகியுள்ளன.',
        'most_activity': 'இன்று நீங்கள் அதிக நேரம் செலவழித்த செயல்பாடு **{name}**, நேரம் **{duration}**.',
        'coding_time': 'இன்று நீங்கள் கோடிங் / மேம்பாட்டுக்காக **{duration}** பதிவு செய்துள்ளீர்கள்.',
        'distracting_site': 'இன்று உங்களை அதிகம் கவனம் சிதறச் செய்த தளம் **{name}**, நேரம் **{duration}**.',
        'distracting_app': 'இன்று உங்களை அதிகம் கவனம் சிதறச் செய்த செயலி **{name}**, நேரம் **{duration}**.',
        'distraction_time': 'இன்று **{duration}** கவனச்சிதறல் நேரம் பதிவாகியுள்ளது.',
        'switches': 'இன்று உங்களுக்கு **{count} சூழல் மாற்றங்கள்** இருந்தன.',
        'focus_score': 'உங்கள் தற்போதைய கவன மதிப்பெண் **100 இல் {score}** ({label}).',
        'idle_time': 'இன்று **{duration}** செயலற்ற அல்லது நடுநிலை நேரம் பதிவாகியுள்ளது.',
        'productive_time': 'இன்று நீங்கள் **{duration}** உற்பத்தித் திறன் நேரம் பதிவு செய்துள்ளீர்கள்.',
        'summary': 'இன்று: **{productive}** உற்பத்தி, **{distracting}** சிதறல், **{count}** மாற்றங்கள்.',
        'idle_none': 'இன்று **செயலற்ற நேரம் எதுவும்** பதிவாகவில்லை.',
        'productive_none': 'இன்று **உற்பத்தி நேரம் எதுவும்** பதிவாகவில்லை.',
        'distraction_none': 'இன்று **கவனச்சிதறல் நேரம் எதுவும்** பதிவாகவில்லை.',
        'none_word': 'எதுவுமில்லை',
        'insufficient': 'இதற்கு பதிலளிக்க இன்னும் போதுமான செயல்பாட்டுத் தரவு இல்லை.',
        'knowledge_empty': 'இந்தக் கேள்விக்கு பொருந்தும் குறிப்புப் பொருள் இன்னும் இல்லை.',
        'knowledge_source': 'பயன்படுத்தப்பட்ட குறிப்புப் பொருள்',
        'label_high': 'அதிக கவனம்',
        'label_moderate': 'மிதமானது',
        'label_low': 'கவனம் தேவை',
        'traceable': 'இந்தப் பதில் உங்கள் கண்காணிப்புத் தரவை மட்டுமே அடிப்படையாகக் கொண்டது.',
    },
    'kn': {
        'greeting': 'ನಮಸ್ಕಾರ! ನಿಮ್ಮ ಏಕಾಗ್ರತೆಯ ಚಟುವಟಿಕೆಯನ್ನು ಸಂಕ್ಷೇಪಿಸಬಲ್ಲೆ ಅಥವಾ ನಿಮ್ಮ ಉಲ್ಲೇಖ ಟಿಪ್ಪಣಿಗಳಿಂದ ಪರಿಕಲ್ಪನೆಗಳನ್ನು ವಿವರಿಸಬಲ್ಲೆ. "ಇಂದು ನನ್ನ ಕೋಡಿಂಗ್ ಸಮಯ ಎಷ್ಟು?" ಅಥವಾ "Python ಪರಂಪರೆ ಎಂದರೇನು?" ಎಂದು ಕೇಳಿ.',
        'streak': 'ನಿಮ್ಮ ಪ್ರಸ್ತುತ ಸರಣಿ **{count} ದಿನಗಳು**, ಒಟ್ಟು **{total} ಸಕ್ರಿಯ ದಿನಗಳು** ದಾಖಲಾಗಿವೆ.',
        'most_activity': 'ಇಂದು ನೀವು ಹೆಚ್ಚು ಸಮಯ ಕಳೆದ ಚಟುವಟಿಕೆ **{name}**, ಅವಧಿ **{duration}**.',
        'coding_time': 'ಇಂದು ನೀವು ಕೋಡಿಂಗ್ / ಅಭಿವೃದ್ಧಿಗೆ **{duration}** ದಾಖಲಿಸಿದ್ದೀರಿ.',
        'distracting_site': 'ಇಂದು ನಿಮ್ಮನ್ನು ಹೆಚ್ಚು ಗಮನ ಸೆಳೆದ ತಾಣ **{name}**, ಅವಧಿ **{duration}**.',
        'distracting_app': 'ಇಂದು ನಿಮ್ಮನ್ನು ಹೆಚ್ಚು ಗಮನ ಸೆಳೆದ ಅಪ್ಲಿಕೇಶನ್ **{name}**, ಅವಧಿ **{duration}**.',
        'distraction_time': 'ಇಂದು **{duration}** ಗಮನ ಭಂಗ ಸಮಯ ದಾಖಲಾಗಿದೆ.',
        'switches': 'ಇಂದು ನಿಮಗೆ **{count} ಸಂದರ್ಭ ಬದಲಾವಣೆಗಳು** ಇದ್ದವು.',
        'focus_score': 'ನಿಮ್ಮ ಪ್ರಸ್ತುತ ಏಕಾಗ್ರತೆ ಅಂಕ **100 ರಲ್ಲಿ {score}** ({label}).',
        'idle_time': 'ಇಂದು **{duration}** ನಿಷ್ಕ್ರಿಯ ಅಥವಾ ತಟಸ್ಥ ಸಮಯ ದಾಖಲಾಗಿದೆ.',
        'productive_time': 'ಇಂದು ನೀವು **{duration}** ಉತ್ಪಾದಕ ಸಮಯ ದಾಖಲಿಸಿದ್ದೀರಿ.',
        'summary': 'ಇಂದು: **{productive}** ಉತ್ಪಾದಕ, **{distracting}** ಗಮನ ಭಂಗ, **{count}** ಬದಲಾವಣೆಗಳು.',
        'idle_none': 'ಇಂದು **ನಿಷ್ಕ್ರಿಯ ಸಮಯ ಯಾವುದೂ** ದಾಖಲಾಗಿಲ್ಲ.',
        'productive_none': 'ಇಂದು **ಉತ್ಪಾದಕ ಸಮಯ ಯಾವುದೂ** ದಾಖಲಾಗಿಲ್ಲ.',
        'distraction_none': 'ಇಂದು **ಗಮನ ಭಂಗ ಸಮಯ ಯಾವುದೂ** ದಾಖಲಾಗಿಲ್ಲ.',
        'none_word': 'ಏನೂ ಇಲ್ಲ',
        'insufficient': 'ಇದಕ್ಕೆ ಉತ್ತರಿಸಲು ಇನ್ನೂ ಸಾಕಷ್ಟು ಚಟುವಟಿಕೆ ಡೇಟಾ ಇಲ್ಲ.',
        'knowledge_empty': 'ಈ ಪ್ರಶ್ನೆಗೆ ಹೊಂದುವ ಉಲ್ಲೇಖ ಸಾಮಗ್ರಿ ಇನ್ನೂ ಇಲ್ಲ.',
        'knowledge_source': 'ಬಳಸಿದ ಉಲ್ಲೇಖ ಸಾಮಗ್ರಿ',
        'label_high': 'ಹೆಚ್ಚು ಏಕಾಗ್ರತೆ',
        'label_moderate': 'ಮಧ್ಯಮ',
        'label_low': 'ಏಕಾಗ್ರತೆ ಬೇಕು',
        'traceable': 'ಈ ಉತ್ತರ ನಿಮ್ಮ ಟ್ರ್ಯಾಕರ್ ಡೇಟಾವನ್ನು ಮಾತ್ರ ಆಧರಿಸಿದೆ.',
    },
    'ml': {
        'greeting': 'നമസ്കാരം! നിങ്ങളുടെ ശ്രദ്ധ പ്രവർത്തനങ്ങൾ സംഗ്രഹിക്കാം അല്ലെങ്കിൽ നിങ്ങളുടെ റഫറൻസ് കുറിപ്പുകളിൽ നിന്ന് ആശയങ്ങൾ വിശദീകരിക്കാം. "ഇന്ന് എന്റെ കോഡിംഗ് സമയം എത്ര?" അല്ലെങ്കിൽ "Python പാരമ്പര്യം എന്താണ്?" എന്ന് ചോദിക്കുക.',
        'streak': 'നിങ്ങളുടെ നിലവിലെ സ്ട്രീക്ക് **{count} ദിവസം**, ആകെ **{total} സജീവ ദിവസങ്ങൾ** രേഖപ്പെടുത്തിയിട്ടുണ്ട്.',
        'most_activity': 'ഇന്ന് നിങ്ങൾ ഏറ്റവും കൂടുതൽ സമയം ചെലവഴിച്ച പ്രവർത്തനം **{name}**, ദൈർഘ്യം **{duration}**.',
        'coding_time': 'ഇന്ന് നിങ്ങൾ കോഡിംഗ് / വികസനത്തിനായി **{duration}** രേഖപ്പെടുത്തി.',
        'distracting_site': 'ഇന്ന് നിങ്ങളെ ഏറ്റവും ശ്രദ്ധ തിരിച്ച വെബ്സൈറ്റ് **{name}**, ദൈർഘ്യം **{duration}**.',
        'distracting_app': 'ഇന്ന് നിങ്ങളെ ഏറ്റവും ശ്രദ്ധ തിരിച്ച ആപ്പ് **{name}**, ദൈർഘ്യം **{duration}**.',
        'distraction_time': 'ഇന്ന് **{duration}** ശ്രദ്ധഭംഗ സമയം രേഖപ്പെടുത്തി.',
        'switches': 'ഇന്ന് നിങ്ങൾക്ക് **{count} സന്ദർഭ മാറ്റങ്ങൾ** ഉണ്ടായിരുന്നു.',
        'focus_score': 'നിങ്ങളുടെ നിലവിലെ ശ്രദ്ധ സ്കോർ **100ൽ {score}** ({label}).',
        'idle_time': 'ഇന്ന് **{duration}** നിഷ്ക്രിയ അല്ലെങ്കിൽ നിഷ്പക്ഷ സമയം രേഖപ്പെടുത്തി.',
        'productive_time': 'ഇന്ന് നിങ്ങൾ **{duration}** ഉൽപ്പാദനക്ഷമമായ സമയം രേഖപ്പെടുത്തി.',
        'summary': 'ഇന്ന്: **{productive}** ഉൽപ്പാദനം, **{distracting}** ശ്രദ്ധഭംഗം, **{count}** മാറ്റങ്ങൾ.',
        'idle_none': 'ഇന്ന് **നിഷ്ക്രിയ സമയം ഒന്നും** രേഖപ്പെടുത്തിയിട്ടില്ല.',
        'productive_none': 'ഇന്ന് **ഉൽപ്പാദന സമയം ഒന്നും** രേഖപ്പെടുത്തിയിട്ടില്ല.',
        'distraction_none': 'ഇന്ന് **ശ്രദ്ധഭംഗ സമയം ഒന്നും** രേഖപ്പെടുത്തിയിട്ടില്ല.',
        'none_word': 'ഒന്നുമില്ല',
        'insufficient': 'ഇതിന് ഉത്തരം നൽകാൻ ഇപ്പോൾ മതിയായ പ്രവർത്തന ഡാറ്റയില്ല.',
        'knowledge_empty': 'ഈ ചോദ്യത്തിന് യോജിക്കുന്ന റഫറൻസ് ഉള്ളടക്കം ഇപ്പോൾ ഇല്ല.',
        'knowledge_source': 'ഉപയോഗിച്ച റഫറൻസ് ഉള്ളടക്കം',
        'label_high': 'ഉയർന്ന ശ്രദ്ധ',
        'label_moderate': 'മിതം',
        'label_low': 'ശ്രദ്ധ ആവശ്യം',
        'traceable': 'ഈ ഉത്തരം നിങ്ങളുടെ ട്രാക്കർ ഡാറ്റയെ മാത്രം അടിസ്ഥാനമാക്കിയതാണ്.',
    },
}


def text(lang, key, **params):
    """Localized template text with real values substituted."""
    table = TEMPLATES[normalize_lang(lang)]
    template = table.get(key) or TEMPLATES['en'].get(key, key)
    try:
        return template.format(**params)
    except (KeyError, IndexError):
        return template

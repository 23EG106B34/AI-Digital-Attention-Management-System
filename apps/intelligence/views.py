import re
from datetime import timedelta
from django.db.models import Sum
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from apps.browsing.models import BrowsingLog, SwitchEvent
from apps.system_monitor.models import SystemAppLog, SystemSwitchEvent
from apps.users.models import Goal
from apps.focus_sessions.models import FocusSession
from .ai_answers import normalize_lang, text, human_duration



def duration(seconds):
    seconds = max(0, int(seconds or 0))
    hours, seconds = divmod(seconds, 3600)
    minutes, seconds = divmod(seconds, 60)
    parts = []
    if hours: parts.append(f'{hours} hour' + ('' if hours == 1 else 's'))
    if minutes: parts.append(f'{minutes} minute' + ('' if minutes == 1 else 's'))
    if seconds or not parts: parts.append(f'{seconds} second' + ('' if seconds == 1 else 's'))
    return ' '.join(parts)


def metrics(user, day):
    b = BrowsingLog.objects.filter(user=user, visited_at__date=day)
    s = SystemAppLog.objects.filter(user=user, started_at__date=day)
    total = (b.aggregate(x=Sum('time_spent_secs'))['x'] or 0) + (s.aggregate(x=Sum('duration_secs'))['x'] or 0)
    productive = (b.filter(productivity_label='PRODUCTIVE').aggregate(x=Sum('time_spent_secs'))['x'] or 0) + (s.filter(productivity_label='PRODUCTIVE').aggregate(x=Sum('duration_secs'))['x'] or 0)
    distracting = (b.filter(productivity_label='DISTRACTING').aggregate(x=Sum('time_spent_secs'))['x'] or 0) + (s.filter(productivity_label='DISTRACTING').aggregate(x=Sum('duration_secs'))['x'] or 0)
    idle = max(0, total - productive - distracting)
    switches = SwitchEvent.objects.filter(user=user, switched_at__date=day).count() + SystemSwitchEvent.objects.filter(user=user, switched_at__date=day).count()
    return {'total_secs': total, 'productive_secs': productive, 'distracting_secs': distracting, 'idle_secs': idle, 'switches': switches}


class FocusScoreView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]
    def get(self, request):
        m = metrics(request.user, timezone.localdate())
        if not m['total_secs']:
            return Response({'score': None, 'status': 'insufficient_data', 'detail': 'No collected activity exists for today.', 'factors': m})
        productive_ratio = m['productive_secs'] / m['total_secs'] * 100
        distraction_penalty = m['distracting_secs'] / m['total_secs'] * 35
        idle_penalty = m['idle_secs'] / m['total_secs'] * 15
        switch_penalty = min(20, m['switches'] * 1.5)
        score = round(max(0, min(100, productive_ratio - distraction_penalty - idle_penalty - switch_penalty)), 1)
        return Response({'score': score, 'label': 'Focus intelligence estimate', 'not_medical_advice': True, 'factors': {**m, 'productive_ratio': round(productive_ratio, 1), 'distraction_penalty': round(distraction_penalty, 1), 'idle_penalty': round(idle_penalty, 1), 'switch_penalty': round(switch_penalty, 1)}})


class StreakView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]
    def get(self, request):
        goal = Goal.objects.filter(user=request.user, status='ACTIVE').order_by('-updated_at').first()
        target = int((goal.target_focus_hours if goal else request.user.profile.daily_focus_goal_hours) * 3600)
        today = timezone.localdate(); history = []; current = longest = run = 0
        for offset in range(30):
            day = today - timedelta(days=offset); m = metrics(request.user, day); achieved = m['productive_secs'] >= target
            history.append({'date': str(day), 'productive_secs': m['productive_secs'], 'goal_secs': target, 'achieved': achieved})
            if achieved:
                run += 1; longest = max(longest, run)
                if offset == current: current += 1
            else: run = 0
        return Response({'daily_goal_secs': target, 'current_streak': current, 'longest_streak_last_30_days': longest, 'productive_days': sum(x['achieved'] for x in history), 'history': history})


class AnalyticsView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]
    def get(self, request):
        today = timezone.localdate(); days = [today - timedelta(days=i) for i in range(6, -1, -1)]
        weekly = [{'date': str(d), **metrics(request.user, d)} for d in days]
        m = metrics(request.user, today)
        apps = list(SystemAppLog.objects.filter(user=request.user, started_at__date=today).values('app_name', 'category', 'productivity_label').annotate(duration_secs=Sum('duration_secs')).order_by('-duration_secs')[:10])
        sites = list(BrowsingLog.objects.filter(user=request.user, visited_at__date=today).values('domain', 'category', 'productivity_label').annotate(duration_secs=Sum('time_spent_secs')).order_by('-duration_secs')[:10])
        return Response({'today': m, 'weekly': weekly, 'most_used_apps': apps, 'most_used_sites': sites})


class ActivityView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]
    def get(self, request):
        day = timezone.localdate(); m = metrics(request.user, day)
        events = []
        for x in SystemAppLog.objects.filter(user=request.user, started_at__date=day).order_by('-started_at')[:50]: events.append({'source':'desktop','name':x.app_name,'title':x.window_title,'category':x.category,'duration_secs':x.duration_secs,'timestamp':x.started_at})
        for x in BrowsingLog.objects.filter(user=request.user, visited_at__date=day).order_by('-visited_at')[:50]: events.append({'source':'browser','name':x.domain,'title':x.page_title,'category':x.category,'duration_secs':x.time_spent_secs,'timestamp':x.visited_at})
        events.sort(key=lambda x:x['timestamp'], reverse=True)
        for x in events: x['timestamp'] = x['timestamp'].isoformat(); x['duration'] = duration(x['duration_secs'])
        return Response({'summary':m, 'events':events[:100]})


def _top_duration(queryset, value_field, sum_field):
    """Top (name, seconds) from a real aggregation, or (None, 0)."""
    row = list(
        queryset.values(value_field).annotate(seconds=Sum(sum_field)).order_by('-seconds')[:1]
    )
    if row:
        return row[0][value_field], int(row[0]['seconds'] or 0)
    return None, 0


def _focus_score(m):
    """Same heuristic as FocusScoreView — returns None when there is no data."""
    if not m['total_secs']:
        return None
    productive_ratio = m['productive_secs'] / m['total_secs'] * 100
    distraction_penalty = m['distracting_secs'] / m['total_secs'] * 35
    idle_penalty = m['idle_secs'] / m['total_secs'] * 15
    switch_penalty = min(20, m['switches'] * 1.5)
    return round(max(0, min(100, productive_ratio - distraction_penalty
                            - idle_penalty - switch_penalty)), 1)


def _score_label(score, lang):
    if score is None:
        return ''
    if score >= 70:
        return text(lang, 'label_high')
    if score >= 40:
        return text(lang, 'label_moderate')
    return text(lang, 'label_low')


# ── Greeting / small-talk ───────────────────────────────────────────────────
# Short greetings are answered locally; never sent to RAG or metrics.
GREETING_WORDS = ('hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening')


def _is_greeting(q):
    cleaned = ' '.join(re.sub(r'[^\w\s]', ' ', q.lower()).split())
    if not cleaned:
        return False
    if cleaned in GREETING_WORDS:
        return True
    # "hi there", "hey bot" — a greeting word plus a couple of tokens only.
    return cleaned.split(' ')[0] in ('hi', 'hello', 'hey') and len(cleaned.split()) <= 4


# Questions that belong to the existing RAG knowledge base rather than to the
# user's own activity data.
KNOWLEDGE_KEYWORDS = (
    'pomodoro', 'context switch', 'context switching', 'deep work', 'attention',
    'distraction', 'digital wellness', 'habit', 'restore', 'technique', 'advice',
    'how do i', 'how can i', 'why do i', 'tip', 'tips', 'best practice', 'strategy',
    'improve focus', 'stay focused', 'burnout', 'wellbeing',
    # General knowledge markers (programming / science explanations).
    'what is', 'what are', 'what was', 'explain', 'define', 'definition of',
    'meaning of', 'tell me about', 'describe', 'how does', 'how do ',
    'polymorphism', 'inheritance', 'neural network', ' algorithm',
    'python', 'java', 'oops', 'object oriented',
)

# Concept-question openers: "what is X" asks about a topic, not about the user.
KNOWLEDGE_QUESTION_STARTERS = (
    'what is', 'what are', 'what was', 'explain', 'define', 'definition of',
    'meaning of', 'tell me about', 'describe', 'how does', 'how do ',
    'difference between', 'why is', 'why do ',
)


def _is_knowledge_question(q):
    # Personal/activity signals win: questions about the user's own tracked data
    # ("my ...", "today", "how much", "how many", "streak", ...) must be answered
    # from the database, never from the generic knowledge base. This keeps
    # "How much coding time did I have today?" on the activity path even though
    # it contains the word "coding".
    personal_markers = (
        'my ', 'my?', 'my.', 'today', 'yesterday', 'tomorrow', 'this week',
        'this month', 'last week', 'how much', 'how many', 'did i', 'have i',
        'was i', 'am i', 'do i have', 'most ', 'streak',
    )
    if any(marker in q for marker in personal_markers):
        return False
    # Concept questions ("what is ...", "explain ...") are knowledge questions.
    if any(starter in q for starter in KNOWLEDGE_QUESTION_STARTERS):
        return True
    return any(k in q for k in KNOWLEDGE_KEYWORDS)


def _pretty_source(name):
    """Turn a seed file name into a readable label for the chat source line."""
    label = str(name or '').rsplit('/', 1)[-1].rsplit('\\', 1)[-1]
    for ext in ('.txt', '.md'):
        if label.endswith(ext):
            label = label[:-len(ext)]
    return label.replace('_', ' ').replace('-', ' ').strip()


def _is_grounded(keywords, haystack):
    """True when at least one meaningful question keyword occurs in the text.

    ChromaDB always returns the nearest neighbours, even when nothing is really
    related, so a retrieved document is only used when the question and the
    document share a meaningful keyword. Matching is token based: a token counts
    when it equals the keyword or when it only differs by a short inflection
    ("focus"/"focused", "network"/"networks"). This rejects unrelated documents
    that ChromaDB returns as the nearest neighbours (for example the question
    about "France" matching the word "Francesco").
    """
    tokens = re.findall(r'[a-z]+', str(haystack or '').lower())
    for key in keywords:
        if len(key) < 3:
            continue
        for token in tokens:
            if token == key:
                return True
            if token.startswith(key) and len(token) - len(key) <= 2:
                return True
            if key.startswith(token) and len(key) - len(token) <= 2:
                return True
    return False


def _short_knowledge_answer(question, chunks, lang):
    """Build a concise user-facing answer from retrieved context.

    Retrieved chunks are internal context only: source headers, triple quotes
    and duplicate sentences are stripped and only the sentences of the
    best-matching document that actually relate to the question are kept.
    A document is used only when the question is lexically grounded in it
    (shared keyword in the text or in its file name); otherwise the honest
    "no matching reference material" message is returned instead of a
    misleading answer built from an unrelated document.
    """
    stopwords = {
        'what', 'is', 'are', 'was', 'the', 'a', 'an', 'of', 'in', 'on', 'for',
        'to', 'and', 'or', 'how', 'do', 'does', 'did', 'explain', 'define',
        'meaning', 'tell', 'me', 'about', 'describe', 'my', 'your', 'with',
        'why', 'between', 'difference', 'you', 'can', 'means',
    }
    keywords = [w for w in re.findall(r'[a-z]+', question.lower()) if w not in stopwords]

    def sentences_of(body):
        body = str(body or '')
        # Drop the seed-file header block and its pseudo-quotes.
        body = body.replace('"""', ' ').replace('FocusGuard AI', ' ').replace(
            'Productivity & Computer-Science reference notes', ' ').replace(
            'Source: general study reference for the local RAG knowledge base', ' ').replace(
            'Each file in this folder is one document seeded into ChromaDB', ' ')
        body = re.sub(r'\s+', ' ', body).strip()
        return [s.strip() for s in re.split(r'(?<=[.!?])\s+', body) if len(s.strip()) >= 25]

    def relevance(piece):
        low = piece.lower()
        return sum(1 for key in keywords if key and key in low)

    # Take the best-ranked document that the question is actually about.
    chosen = None
    for chunk in chunks or []:
        if _is_grounded(keywords, f"{chunk.get('content') or ''} {chunk.get('source') or ''}"):
            chosen = chunk
            break
    if chosen is None:
        return text(lang, 'knowledge_empty'), ''

    sentences = sentences_of(chosen.get('content'))
    picked = sorted((s for s in sentences if relevance(s) > 0), key=relevance, reverse=True)[:3]
    if not picked:
        picked = sentences[:2]
    if not picked:
        return text(lang, 'knowledge_empty'), ''

    answer = ' '.join(dict.fromkeys(picked)).strip()
    if len(answer) > 520:
        answer = answer[:517].rsplit(' ', 1)[0] + '...'
    # The label of the document the text actually came from, so the chat can
    # show one short "Source: ..." line (or none when nothing matched).
    return answer, _pretty_source(chosen.get('source'))


class AskView(generics.GenericAPIView):
    """
    POST /api/ai/ask/   { "question": "...", "lang": "en" }

    Activity questions are answered from the EXISTING database aggregations.
    Knowledge questions go through the EXISTING ChromaDB RAG retriever. When
    neither has the information, an honest "not enough data" reply is returned
    — never an invented statistic.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        question = str(request.data.get('question', '')).strip()
        if not question:
            return Response({'detail': 'question is required'}, status=status.HTTP_400_BAD_REQUEST)

        lang = normalize_lang(request.data.get('lang'))
        q = question.lower()
        today = timezone.localdate()

        # ── Greeting (no data needed) ──────────────────────────────────
        if _is_greeting(q):
            return Response({
                'answer': text(lang, 'greeting'),
                'sources': [],
                'intent': 'greeting',
                'lang': lang,
            })

        # ── A. Knowledge / RAG questions (existing engine, untouched) ────
        if _is_knowledge_question(q):
            chunks = []
            engine_available = True
            try:
                from apps.ai_engine.rag.retriever import retrieve_relevant_context
                chunks = retrieve_relevant_context(question, top_k=3) or []
            except Exception as exc:  # optional RAG dependencies may be missing
                engine_available = False
                print(f'[RAG Engine Warning] {exc}')

            if chunks:
                answer, primary = _short_knowledge_answer(question, chunks, lang)
                return Response({
                    'answer': answer,
                    'sources': [primary] if primary else [],
                    'source': primary,
                    'intent': 'knowledge',
                    'lang': lang,
                    'engine_available': engine_available,
                })
            return Response({
                'answer': text(lang, 'knowledge_empty'),
                'sources': [],
                'intent': 'knowledge',
                'lang': lang,
                'engine_available': engine_available,
            })

        # ── B. Activity questions (real data only) ───────────────────────
        # Streak comes from historical gamification data, so it is answered
        # even when nothing has been tracked yet today.
        if 'streak' in q:
            try:
                from apps.dashboard.gamification import compute_user_streaks
                streaks = compute_user_streaks(request.user)
            except Exception as exc:
                print(f'[Streak Warning] {exc}')
                streaks = {'current_streak': 0, 'total_active_days': 0}
            return Response({
                'answer': text(lang, 'streak',
                               count=streaks.get('current_streak', 0),
                               total=streaks.get('total_active_days', 0)),
                'sources': ['focus sessions', 'productive app & browsing logs'],
                'intent': 'streak',
                'lang': lang,
            })

        m = metrics(request.user, today)
        if not m['total_secs']:
            return Response({
                'answer': text(lang, 'insufficient'),
                'sources': [],
                'intent': 'insufficient',
                'lang': lang,
                'metrics': m,
            })

        sys_logs = SystemAppLog.objects.filter(user=request.user, started_at__date=today)
        browse_logs = BrowsingLog.objects.filter(user=request.user, visited_at__date=today)

        sources = ['today activity aggregation']
        params = {}
        intent = 'summary'

        if 'switch' in q:
            intent = 'switches'
            params = {'count': m['switches']}

        elif 'score' in q or 'rating' in q or 'attention score' in q:
            score = _focus_score(m)
            intent = 'focus_score'
            params = {'score': score, 'label': _score_label(score, lang)}
            sources = ['today activity aggregation', 'focus score heuristic']

        elif ('coding' in q or 'development' in q or 'code time' in q
                or 'code' in q and ('time' in q or 'much' in q or 'today' in q)):
            dev_sys = sys_logs.filter(category='DEVELOPMENT').aggregate(s=Sum('duration_secs'))['s'] or 0
            dev_browse = browse_logs.filter(category='DEVELOPMENT').aggregate(s=Sum('time_spent_secs'))['s'] or 0
            intent = 'coding_time'
            params = {'duration': human_duration(dev_sys + dev_browse, lang)}
            sources = ['desktop app logs (DEVELOPMENT)', 'browser logs (DEVELOPMENT)']

        elif 'idle' in q or 'away' in q:
            if m['idle_secs']:
                intent = 'idle_time'
                params = {'duration': human_duration(m['idle_secs'], lang)}
            else:
                intent = 'idle_none'

        elif 'distract' in q and ('site' in q or 'website' in q or 'domain' in q or 'web' in q):
            name, secs = _top_duration(
                browse_logs.filter(productivity_label='DISTRACTING'), 'domain', 'time_spent_secs')
            if not name:
                return Response({'answer': text(lang, 'insufficient'), 'sources': [],
                                 'intent': 'insufficient', 'lang': lang, 'metrics': m})
            intent = 'distracting_site'
            params = {'name': name, 'duration': human_duration(secs, lang)}
            sources = ['browser logs (DISTRACTING)']

        elif 'distract' in q and ('app' in q or 'application' in q):
            name, secs = _top_duration(
                sys_logs.filter(productivity_label='DISTRACTING'), 'app_name', 'duration_secs')
            if not name:
                return Response({'answer': text(lang, 'insufficient'), 'sources': [],
                                 'intent': 'insufficient', 'lang': lang, 'metrics': m})
            intent = 'distracting_app'
            params = {'name': name, 'duration': human_duration(secs, lang)}
            sources = ['desktop app logs (DISTRACTING)']

        elif 'distract' in q or 'disturb' in q:
            # Generic distraction question: report the real distracted total.
            if m['distracting_secs']:
                intent = 'distraction_time'
                params = {'duration': human_duration(m['distracting_secs'], lang)}
            else:
                intent = 'distraction_none'
            sources = ['today activity aggregation (DISTRACTING)']

        elif 'most' in q or 'longest' in q or 'spend' in q:
            app_name, app_secs = _top_duration(sys_logs, 'app_name', 'duration_secs')
            site_name, site_secs = _top_duration(browse_logs, 'domain', 'time_spent_secs')
            if app_name and app_secs >= site_secs:
                name, secs = app_name, app_secs
            elif site_name:
                name, secs = site_name, site_secs
            else:
                name, secs = app_name, app_secs
            if not name:
                return Response({'answer': text(lang, 'insufficient'), 'sources': [],
                                 'intent': 'insufficient', 'lang': lang, 'metrics': m})
            intent = 'most_activity'
            params = {'name': name, 'duration': human_duration(secs, lang)}
            sources = ['desktop app logs', 'browser logs']

        elif 'productive' in q or 'focus time' in q:
            if m['productive_secs']:
                intent = 'productive_time'
                params = {'duration': human_duration(m['productive_secs'], lang)}
            else:
                intent = 'productive_none'

        else:
            intent = 'summary'
            params = {
                'productive': human_duration(m['productive_secs'], lang) if m['productive_secs'] else text(lang, 'none_word'),
                'distracting': human_duration(m['distracting_secs'], lang) if m['distracting_secs'] else text(lang, 'none_word'),
                'count': m['switches'],
            }

        active = FocusSession.objects.filter(
            user=request.user, status='ACTIVE').order_by('-start_time').first()

        return Response({
            'answer': text(lang, intent, **params),
            'trace': text(lang, 'traceable'),
            'sources': sources,
            'intent': intent,
            'lang': lang,
            'goal': active.goal if active else '',
            'metrics': m,
        })


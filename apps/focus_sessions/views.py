from datetime import timedelta
from rest_framework import viewsets, generics, permissions, status
from rest_framework.response import Response
from django.utils import timezone
from .models import FocusSession, FocusCheckIn
from .serializers import FocusSessionSerializer, FocusCheckInSerializer
from .goals import (
    DEFAULT_BLOCKED_APPS, DEFAULT_BLOCKED_DOMAINS, goal_blocklist,
    normalize_goal, classify_for_goal, get_goal_profile, domain_matches,
)



class FocusSessionViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = FocusSessionSerializer

    def get_queryset(self):
        qs = FocusSession.objects.filter(user=self.request.user).order_by('-start_time')
        date_param = self.request.query_params.get('date')
        if date_param:
            qs = qs.filter(start_time__date=date_param)
        return qs

    def perform_create(self, serializer):
        now = timezone.now()
        # Clean up any previously open active sessions for this user
        FocusSession.objects.filter(user=self.request.user, status='ACTIVE').update(
            status='COMPLETED',
            end_time=now
        )
        # Close any lingering unclosed system app logs so new session starts with a clean slate
        from apps.system_monitor.models import SystemAppLog
        SystemAppLog.objects.filter(user=self.request.user, ended_at__isnull=True).update(ended_at=now)

        # Ensure both desktop and vision background agents are running
        try:
            from apps.system_monitor.agent_launcher import ensure_agents_running
            ensure_agents_running()
        except Exception:
            pass

        serializer.save(user=self.request.user, start_time=now, status='ACTIVE')


class EndFocusSessionView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = FocusSessionSerializer

    def post(self, request, pk=None):
        return self._end(request, pk)

    def patch(self, request, pk=None):
        return self._end(request, pk)

    def _end(self, request, pk=None):
        if pk and pk != 0:
            session = FocusSession.objects.filter(pk=pk, user=request.user, status='ACTIVE').first()
        else:
            session = FocusSession.objects.filter(user=request.user, status='ACTIVE').order_by('-start_time').first()

        if not session:
            return Response({"error": "No active focus session found"}, status=status.HTTP_404_NOT_FOUND)

        now = timezone.now()
        # Clean up any other lingering active sessions
        FocusSession.objects.filter(user=request.user, status='ACTIVE').exclude(pk=session.pk).update(
            status='COMPLETED',
            end_time=now
        )
        session.end_time = now
        duration_mins = int((now - session.start_time).total_seconds() / 60)
        session.actual_duration_mins = max(1, duration_mins)
        session.status = request.data.get('status', 'COMPLETED')
        session.interruptions = request.data.get('interruptions', session.interruptions)
        session.notes = request.data.get('notes', session.notes)

        # Isolated metrics strictly between session start_time and end_time
        from apps.browsing.models import BrowsingLog, SwitchEvent
        from apps.system_monitor.models import SystemAppLog, SystemSwitchEvent, AttentionLog
        from django.db.models import Sum

        b_logs = BrowsingLog.objects.filter(user=request.user, visited_at__gte=session.start_time, visited_at__lte=now)
        b_prod = b_logs.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('time_spent_secs'))['s'] or 0
        b_dist = b_logs.filter(productivity_label='DISTRACTING').aggregate(s=Sum('time_spent_secs'))['s'] or 0

        s_logs = SystemAppLog.objects.filter(user=request.user, started_at__gte=session.start_time, started_at__lte=now)
        s_prod = s_logs.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('duration_secs'))['s'] or 0
        s_dist = s_logs.filter(productivity_label='DISTRACTING').aggregate(s=Sum('duration_secs'))['s'] or 0

        v_logs = AttentionLog.objects.filter(user=request.user, timestamp__gte=session.start_time, timestamp__lte=now)
        v_prod = v_logs.filter(state='FOCUSED').aggregate(s=Sum('duration_secs'))['s'] or 0
        v_dist = v_logs.filter(state__in=['LOOKING_AT_PHONE', 'LOOKING_AWAY']).aggregate(s=Sum('duration_secs'))['s'] or 0

        b_switches = SwitchEvent.objects.filter(user=request.user, switched_at__gte=session.start_time, switched_at__lte=now).count()
        s_switches = SystemSwitchEvent.objects.filter(user=request.user, switched_at__gte=session.start_time, switched_at__lte=now).count()

        session_total_secs = max(1, int((now - session.start_time).total_seconds()))
        distracted_secs = max(session.distracted_secs, b_dist + s_dist + v_dist)
        productive_secs = max(session.productive_secs, b_prod + s_prod + v_prod)

        # If desktop agent / extension didn't report explicit apps, default to session duration minus distractions
        if productive_secs == 0 and distracted_secs < session_total_secs:
            productive_secs = max(1, session_total_secs - distracted_secs)

        session.productive_secs = productive_secs
        session.distracted_secs = distracted_secs
        session.switches_count = max(session.switches_count, b_switches + s_switches)

        total_session_secs = session.productive_secs + session.distracted_secs
        if session.distracted_secs == 0:
            session.productivity_score = 100.0
        elif total_session_secs > 0:
            session.productivity_score = round((session.productive_secs / total_session_secs) * 100, 1)
        else:
            session.productivity_score = 100.0


        # Focus score heuristic (0 - 100) based on interruptions and switches
        switches_penalty = min(35, int(session.switches_count * 1.5))
        base_score = max(10, int(session.productivity_score) - switches_penalty)
        session.focus_score = base_score

        session.save()
        return Response(FocusSessionSerializer(session).data)


class ActiveFocusSessionView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if request.headers.get('X-Client-Type') == 'chrome-extension' or request.META.get('HTTP_X_CLIENT_TYPE') == 'chrome-extension':
            from django.core.cache import cache
            cache.set(f"ext_active_{request.user.id}", timezone.now().timestamp(), 90)

        session = FocusSession.objects.filter(user=request.user, status='ACTIVE').order_by('-start_time').first()
        if not session:
            return Response({"active": False, "session": None})
        
        now = timezone.now()
        duration_mins = int((now - session.start_time).total_seconds() / 60)
        return Response({
            "active": True,
            "session": {
                "id": session.id,
                "session_type": session.session_type,
                "start_time": session.start_time.isoformat(),
                "duration_mins": duration_mins
            }
        })


# The built-in blocklist defaults now live in `apps/focus_sessions/goals.py`
# (single source of truth shared with the goal-based classification layer) and
# are imported at the top of this module.


class BlocklistView(generics.GenericAPIView):
    """
    GET  /api/focus/blocklist/         → current blocklist
    GET  /api/focus/blocklist/?goal=X  → current blocklist + goal profile

    The legacy keys (``blocked_apps`` / ``blocked_domains``) are preserved
    exactly as before so the desktop agent keeps working unchanged. The
    additional ``goal_*`` keys describe what the active goal also shields.
    """
    permission_classes = [permissions.IsAuthenticated]

    def _user_prefs(self, user):
        from apps.users.models import UserProfile
        profile, _ = UserProfile.objects.get_or_create(user=user)
        prefs = profile.focus_preferences or {}
        return profile, prefs

    def get(self, request):
        profile, prefs = self._user_prefs(request.user)
        blocked_apps = prefs.get('blocked_apps', DEFAULT_BLOCKED_APPS)
        blocked_domains = prefs.get('blocked_domains', DEFAULT_BLOCKED_DOMAINS)

        goal_param = request.query_params.get('goal')
        if not goal_param:
            active = FocusSession.objects.filter(user=request.user, status='ACTIVE').order_by('-start_time').first()
            goal_param = active.goal if active else prefs.get('focus_goal', '')

        profile_data = goal_blocklist(goal_param, blocked_domains, blocked_apps)

        return Response({
            # ── Legacy contract (unchanged) ──
            "blocked_apps": blocked_apps,
            "blocked_domains": blocked_domains,
            # ── Goal-aware additions ──
            "goal": profile_data['goal'],
            "goal_label": profile_data['goal_label'],
            "goal_blocked_apps": profile_data['blocked_apps'],
            "goal_blocked_domains": profile_data['blocked_domains'],
            "allowed_categories": profile_data['allowed_categories'],
            "blocked_categories": profile_data['blocked_categories'],
            "question_key": profile_data['question_key'],
            "refresh_question_key": profile_data['refresh_question_key'],
        })

    def post(self, request):
        profile, prefs = self._user_prefs(request.user)

        if 'blocked_apps' in request.data:
            apps = [str(a).strip().lower() for a in request.data['blocked_apps'] if str(a).strip()]
            prefs['blocked_apps'] = list(dict.fromkeys(apps))

        if 'blocked_domains' in request.data:
            domains = [str(d).strip().lower() for d in request.data['blocked_domains'] if str(d).strip()]
            prefs['blocked_domains'] = list(dict.fromkeys(domains))

        if 'focus_goal' in request.data:
            prefs['focus_goal'] = normalize_goal(request.data['focus_goal'])

        profile.focus_preferences = prefs
        profile.save(update_fields=['focus_preferences'])
        return Response({
            "success": True,
            "blocked_apps": prefs.get('blocked_apps', DEFAULT_BLOCKED_APPS),
            "blocked_domains": prefs.get('blocked_domains', DEFAULT_BLOCKED_DOMAINS),
            "focus_goal": prefs.get('focus_goal', ''),
        })





# ═══════════════════════════════════════════════════════════════════════════
#  CURRENT FOCUS  ·  REAL detected activity only
# ═══════════════════════════════════════════════════════════════════════════

# Process / app names the Windows desktop agent uses for a real OS idle period.
IDLE_PROCESS_NAMES = {'idle'}
IDLE_APP_NAMES = {'system idle / away', 'system idle', 'idle'}

# A real continuous idle / distraction episode of ~10 minutes triggers a check-in.
CHECKIN_THRESHOLD_SECS = 600
# A browsing log older than this is NOT reported as the "current tab".
TAB_STALE_SECS = 300
# ~1 hour of REAL productive focus enables the optional refresh.
PRODUCTIVE_REFRESH_SECS = 3600

BROWSER_MARKERS = ('chrome', 'msedge', 'edge', 'brave', 'firefox', 'opera', 'vivaldi')
BROWSER_WINDOW_SUFFIXES = ('google chrome', 'microsoft edge', 'brave', 'mozilla firefox',
                           'firefox', 'opera', 'vivaldi')


def _is_browser(app_name='', process_name=''):
    hay = f'{app_name} {process_name}'.lower()
    return any(marker in hay for marker in BROWSER_MARKERS)


def _tab_title_from_window(window_title=''):
    """Derives the current tab title from a real browser window title."""
    title = (window_title or '').strip()
    if not title:
        return ''
    lowered = title.lower()
    for suffix in BROWSER_WINDOW_SUFFIXES:
        for sep in (' - ', ' — ', ' – ', ' | '):
            candidate = sep + suffix
            if lowered.endswith(candidate):
                return title[:len(title) - len(candidate)].strip()
    return ''


def _live_session_productive_secs(user, session, now):
    """Real productive seconds recorded inside the active session window."""
    from django.db.models import Sum
    from apps.browsing.models import BrowsingLog
    from apps.system_monitor.models import SystemAppLog

    b = BrowsingLog.objects.filter(
        user=user, visited_at__gte=session.start_time, visited_at__lte=now,
        productivity_label='PRODUCTIVE'
    ).aggregate(s=Sum('time_spent_secs'))['s'] or 0
    s = SystemAppLog.objects.filter(
        user=user, started_at__gte=session.start_time, started_at__lte=now,
        productivity_label='PRODUCTIVE'
    ).aggregate(s=Sum('duration_secs'))['s'] or 0
    return int(b + s)


def _recent_away_secs(user, since):
    """
    REAL continuous away time measured by the Windows idle tracker.
    Returns (secs, available) — `available` is False when the idle tracker has
    never reported an away period, so the UI can say so rather than invent X.
    """
    from apps.system_monitor.models import SystemAppLog
    qs = SystemAppLog.objects.filter(user=user, process_name__iexact='idle')
    if since:
        qs = qs.filter(started_at__gte=since)
    idle_log = qs.order_by('-started_at').first()
    if not idle_log or not idle_log.duration_secs:
        return 0, False
    return int(idle_log.duration_secs), True


class _TrackerStatus:
    """
    Derives the real current status from the newest real Windows desktop
    activity record. Contains no synthetic values: when the desktop agent has
    not reported anything, ``available`` stays False.
    """

    def __init__(self, user, open_app, now):
        self.user = user
        self.open_app = open_app
        self.now = now
        self.is_idle = False
        self.away_confirmed = False
        self.idle_secs = 0
        self.distraction_secs = 0
        self.app_duration_secs = 0
        self.episode_ref = 'none'
        self.status = 'IDLE'
        self.available = False
        self.message_key = 'currentFocus.noDesktopAgent'

    def update(self):
        if not self.open_app:
            self.status = 'IDLE'
            self.available = False
            self.message_key = 'currentFocus.noDesktopAgent'
            return

        self.available = True
        self.message_key = ''
        self.app_duration_secs = max(0, int(self.open_app.duration_secs or 0))
        self.episode_ref = f"app{self.open_app.id}"

        proc = (self.open_app.process_name or '').lower()
        appn = (self.open_app.app_name or '').lower()
        self.is_idle = proc in IDLE_PROCESS_NAMES or appn in IDLE_APP_NAMES

        # Has the user confirmed "I'm Away" without a return recorded since?
        last_check = FocusCheckIn.objects.filter(
            user=self.user, kind='IDLE_CHECK').order_by('-created_at').first()
        last_return = FocusCheckIn.objects.filter(
            user=self.user, kind='RETURN').order_by('-created_at').first()
        if (last_check and last_check.state == 'AWAY'
                and (not last_return or last_return.created_at < last_check.created_at)):
            self.away_confirmed = True

        if self.is_idle:
            self.idle_secs = self.app_duration_secs
            self.status = 'AWAY' if self.away_confirmed else 'IDLE'
            self.episode_ref = f"idle{self.open_app.id}"
            return

        if self.open_app.productivity_label == 'DISTRACTING':
            self.status = 'DISTRACTED'
            self.distraction_secs = self.app_duration_secs
            return

        if self.open_app.productivity_label == 'PRODUCTIVE':
            self.status = 'FOCUSED'
        else:
            self.status = 'UNKNOWN'


class CurrentFocusView(generics.GenericAPIView):
    """
    GET /api/focus/current-focus/

    Returns ONLY real detected information about what the user is doing right
    now. Anything that cannot be determined is returned as null plus a message
    key — never as fabricated data.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from apps.browsing.models import BrowsingLog
        from apps.system_monitor.models import SystemAppLog
        from apps.users.models import UserProfile

        user = request.user
        now = timezone.now()

        session = FocusSession.objects.filter(
            user=user, status='ACTIVE'
        ).order_by('-start_time').first()
        goal = session.goal if (session and session.goal) else 'OTHER'
        profile_data = get_goal_profile(goal)

        profile, _ = UserProfile.objects.get_or_create(user=user)
        prefs = profile.focus_preferences or {}
        user_blocked = prefs.get('blocked_domains', DEFAULT_BLOCKED_DOMAINS)

        # ── Real current desktop app ─────────────────────────────────────
        open_app = SystemAppLog.objects.filter(
            user=user, ended_at__isnull=True
        ).order_by('-started_at').first()

        tracking = _TrackerStatus(user, open_app, now)
        tracking.update()

        window_title = (open_app.window_title if open_app else '') or ''
        app_is_browser = _is_browser(
            open_app.app_name if open_app else '',
            open_app.process_name if open_app else ''
        )

        # ── Real current browser tab ─────────────────────────────────────
        latest_browse = BrowsingLog.objects.filter(user=user).order_by('-visited_at').first()
        tab = None
        tab_message_key = 'currentTab.unavailable'

        if app_is_browser:
            window_tab_title = _tab_title_from_window(window_title)
            fresh_browse = None
            if latest_browse and latest_browse.visited_at:
                age = (now - latest_browse.visited_at).total_seconds()
                if age <= TAB_STALE_SECS:
                    fresh_browse = latest_browse

            if fresh_browse or window_tab_title:
                tab = {
                    'title': (window_tab_title or fresh_browse.page_title or '')[:120],
                    'domain': fresh_browse.domain if fresh_browse else '',
                    'category': fresh_browse.category if fresh_browse else '',
                    'productivity_label': fresh_browse.productivity_label if fresh_browse else '',
                    'duration_secs': int(fresh_browse.time_spent_secs) if fresh_browse else 0,
                    'detected_at': (fresh_browse.visited_at.isoformat() if fresh_browse
                                    else now.isoformat()),
                    'source': ('extension+window_title' if (fresh_browse and window_tab_title)
                               else ('extension' if fresh_browse else 'window_title')),
                }
                tab_message_key = ''

        # ── Goal-aware verdict on the real activity ─────────────────────
        app_verdict = None
        if open_app:
            app_verdict = classify_for_goal(
                open_app.category, open_app.productivity_label,
                domain='', goal=goal, user_blocked_domains=user_blocked
            )

        tab_verdict = None
        if tab:
            tab_verdict = classify_for_goal(
                tab.get('category'), tab.get('productivity_label'),
                domain=tab.get('domain') or '', goal=goal,
                user_blocked_domains=user_blocked
            )

        surfaces = []
        if tab_verdict:
            surfaces.append(('TAB', tab_verdict))
        if app_verdict:
            surfaces.append(('APP', app_verdict))

        # ── Derived status from REAL signals ─────────────────────────────
        status_value = tracking.status
        blocked_info = None

        if tracking.available and not tracking.is_idle and surfaces:
            primary_kind, primary = surfaces[0]
            if primary['verdict'] == 'BLOCKED':
                # Explicit blocklist rules → BLOCKED (enforced). Detected
                # distracting content that is not explicitly listed → DISTRACTED.
                status_value = ('BLOCKED' if primary['reason'] in ('user_blocklist', 'goal_blocklist')
                                else 'DISTRACTED')
                blocked_info = {
                    'reason': primary['reason'],
                    'matched': primary['matched'],
                    'what': (tab.get('domain') if (primary_kind == 'TAB' and tab)
                             else (open_app.app_name if open_app else '')),
                    'surface': primary_kind,
                }
            elif primary['verdict'] == 'ALLOWED':
                status_value = 'FOCUSED'
            else:
                status_value = 'UNKNOWN'

        # ── Real continuous idle / distraction episode → check-in ────────
        continuous_secs = 0
        reason_code = ''
        episode_key = ''

        if tracking.is_idle and not tracking.away_confirmed:
            continuous_secs = tracking.idle_secs
            reason_code = 'IDLE'
        elif status_value in ('DISTRACTED', 'BLOCKED'):
            continuous_secs = tracking.distraction_secs
            reason_code = 'DISTRACTION'

        if reason_code and continuous_secs >= CHECKIN_THRESHOLD_SECS:
            cycle = continuous_secs // CHECKIN_THRESHOLD_SECS
            episode_key = f"{reason_code}:{tracking.episode_ref}:{cycle}"

        # The check-in belongs to focus mode: the goal-based questions only make
        # sense while a real focus session is running.
        checkin_due = bool(session and reason_code and episode_key)
        if checkin_due and FocusCheckIn.objects.filter(
            user=user, kind='IDLE_CHECK', episode_key=episode_key
        ).exists():
            checkin_due = False

        # ── Optional 1-hour productive refresh ──────────────────────────
        refresh = {
            'due': False,
            'productive_secs': 0,
            'hour_index': 0,
            'question_key': profile_data['refresh_question_key'],
            'episode_key': '',
        }
        if session:
            prod_secs = _live_session_productive_secs(user, session, now)
            refresh['productive_secs'] = prod_secs
            if prod_secs >= PRODUCTIVE_REFRESH_SECS:
                hour_index = prod_secs // PRODUCTIVE_REFRESH_SECS
                refresh_key = f"refresh:{session.id}:{hour_index}"
                refresh['hour_index'] = hour_index
                refresh['episode_key'] = refresh_key
                if not FocusCheckIn.objects.filter(
                    user=user, kind='REFRESH', episode_key=refresh_key
                ).exists():
                    refresh['due'] = True

        return Response({
            'available': tracking.available,
            'message_key': tracking.message_key,

            'goal': goal,
            'goal_label': profile_data['label'],
            'focus_mode': bool(session),
            'session': {
                'id': session.id,
                'session_type': session.session_type,
                'start_time': session.start_time.isoformat(),
                'elapsed_secs': int((now - session.start_time).total_seconds()),
            } if session else None,

            'application': {
                'name': open_app.app_name,
                'process_name': open_app.process_name,
                'window_title': (open_app.window_title or '')[:160],
                'category': open_app.category,
                'productivity_label': open_app.productivity_label,
                'duration_secs': tracking.app_duration_secs,
                'is_browser': app_is_browser,
            } if open_app else None,

            'tab': tab,
            'tab_message_key': tab_message_key,

            'status': status_value,
            'blocked': blocked_info,
            'duration_secs': tracking.app_duration_secs,

            'checkin': {
                'due': checkin_due,
                'reason': reason_code,
                'continuous_secs': continuous_secs,
                'episode_key': episode_key if checkin_due else '',
                'question_key': profile_data['question_key'],
                'timeout_secs': 180,
            },
            'refresh': refresh,
            'detected_at': now.isoformat(),
        })




class FocusCheckInView(generics.GenericAPIView):
    """
    POST /api/focus/checkin/  → record a REAL user response
    GET  /api/focus/checkin/  → recent recorded responses (today)

    Used by three flows in the web app:
      * IDLE_CHECK — "are you active or away?" after ~10 min of real continuous
                     idle / distraction.
      * RETURN     — "what were you doing?" when the user comes back.
      * REFRESH    — optional 1-hour productive-focus learning refresh.

    All durations are computed on the server from real tracker records; the
    client cannot inflate them. Free-text answers are stored verbatim.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        today = timezone.localdate()
        qs = FocusCheckIn.objects.filter(user=request.user, created_at__date=today)[:30]
        return Response({
            'today': today.isoformat(),
            'checkins': FocusCheckInSerializer(qs, many=True).data,
        })

    def post(self, request):
        kind = str(request.data.get('kind', 'IDLE_CHECK')).strip().upper()
        if kind not in dict(FocusCheckIn.KINDS):
            return Response({'error': 'invalid kind'}, status=status.HTTP_400_BAD_REQUEST)

        state = str(request.data.get('state', '')).strip().upper()
        if state and state not in dict(FocusCheckIn.STATES):
            return Response({'error': 'invalid state'}, status=status.HTTP_400_BAD_REQUEST)

        reason = str(request.data.get('reason', '')).strip().upper()[:20]
        episode_key = str(request.data.get('episode_key', '')).strip()[:80]
        response_text = str(request.data.get('response_text', '')).strip()

        now = timezone.now()

        session = FocusSession.objects.filter(
            user=request.user, status='ACTIVE'
        ).order_by('-start_time').first()
        goal = session.goal if (session and session.goal) else 'OTHER'

        # Real continuous away time from the Windows idle tracker.
        since = session.start_time if session else (now - timedelta(days=1))
        away_secs, away_available = _recent_away_secs(request.user, since)

        productive_secs = _live_session_productive_secs(request.user, session, now) if session else 0

        if kind == 'IDLE_CHECK' and episode_key:
            existing = FocusCheckIn.objects.filter(
                user=request.user, kind='IDLE_CHECK', episode_key=episode_key
            ).first()
            if existing:
                return Response({
                    'recorded': False,
                    'duplicate': True,
                    'checkin': FocusCheckInSerializer(existing).data,
                    'away_secs': existing.away_secs,
                    'away_secs_available': True,
                    'goal': goal,
                })

        instance = FocusCheckIn.objects.create(
            user=request.user,
            session=session,
            kind=kind,
            state=state[:20],
            goal=goal,
            away_secs=away_secs,
            productive_secs=productive_secs,
            reason=reason,
            episode_key=episode_key,
            response_text=response_text,
        )

        payload = {
            'recorded': True,
            'duplicate': False,
            'checkin': FocusCheckInSerializer(instance).data,
            'away_secs': away_secs,
            'away_secs_available': away_available,
            'productive_secs': productive_secs,
            'goal': goal,
            'goal_label': get_goal_profile(goal)['label'],
        }

        if kind == 'RETURN':
            # Friendly, non-judgemental, non-medical acknowledgement.
            payload['message_key'] = 'return.welcome' if away_secs <= 900 else 'return.welcomeLong'

        return Response(payload, status=status.HTTP_201_CREATED)


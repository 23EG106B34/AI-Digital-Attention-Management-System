from datetime import timedelta
from django.db.models import Sum
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from apps.browsing.models import BrowsingLog, SwitchEvent
from apps.system_monitor.models import SystemAppLog, SystemSwitchEvent
from apps.users.models import Goal


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


class AskView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]
    def post(self, request):
        question = str(request.data.get('question', '')).strip()
        if not question: return Response({'detail':'question is required'}, status=status.HTTP_400_BAD_REQUEST)
        m = metrics(request.user, timezone.localdate())
        if not m['total_secs']: return Response({'answer':'I do not have enough collected activity data for today to answer that reliably.', 'sources':[]})
        q = question.lower(); apps = list(SystemAppLog.objects.filter(user=request.user, started_at__date=timezone.localdate()).values('app_name').annotate(seconds=Sum('duration_secs')).order_by('-seconds')[:1]); sites = list(BrowsingLog.objects.filter(user=request.user, visited_at__date=timezone.localdate()).values('domain').annotate(seconds=Sum('time_spent_secs')).order_by('-seconds')[:1])
        if 'idle' in q: answer = f'You had {duration(m["idle_secs"])} of neutral or idle tracked time today.'
        elif 'switch' in q: answer = f'You switched apps or tabs {m["switches"]} times today.'
        elif 'most' in q and ('app' in q or 'use' in q): answer = f'Your most-used desktop app was {apps[0]["app_name"]} for {duration(apps[0]["seconds"])}.' if apps else (f'Your most-used browser site was {sites[0]["domain"]} for {duration(sites[0]["seconds"])}.' if sites else 'No individual app or site data is available.')
        else: answer = f'Today you recorded {duration(m["productive_secs"])} productive time, {duration(m["distracting_secs"])} distraction time, and {m["switches"]} switches. This answer uses your collected tracker data only.'
        return Response({'answer':answer, 'sources':['today activity aggregation'], 'metrics':m})

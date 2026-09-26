from django.db import models
from django.contrib.auth.models import User


# ── Goal-based focus mode ───────────────────────────────────────────────────
# These are the focus goals a user can pick when starting a session. They drive
# the goal-aware classification layer on top of the EXISTING blocklist system.
FOCUS_GOALS = [
    ('STUDYING',        'Studying'),
    ('CODING',          'Coding'),
    ('ASSIGNMENT',      'Assignment'),
    ('ONLINE_LEARNING', 'Online Learning'),
    ('GAMES',           'Games'),
    ('OTHER',           'Other'),
]

DEFAULT_FOCUS_GOAL = 'OTHER'


class FocusSession(models.Model):
    SESSION_TYPES = [
        ('DEEP_WORK', 'Deep Work'),
        ('POMODORO', 'Pomodoro'),
        ('STUDY', 'Study'),
        ('MEETING', 'Meeting'),
    ]

    STATUS_CHOICES = [
        ('ACTIVE', 'Active'),
        ('COMPLETED', 'Completed'),
        ('ABANDONED', 'Abandoned'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='focus_sessions')
    start_time = models.DateTimeField()
    end_time = models.DateTimeField(null=True, blank=True)
    planned_duration_mins = models.IntegerField(default=25)
    actual_duration_mins = models.IntegerField(null=True, blank=True)
    interruptions = models.IntegerField(default=0)
    session_type = models.CharField(max_length=50, choices=SESSION_TYPES, default='POMODORO')
    goal = models.CharField(max_length=30, choices=FOCUS_GOALS, blank=True, default='')
    notes = models.TextField(blank=True, default='')
    focus_score = models.FloatField(null=True, blank=True)
    productive_secs = models.IntegerField(default=0)
    distracted_secs = models.IntegerField(default=0)
    switches_count = models.IntegerField(default=0)
    productivity_score = models.FloatField(default=0.0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='ACTIVE')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username} - {self.session_type} ({self.status})"


class FocusCheckIn(models.Model):
    """
    Records REAL user responses to the in-app focus check flow:

      * IDLE_CHECK : the "are you active or away?" prompt shown after a
                     continuous idle / distraction episode.
      * RETURN     : the "what were you doing?" prompt shown when the user
                     returns after being away.
      * REFRESH    : the optional 1-hour productive-focus learning refresh.

    Only user-supplied answers and server-computed real durations are stored.
    """

    KINDS = [
        ('IDLE_CHECK', 'Idle / Distraction Check'),
        ('RETURN', 'Return From Away'),
        ('REFRESH', 'Productive Refresh'),
    ]

    STATES = [
        ('ACTIVE', 'Active'),
        ('AWAY', 'Away'),
        ('SKIPPED', 'Skipped'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='focus_checkins')
    session = models.ForeignKey(
        FocusSession, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='checkins'
    )

    kind = models.CharField(max_length=20, choices=KINDS, default='IDLE_CHECK')
    state = models.CharField(max_length=20, choices=STATES, blank=True, default='')
    goal = models.CharField(max_length=30, choices=FOCUS_GOALS, blank=True, default='')

    # Real, server-computed seconds of continuous idle / away time.
    away_secs = models.IntegerField(default=0)
    # Real seconds of productive focus recorded on the active session.
    productive_secs = models.IntegerField(default=0)

    reason = models.CharField(max_length=20, blank=True, default='')   # IDLE | DISTRACTION | NO_RESPONSE | ''
    episode_key = models.CharField(max_length=80, blank=True, default='')

    # Free-text answer entered by the user — never translated, never rewritten.
    response_text = models.TextField(blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['user', 'kind', 'created_at'])]

    def __str__(self):
        return f"{self.user.username} · {self.kind}/{self.state} ({self.created_at:%H:%M})"


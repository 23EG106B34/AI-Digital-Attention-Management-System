from rest_framework import serializers
from .models import FOCUS_GOALS, FocusSession, FocusCheckIn
from .goals import normalize_goal


class FocusSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = FocusSession
        fields = [
            'id', 'start_time', 'end_time', 'planned_duration_mins',
            'actual_duration_mins', 'interruptions', 'session_type', 'goal',
            'productive_secs', 'distracted_secs', 'switches_count', 'productivity_score',
            'notes', 'focus_score', 'status', 'created_at'
        ]
        read_only_fields = ['id', 'start_time', 'created_at']

    def validate_goal(self, value):
        if not value:
            return 'OTHER'
        normalized = normalize_goal(value)
        valid_keys = {choice[0] for choice in FOCUS_GOALS}
        if normalized in valid_keys:
            return normalized
        return value


class FocusCheckInSerializer(serializers.ModelSerializer):
    class Meta:
        model = FocusCheckIn
        fields = [
            'id', 'kind', 'state', 'goal', 'away_secs', 'productive_secs',
            'reason', 'episode_key', 'response_text', 'created_at'
        ]
        read_only_fields = ['id', 'created_at', 'away_secs', 'productive_secs', 'episode_key']


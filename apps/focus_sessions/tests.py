from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from datetime import timedelta
from rest_framework.test import APIClient

from .models import FocusCheckIn, FocusSession
from apps.system_monitor.models import SystemAppLog


class FocusSessionLifecycleTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='focus-session-test')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_start_active_and_stop_persist_for_authenticated_user(self):
        with patch('apps.system_monitor.agent_launcher.ensure_agents_running'):
            start_response = self.client.post(
                '/api/focus/start/',
                {
                    'session_type': 'DEEP_WORK',
                    'goal': 'CODING',
                    'planned_duration_mins': 0,
                },
                format='json',
            )

        self.assertEqual(start_response.status_code, 201, start_response.data)
        session_id = start_response.data['id']
        session = FocusSession.objects.get(pk=session_id, user=self.user)
        self.assertEqual(session.status, 'ACTIVE')
        self.assertEqual(session.goal, 'CODING')

        active_response = self.client.get('/api/focus/active/')
        self.assertEqual(active_response.status_code, 200)
        self.assertTrue(active_response.data['active'])
        self.assertEqual(active_response.data['session']['id'], session_id)

        end_response = self.client.post(
            '/api/focus/end/', {'status': 'COMPLETED'}, format='json'
        )
        self.assertEqual(end_response.status_code, 200, end_response.data)
        session.refresh_from_db()
        self.assertEqual(session.status, 'COMPLETED')
        self.assertIsNotNone(session.end_time)
        self.assertGreaterEqual(session.actual_duration_mins, 1)

    def test_start_requires_authentication(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(
            '/api/focus/start/',
            {'session_type': 'DEEP_WORK', 'goal': 'STUDYING'},
            format='json',
        )
        self.assertEqual(response.status_code, 401)

    def test_current_focus_returns_frontend_contract(self):
        response = self.client.get('/api/focus/current-focus/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('application', response.data)
        self.assertIn('tab', response.data)
        self.assertIn('checkin', response.data)
        self.assertIn('refresh', response.data)

    def test_idle_checkin_response_is_saved_for_authenticated_user(self):
        response = self.client.post(
            '/api/focus/checkin/',
            {
                'kind': 'IDLE_CHECK',
                'state': 'ACTIVE',
                'reason': 'IDLE',
                'episode_key': 'test-idle-episode',
                'response_text': 'Still studying',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        checkin = FocusCheckIn.objects.get(user=self.user, episode_key='test-idle-episode')
        self.assertEqual(checkin.state, 'ACTIVE')
        self.assertEqual(checkin.response_text, 'Still studying')

    def test_completed_idle_episode_prompts_for_return_once(self):
        now = timezone.now()
        session = FocusSession.objects.create(
            user=self.user,
            start_time=now - timedelta(minutes=20),
            status='ACTIVE',
        )
        idle_log = SystemAppLog.objects.create(
            user=self.user,
            process_name='idle',
            app_name='System Idle / Away',
            category='SYSTEM',
            productivity_label='NEUTRAL',
            started_at=now - timedelta(minutes=12),
            ended_at=now - timedelta(minutes=1),
            duration_secs=660,
        )

        response = self.client.get('/api/focus/current-focus/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['return_checkin']['due'])
        self.assertEqual(response.data['return_checkin']['away_secs'], 660)

        episode_key = response.data['return_checkin']['episode_key']
        saved = self.client.post(
            '/api/focus/checkin/',
            {
                'kind': 'RETURN',
                'state': 'ACTIVE',
                'reason': 'RETURN',
                'episode_key': episode_key,
                'response_text': 'Reading',
            },
            format='json',
        )
        self.assertEqual(saved.status_code, 201, saved.data)
        self.assertEqual(FocusCheckIn.objects.get(episode_key=episode_key).session, session)

        refreshed = self.client.get('/api/focus/current-focus/')
        self.assertFalse(refreshed.data['return_checkin']['due'])
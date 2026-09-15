"""
FocusGuard URL Configuration
"""
from django.contrib import admin
from django.urls import path, include
from django.views.generic import TemplateView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', TemplateView.as_view(template_name='index.html'), name='home'),
    path('api/auth/', include('apps.users.urls')),
    path('api/browsing/', include('apps.browsing.urls')),
    path('api/focus/', include('apps.focus_sessions.urls')),
    path('api/ai/', include('apps.ai_engine.urls')),
    path('api/dashboard/', include('apps.dashboard.urls')),
    path('api/system/', include('apps.system_monitor.urls')),
    path('api/', include('apps.intelligence.urls')),
    path('api/goals/', include('apps.users.goals_urls')),
]

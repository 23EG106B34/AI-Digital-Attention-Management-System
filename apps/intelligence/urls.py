from django.urls import path
from .views import FocusScoreView, StreakView, AnalyticsView, ActivityView, AskView
urlpatterns = [path('focus-score/', FocusScoreView.as_view()), path('streaks/', StreakView.as_view()), path('analytics/dashboard/', AnalyticsView.as_view()), path('analytics/weekly/', AnalyticsView.as_view()), path('activity/', ActivityView.as_view()), path('activity/today/', ActivityView.as_view()), path('activity/summary/', ActivityView.as_view()), path('activity/weekly/', AnalyticsView.as_view()), path('ai/ask/', AskView.as_view())]

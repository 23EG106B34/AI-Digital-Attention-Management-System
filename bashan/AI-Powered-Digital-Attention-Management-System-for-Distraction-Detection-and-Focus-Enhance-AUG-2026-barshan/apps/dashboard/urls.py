from django.urls import path
from .views import DashboardSummaryView, DateReportView
from .trends import TrendsView
from .export import CSVExportView
from .gamification import GamificationView

urlpatterns = [
    path('summary/', DashboardSummaryView.as_view(), name='dashboard-summary'),
    path('report/', DateReportView.as_view(), name='dashboard-report'),
    path('trends/', TrendsView.as_view(), name='dashboard-trends'),
    path('export/csv/', CSVExportView.as_view(), name='dashboard-export-csv'),
    path('gamification/', GamificationView.as_view(), name='dashboard-gamification'),
]

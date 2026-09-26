from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    FocusSessionViewSet, EndFocusSessionView, ActiveFocusSessionView, BlocklistView,
    CurrentFocusView, FocusCheckInView,
)

router = DefaultRouter()
router.register(r'sessions', FocusSessionViewSet, basename='focus-session')

urlpatterns = [
    path('active/', ActiveFocusSessionView.as_view(), name='focus-session-active'),
    path('blocklist/', BlocklistView.as_view(), name='focus-blocklist'),
    path('current-focus/', CurrentFocusView.as_view(), name='focus-current'),
    path('checkin/', FocusCheckInView.as_view(), name='focus-checkin'),
    path('start/', FocusSessionViewSet.as_view({'post': 'create'}), name='focus-session-start'),
    path('end/',   EndFocusSessionView.as_view(), name='focus-session-end-active'),
    path('<int:pk>/end/', EndFocusSessionView.as_view(), name='focus-session-end-direct'),
    path('sessions/<int:pk>/end/', EndFocusSessionView.as_view(), name='focus-session-end'),
    path('', include(router.urls)),
]


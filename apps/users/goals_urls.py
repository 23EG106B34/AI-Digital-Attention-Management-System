from django.urls import path
from .views import GoalViewSet

goal_list = GoalViewSet.as_view({'get': 'list', 'post': 'create'})
goal_detail = GoalViewSet.as_view({'put': 'update', 'patch': 'partial_update'})
urlpatterns = [path('', goal_list), path('<int:pk>/', goal_detail)]

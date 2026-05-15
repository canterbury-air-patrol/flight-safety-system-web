"""
Shared view decorators.
"""
from functools import wraps

from django.http import JsonResponse


def login_required_api(view_func):
    """
    Like @login_required but returns 403 JSON instead of redirecting,
    so fetch() callers receive an unambiguous error rather than a 200 HTML page.
    """
    @wraps(view_func)
    def _wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({'error': 'Authentication required'}, status=403)
        return view_func(request, *args, **kwargs)
    return _wrapped

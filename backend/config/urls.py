from pathlib import Path

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import FileResponse, JsonResponse
from django.urls import re_path


def health_check(request):
    return JsonResponse({"status": "ok"})


def frontend_app(request, path=""):
    index_file = Path(settings.BASE_DIR).parent / "frontend" / "dist" / "index.html"
    if not index_file.is_file():
        return JsonResponse(
            {"detail": "Frontend build is missing."},
            status=503,
        )
    return FileResponse(index_file.open("rb"), content_type="text/html")


urlpatterns = [
    path("health/", health_check),
    path("admin/", admin.site.urls),
    path("api/", include("core.urls")),
    re_path(r"^(?!api/|admin/|health/|static/).*", frontend_app),
]


# ============================================================
# MEDIA FILES
# ============================================================

if settings.DEBUG:
    urlpatterns += static(
        settings.MEDIA_URL,
        document_root=settings.MEDIA_ROOT
    )
# Mahaveer Tiles and Marbles Management System

Inventory, purchase, sales, customer, reporting, and bill OCR management app.

## Local development

1. Copy `backend/.env.example` to `backend/.env` and set a private
   `DJANGO_SECRET_KEY` and the local PostgreSQL credentials.
2. Install Python dependencies from `backend/requirements.txt` in a virtual
   environment.
3. Install frontend dependencies with `npm ci` from `frontend/`.
4. Run `python manage.py migrate` and `python manage.py runserver` from
   `backend/`.
5. Run `npm run dev` from `frontend/`.

The Vite development server proxies `/api` requests to Django on port 8000.

## Persistent deployment on Render

The root `render.yaml` defines a Docker web service, PostgreSQL database, and a
persistent disk for uploaded bills. The Docker image builds the React frontend
and serves it from the same origin as Django so session authentication and CSRF
work without cross-site cookies.

1. Open the Render Blueprint deploy page for this repository:
   <https://render.com/deploy?repo=https://github.com/sameerdas-codes/mahaveer-tiles-marbles-management-system>
2. Sign in to Render, connect the GitHub repository, review the paid service,
   database, and persistent disk in the Blueprint, and approve provisioning.
3. Set any optional OCR/OTP provider secrets in Render. Never place these values
   in Git.
4. After the first successful deployment, open the web service Shell and run
   `python manage.py createsuperuser` from `/app/backend` to create the
   production admin login.
5. Open the service's `https://...onrender.com` URL. `/health/` should return
   `{"status":"ok"}`.

The Render database and bill-upload disk are separate from the local database;
local records and login credentials are not copied to production.
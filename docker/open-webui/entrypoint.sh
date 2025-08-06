#!/bin/bash
set -e

echo "Starting Open WebUI..."

# Wait for database to be ready
echo "Waiting for database..."
until pg_isready -h $DATABASE_HOST -p $DATABASE_PORT -U $DATABASE_USER; do
  echo "Database is unavailable - sleeping"
  sleep 2
done

echo "Database is ready!"

# Start the application
exec /app/backend/start.sh
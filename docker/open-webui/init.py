import os
import sys
import time
import psycopg2
from psycopg2.extras import RealDictCursor
import bcrypt
import json
import uuid
from datetime import datetime

# Configuration from environment
DB_HOST = os.environ.get('DATABASE_HOST')
DB_PORT = os.environ.get('DATABASE_PORT', '5432')
DB_NAME = os.environ.get('DATABASE_NAME', 'openwebui')
DB_USER = os.environ.get('DATABASE_USER', 'postgres')
DB_PASSWORD = os.environ.get('DATABASE_PASSWORD')
ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@example.com')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD')
BEDROCK_ENDPOINT = os.environ.get('BEDROCK_GATEWAY_URL')

def wait_for_db():
    """Wait for database to be ready"""
    max_retries = 30
    retry_count = 0
    
    while retry_count < max_retries:
        try:
            conn = psycopg2.connect(
                host=DB_HOST,
                port=DB_PORT,
                database=DB_NAME,
                user=DB_USER,
                password=DB_PASSWORD
            )
            conn.close()
            print("Database is ready!")
            return True
        except psycopg2.OperationalError:
            retry_count += 1
            print(f"Database not ready, waiting... ({retry_count}/{max_retries})")
            time.sleep(2)
    
    raise Exception("Database not available after maximum retries")

def init_database():
    """Initialize database schema and data"""
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )
    
    cur = conn.cursor()
    
    # Create tables
    print("Creating database schema...")
    
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            name VARCHAR(255),
            role VARCHAR(50) DEFAULT 'user',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    
    cur.execute("""
        CREATE TABLE IF NOT EXISTS models (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(255) NOT NULL,
            model_id VARCHAR(255) NOT NULL,
            api_type VARCHAR(50) DEFAULT 'bedrock',
            api_base VARCHAR(255),
            api_key VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    
    cur.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(255) PRIMARY KEY,
            value TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    
    # Check if already initialized
    cur.execute("SELECT COUNT(*) FROM users WHERE email = %s", (ADMIN_EMAIL,))
    if cur.fetchone()[0] > 0:
        print("Database already initialized, skipping...")
        conn.close()
        return
    
    # Create admin user
    print("Creating admin user...")
    password_hash = bcrypt.hashpw(ADMIN_PASSWORD.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    
    cur.execute("""
        INSERT INTO users (email, password_hash, name, role)
        VALUES (%s, %s, %s, %s)
    """, (ADMIN_EMAIL, password_hash, 'Administrator', 'admin'))
    
    # Configure Bedrock models
    print("Configuring Bedrock models...")
    bedrock_models = [
        ('Claude 3 Opus', 'anthropic.claude-3-opus-20240229-v1:0'),
        ('Claude 3 Sonnet', 'anthropic.claude-3-sonnet-20240229-v1:0'),
        ('Claude 3 Haiku', 'anthropic.claude-3-haiku-20240307-v1:0'),
        ('Llama 2 70B', 'meta.llama2-70b-chat-v1'),
        ('Mistral 7B', 'mistral.mistral-7b-instruct-v0:2'),
    ]
    
    for name, model_id in bedrock_models:
        cur.execute("""
            INSERT INTO models (name, model_id, api_type, api_base)
            VALUES (%s, %s, %s, %s)
        """, (name, model_id, 'bedrock', BEDROCK_ENDPOINT))
    
    # Configure settings
    print("Configuring application settings...")
    settings = {
        'auth.enabled': 'true',
        'auth.default_role': 'pending',
        'ui.default_model': 'anthropic.claude-3-sonnet-20240229-v1:0',
        'llm.api_base': BEDROCK_ENDPOINT,
        'llm.api_type': 'bedrock'
    }
    
    for key, value in settings.items():
        cur.execute("""
            INSERT INTO settings (key, value)
            VALUES (%s, %s)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        """, (key, value))
    
    conn.commit()
    cur.close()
    conn.close()
    
    print("Database initialization complete!")

def main():
    try:
        print("Starting database initialization...")
        wait_for_db()
        init_database()
        print("Initialization complete!")
    except Exception as e:
        print(f"Error during initialization: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
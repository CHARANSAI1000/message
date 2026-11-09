from app.routers import auth, contacts, health, keys, messages, users

all_routers = [health.router, auth.router, keys.router, users.router, contacts.router, messages.router]

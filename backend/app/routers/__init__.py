from app.routers import attachments, auth, calls, contacts, health, keys, messages, profile, push, users

all_routers = [
    health.router, auth.router, profile.router, keys.router, users.router, contacts.router,
    messages.router, attachments.router, calls.router, push.router,
]

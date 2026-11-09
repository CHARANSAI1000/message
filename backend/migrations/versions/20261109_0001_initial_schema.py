"""initial schema

Revision ID: 0001
Revises: 
Create Date: 2026-11-09 22:59:22.730662
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '0001'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('users',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('username', sa.Text(), nullable=False),
    sa.Column('password_hash', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("username ~ '^[a-z0-9_.-]{3,32}$'", name=op.f('ck_users_username_format')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_users')),
    sa.UniqueConstraint('username', name=op.f('uq_users_username'))
    )
    op.create_table('blocks',
    sa.Column('blocker_id', sa.Uuid(), nullable=False),
    sa.Column('blocked_id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('blocker_id <> blocked_id', name=op.f('ck_blocks_not_self')),
    sa.ForeignKeyConstraint(['blocked_id'], ['users.id'], name=op.f('fk_blocks_blocked_id_users'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['blocker_id'], ['users.id'], name=op.f('fk_blocks_blocker_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('blocker_id', 'blocked_id', name=op.f('pk_blocks'))
    )
    op.create_table('contacts',
    sa.Column('owner_id', sa.Uuid(), nullable=False),
    sa.Column('contact_id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('owner_id <> contact_id', name=op.f('ck_contacts_not_self')),
    sa.ForeignKeyConstraint(['contact_id'], ['users.id'], name=op.f('fk_contacts_contact_id_users'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_contacts_owner_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('owner_id', 'contact_id', name=op.f('pk_contacts'))
    )
    op.create_table('public_keys',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('spki', sa.LargeBinary(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('octet_length(spki) BETWEEN 64 AND 200', name=op.f('ck_public_keys_spki_size')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_public_keys_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_public_keys'))
    )
    op.create_index('ix_public_keys_user_id_id', 'public_keys', ['user_id', 'id'], unique=False)
    op.create_table('sessions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('token_hash', sa.LargeBinary(), nullable=False),
    sa.Column('user_agent', sa.Text(), server_default='', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_sessions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_sessions')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_sessions_token_hash'))
    )
    op.create_index(op.f('ix_sessions_expires_at'), 'sessions', ['expires_at'], unique=False)
    op.create_index(op.f('ix_sessions_user_id'), 'sessions', ['user_id'], unique=False)
    op.create_table('messages',
    sa.Column('seq', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('sender_id', sa.Uuid(), nullable=False),
    sa.Column('recipient_id', sa.Uuid(), nullable=False),
    sa.Column('sender_key_id', sa.BigInteger(), nullable=False),
    sa.Column('recipient_key_id', sa.BigInteger(), nullable=False),
    sa.Column('iv', sa.LargeBinary(), nullable=False),
    sa.Column('ciphertext', sa.LargeBinary(), nullable=False),
    sa.Column('ttl_seconds', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('octet_length(iv) = 12', name=op.f('ck_messages_iv_size')),
    sa.ForeignKeyConstraint(['recipient_id'], ['users.id'], name=op.f('fk_messages_recipient_id_users'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['recipient_key_id'], ['public_keys.id'], name=op.f('fk_messages_recipient_key_id_public_keys'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['sender_id'], ['users.id'], name=op.f('fk_messages_sender_id_users'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['sender_key_id'], ['public_keys.id'], name=op.f('fk_messages_sender_key_id_public_keys'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('seq', name=op.f('pk_messages')),
    sa.UniqueConstraint('id', name=op.f('uq_messages_id'))
    )
    op.create_index(op.f('ix_messages_expires_at'), 'messages', ['expires_at'], unique=False)
    op.create_index('ix_messages_recipient_id_seq', 'messages', ['recipient_id', 'seq'], unique=False)
    op.create_index('ix_messages_sender_id_seq', 'messages', ['sender_id', 'seq'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_messages_sender_id_seq', table_name='messages')
    op.drop_index('ix_messages_recipient_id_seq', table_name='messages')
    op.drop_index(op.f('ix_messages_expires_at'), table_name='messages')
    op.drop_table('messages')
    op.drop_index(op.f('ix_sessions_user_id'), table_name='sessions')
    op.drop_index(op.f('ix_sessions_expires_at'), table_name='sessions')
    op.drop_table('sessions')
    op.drop_index('ix_public_keys_user_id_id', table_name='public_keys')
    op.drop_table('public_keys')
    op.drop_table('contacts')
    op.drop_table('blocks')
    op.drop_table('users')

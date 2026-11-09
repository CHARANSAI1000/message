"""email login and google

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-09 23:33:05.438488
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '0002'
down_revision: str | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('email_codes',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('email', sa.Text(), nullable=False),
    sa.Column('purpose', sa.Text(), nullable=False),
    sa.Column('salt', sa.LargeBinary(), nullable=False),
    sa.Column('code_hash', sa.LargeBinary(), nullable=False),
    sa.Column('attempts', sa.Integer(), server_default='0', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("purpose IN ('verify_email', 'login', 'reset_password', 'delete_account')", name=op.f('ck_email_codes_purpose_valid')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_email_codes'))
    )
    op.create_index('ix_email_codes_email_purpose', 'email_codes', ['email', 'purpose'], unique=False)
    op.create_index(op.f('ix_email_codes_expires_at'), 'email_codes', ['expires_at'], unique=False)
    op.add_column('users', sa.Column('email', sa.Text(), nullable=True))
    op.add_column('users', sa.Column('email_verified_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('google_sub', sa.Text(), nullable=True))
    op.alter_column('users', 'password_hash',
               existing_type=sa.TEXT(),
               nullable=True)
    op.create_unique_constraint(op.f('uq_users_email'), 'users', ['email'])
    op.create_unique_constraint(op.f('uq_users_google_sub'), 'users', ['google_sub'])
    op.create_check_constraint(op.f('ck_users_email_lowercase'), 'users', 'email IS NULL OR email = lower(email)')


def downgrade() -> None:
    op.drop_constraint(op.f('ck_users_email_lowercase'), 'users', type_='check')
    op.drop_constraint(op.f('uq_users_google_sub'), 'users', type_='unique')
    op.drop_constraint(op.f('uq_users_email'), 'users', type_='unique')
    op.alter_column('users', 'password_hash',
               existing_type=sa.TEXT(),
               nullable=False)
    op.drop_column('users', 'google_sub')
    op.drop_column('users', 'email_verified_at')
    op.drop_column('users', 'email')
    op.drop_index(op.f('ix_email_codes_expires_at'), table_name='email_codes')
    op.drop_index('ix_email_codes_email_purpose', table_name='email_codes')
    op.drop_table('email_codes')

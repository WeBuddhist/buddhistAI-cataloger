from enum import Enum
from sqlalchemy import String, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from core.database import Base


class UserRole(Enum):
    USER = "user"
    ANNOTATOR = "annotator"
    Reviewer = "reviewer"
    ADMIN = "admin"

class Permissions(Enum):
    Outliner = "outliner"
    Cataloger = "cataloger"
    Dedup = "dedup"
    OutlineFix = "outline_fix"
    AuthorIdentification = "author_identification"

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str | None]
    picture: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    role: Mapped[str | None] = mapped_column(String, nullable=True,default='user')
    permissions: Mapped[list[Permissions]] = mapped_column(String, nullable=True)
    # Role in the Deduplicator, set apart from `role` (the Outliner's): "annotator",
    # "reviewer" (shown as Adjudicator) or "admin". NULL = annotator.
    dedup_role: Mapped[str | None] = mapped_column(String, nullable=True)
    # Role in the Outline Fixer, apart from the other two: "annotator" or "admin".
    # NULL = annotator. Set from the Outline Fixer's own Users page.
    outline_fix_role: Mapped[str | None] = mapped_column(String, nullable=True)
    # Role in Author Identification, apart from the others: "annotator", "reviewer" or
    # "admin". NULL = annotator. Set from its own Users page.
    author_identification_role: Mapped[str | None] = mapped_column(String, nullable=True)
    memberships = relationship("TenantMembership", back_populates="user")




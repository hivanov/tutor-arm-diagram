"""Pydantic v2 models for the Architecture Runtime Model (ARM) Diagram XBlock."""

from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field, field_validator, model_validator


class ServiceType(str, Enum):
    """Supported external interface service types in ARM."""
    UI = "UI"
    REST_API = "REST_API"
    EVENT = "EVENT"
    GRAPHQL = "GRAPHQL"
    GRPC = "GRPC"
    BATCH = "BATCH"


class AppScope(str, Enum):
    """Scope of application ownership from the perspective of the responsible team."""
    INTERNAL = "INTERNAL"  # Maintained by the team
    EXTERNAL = "EXTERNAL"  # Other teams / 3rd-party / SaaS / Platforms


class AppSourcing(str, Enum):
    """Application sourcing strategy / delivery type."""
    MAKE = "MAKE"  # Built in-house
    BUY = "BUY"    # Commercial off-the-shelf / SaaS
    USE = "USE"    # Standardized platform service


class SyncType(str, Enum):
    """Synchronous vs asynchronous invocation."""
    SYNC = "SYNC"
    ASYNC = "ASYNC"


class FeedbackSeverity(str, Enum):
    """Severity of student feedback items."""
    SUCCESS = "SUCCESS"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"


class HintTier(str, Enum):
    """3-Tier progressive hint classification."""
    TIER_1_GUIDING = "TIER_1_GUIDING"
    TIER_2_CONTEXT = "TIER_2_CONTEXT"
    TIER_3_DIAGNOSTIC = "TIER_3_DIAGNOSTIC"


# --- Student Diagram AST Models ---

class ARMDataObject(BaseModel):
    """A data object owned and managed by an Application."""
    id: str = Field(..., description="Unique element identifier")
    name: str = Field(..., min_length=1, description="Data object name (e.g. Customer, Order)")
    classification: Optional[str] = Field(default=None, description="Optional data classification (e.g. Master, Transactional)")

    @field_validator("name")
    @classmethod
    def clean_name(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Data object name cannot be empty or blank")
        return cleaned


class ARMService(BaseModel):
    """An external interface service attached to an Application."""
    id: str = Field(..., description="Unique element identifier")
    name: str = Field(..., min_length=1, description="Service name (e.g. Auth API, Navigation Event)")
    service_type: ServiceType = Field(default=ServiceType.REST_API, description="Service interface type")

    @field_validator("name")
    @classmethod
    def clean_name(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Service name cannot be empty or blank")
        return cleaned


class ARMApplication(BaseModel):
    """An independent black-box application container with team responsibility and business capabilities."""
    id: str = Field(..., description="Unique application identifier")
    name: str = Field(..., min_length=1, description="Application name (e.g. Kaufland Card App, CIDAAS)")
    team: Optional[str] = Field(default=None, description="Responsible team or domain")
    scope: AppScope = Field(default=AppScope.INTERNAL, description="Internal (Team Maintained) vs External vs Infrastructure")
    sourcing: Optional[AppSourcing] = Field(default=None, description="Make vs Buy vs Use delivery type")
    business_capabilities: List[str] = Field(default_factory=list, description="Business capabilities implemented by this application")
    services: List[ARMService] = Field(default_factory=list, description="Services provided by this application")
    data_objects: List[ARMDataObject] = Field(default_factory=list, description="Data objects managed by this application")
    x: float = Field(default=0.0, description="Canvas X position")
    y: float = Field(default=0.0, description="Canvas Y position")
    width: float = Field(default=260.0, description="Container width")
    height: float = Field(default=200.0, description="Container height")

    @model_validator(mode="after")
    def apply_sourcing_defaults(self) -> "ARMApplication":
        # If internal and sourcing omitted, defaults to MAKE
        if self.scope == AppScope.INTERNAL and self.sourcing is None:
            self.sourcing = AppSourcing.MAKE
        return self

    @field_validator("name")
    @classmethod
    def clean_name(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Application name cannot be empty or blank")
        return cleaned

    @field_validator("services")
    @classmethod
    def deduplicate_service_ids(cls, v: List[ARMService]) -> List[ARMService]:
        seen = set()
        for s in v:
            if s.id in seen:
                raise ValueError(f"Duplicate service id '{s.id}' in application")
            seen.add(s.id)
        return v

    @field_validator("data_objects")
    @classmethod
    def deduplicate_data_ids(cls, v: List[ARMDataObject]) -> List[ARMDataObject]:
        seen = set()
        for d in v:
            if d.id in seen:
                raise ValueError(f"Duplicate data object id '{d.id}' in application")
            seen.add(d.id)
        return v


class ARMDependency(BaseModel):
    """A directed dependency relationship from an originating application/service to a consumed target service."""
    id: str = Field(..., description="Unique dependency identifier")
    source_app_id: str = Field(..., description="Originating application id")
    source_service_id: Optional[str] = Field(default=None, description="Optional originating calling service id")
    target_app_id: str = Field(..., description="Target provider application id")
    target_service_id: Optional[str] = Field(default=None, description="Target service interface id (the consumed endpoint)")
    sync_type: SyncType = Field(default=SyncType.SYNC, description="Sync vs Async communication")
    protocol: Optional[str] = Field(default=None, description="Communication protocol (e.g. HTTPS/REST, Kafka, gRPC)")


class ARMGraph(BaseModel):
    """Complete ARM diagram graph submission AST."""
    applications: List[ARMApplication] = Field(default_factory=list, description="All application nodes")
    dependencies: List[ARMDependency] = Field(default_factory=list, description="All dependency edges")

    @model_validator(mode="after")
    def validate_graph_integrity(self) -> "ARMGraph":
        app_ids = {app.id: app for app in self.applications}
        service_ids = {srv.id: (app.id, srv) for app in self.applications for srv in app.services}

        for dep in self.dependencies:
            if dep.source_app_id not in app_ids:
                raise ValueError(f"Dependency '{dep.id}' references non-existent source app '{dep.source_app_id}'")
            if dep.target_app_id not in app_ids:
                raise ValueError(f"Dependency '{dep.id}' references non-existent target app '{dep.target_app_id}'")
            if dep.target_service_id and dep.target_service_id not in service_ids:
                raise ValueError(f"Dependency '{dep.id}' references non-existent target service '{dep.target_service_id}'")
            if dep.source_service_id and dep.source_service_id not in service_ids:
                raise ValueError(f"Dependency '{dep.id}' references non-existent source service '{dep.source_service_id}'")
            if dep.source_app_id == dep.target_app_id and dep.source_service_id and dep.source_service_id == dep.target_service_id:
                raise ValueError(f"Self-referencing dependency on service '{dep.target_service_id}' is invalid")
        return self


# --- Lab Criteria & Evaluation Models ---

class RequiredServiceCriterion(BaseModel):
    """Required service within an application."""
    name: str = Field(..., min_length=1)
    service_type: Optional[ServiceType] = None
    aliases: List[str] = Field(default_factory=list)
    points: float = Field(default=0.5, ge=0.0)


class RequiredDataObjectCriterion(BaseModel):
    """Required data object within an application."""
    name: str = Field(..., min_length=1)
    aliases: List[str] = Field(default_factory=list)
    points: float = Field(default=0.5, ge=0.0)


class RequiredCapabilityCriterion(BaseModel):
    """Required business capability implemented by an application."""
    name: str = Field(..., min_length=1)
    aliases: List[str] = Field(default_factory=list)
    points: float = Field(default=0.5, ge=0.0)


class RequiredAppCriterion(BaseModel):
    """Required application entity in the lab scenario."""
    name: str = Field(..., min_length=1)
    aliases: List[str] = Field(default_factory=list)
    scope: Optional[AppScope] = None
    points: float = Field(default=1.0, ge=0.0)
    required_capabilities: List[RequiredCapabilityCriterion] = Field(default_factory=list)
    required_services: List[RequiredServiceCriterion] = Field(default_factory=list)
    required_data_objects: List[RequiredDataObjectCriterion] = Field(default_factory=list)


class RequiredDependencyCriterion(BaseModel):
    """Required dependency relationship in the lab scenario."""
    source_app: str = Field(..., min_length=1)
    target_app: str = Field(..., min_length=1)
    target_service: Optional[str] = None
    source_service: Optional[str] = None
    sync_type: Optional[SyncType] = None
    points: float = Field(default=1.0, ge=0.0)
    explanation: str = Field(default="", description="Why this dependency is architecturally required")


class ForbiddenDependencyCriterion(BaseModel):
    """Anti-pattern dependency relationship that incurs penalties."""
    source_app: str = Field(..., min_length=1)
    target_app: str = Field(..., min_length=1)
    penalty: float = Field(default=0.5, ge=0.0)
    reason: str = Field(..., min_length=1, description="Architecture violation reason")


class ARMHint(BaseModel):
    """Progressive hint item."""
    tier: HintTier = Field(default=HintTier.TIER_1_GUIDING)
    text: str = Field(..., min_length=1)


class ARMLabScenario(BaseModel):
    """Complete specification of an ARM lab exercise and its grading rules."""
    id: str = Field(..., description="Scenario unique ID")
    title: str = Field(..., description="Lab exercise title")
    description: str = Field(..., description="Scenario brief and context instructions")
    max_attempts: int = Field(default=3, ge=1)
    passing_score: float = Field(default=0.75, ge=0.0, le=1.0)
    required_apps: List[RequiredAppCriterion] = Field(default_factory=list)
    required_dependencies: List[RequiredDependencyCriterion] = Field(default_factory=list)
    forbidden_dependencies: List[ForbiddenDependencyCriterion] = Field(default_factory=list)
    hints: List[ARMHint] = Field(default_factory=list)


class FeedbackItem(BaseModel):
    """Grading feedback returned to the student."""
    severity: FeedbackSeverity
    entity_type: str  # "Application", "Service", "DataObject", "Capability", "Dependency", "Architecture"
    entity_name: str
    message: str
    points_earned: float = 0.0
    points_possible: float = 0.0


class ARMEvaluationResult(BaseModel):
    """Final evaluated result of an ARM diagram submission."""
    score: float = Field(..., ge=0.0)
    max_score: float = Field(..., ge=0.0)
    percentage: float = Field(..., ge=0.0, le=1.0)
    passed: bool
    feedbacks: List[FeedbackItem] = Field(default_factory=list)
    hints_available: int = 0
    current_hint: Optional[str] = None
    attempts_used: int = 0
    attempts_remaining: int = 0

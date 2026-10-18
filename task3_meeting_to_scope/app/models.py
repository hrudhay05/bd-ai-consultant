from typing import List, Optional, Literal
from pydantic import BaseModel, Field

Status = Literal["confirmed", "unclear", "disputed"]
Priority = Literal["must", "should", "optional"]
EstimateStatus = Literal["not_estimated", "estimated", "needs_review"]
Origin = Literal["explicit", "inferred"]
Feasibility = Literal[
    "existing_configuration",
    "existing_feature_with_limitation",
    "potential_custom_development",
    "needs_clarification",
]
VersionState = Literal["draft", "pending_approval", "approved", "rejected", "superseded"]


class Meeting(BaseModel):
    meeting_id: str
    project_id: str
    date: str
    file_path: str
    sha256: str


class Chunk(BaseModel):
    chunk_id: str
    meeting_id: str
    start_line: int
    end_line: int
    text: str


class Evidence(BaseModel):
    meeting_id: str
    timestamp: str
    speaker: str
    quote: str
    verified: bool = False


class Requirement(BaseModel):
    req_id: str
    description: str
    origin: Origin = "explicit"
    status: Status = "unclear"
    priority: Priority = "should"
    evidence: List[Evidence] = Field(default_factory=list)
    existing_solution: str = "to be checked"
    feasibility: Optional[Feasibility] = None
    feasibility_note: str = ""
    acceptance_criteria: List[str] = Field(default_factory=list)
    dependencies: List[str] = Field(default_factory=list)
    estimate_status: EstimateStatus = "not_estimated"
    removed: bool = False
    out_of_scope: bool = False


class EstimateTask(BaseModel):
    req_id: str
    task: str
    low: float
    likely: float
    high: float
    reasoning: str = ""
    assumptions: List[str] = Field(default_factory=list)
    dependencies: List[str] = Field(default_factory=list)


class ScopeVersion(BaseModel):
    project_id: str
    version: int
    state: VersionState = "draft"
    requirements: List[Requirement] = Field(default_factory=list)
    estimates: List[EstimateTask] = Field(default_factory=list)
    scope_text: str = ""
    proposal_text: str = ""
    open_questions: List[str] = Field(default_factory=list)
    based_on_version: Optional[int] = None
    created_at: str = ""


class ChangeItem(BaseModel):
    kind: Literal["added", "removed", "modified", "conflict", "out_of_scope"]
    req_id: str
    summary: str
    evidence: List[Evidence] = Field(default_factory=list)


class ChangeReport(BaseModel):
    project_id: str
    baseline_version: int
    new_version: int
    items: List[ChangeItem] = Field(default_factory=list)


class Approval(BaseModel):
    project_id: str
    version: int
    reviewer: str
    decision: Literal["approved", "rejected"]
    timestamp: str
    note: str = ""
"""Grading and validation engine for ARM diagrams."""

import re
from typing import Dict, List, Optional, Set, Tuple

from arm_diagram_xblock.models import (
    ARMApplication,
    ARMEvaluationResult,
    ARMGraph,
    ARMLabScenario,
    FeedbackItem,
    FeedbackSeverity,
    ForbiddenDependencyCriterion,
    RequiredAppCriterion,
    RequiredDependencyCriterion,
)


def normalize_name(text: str) -> str:
    """Normalize names for resilient matching (e.g., 'K-App' -> 'kapp')."""
    if not text:
        return ""
    # Lowercase and remove non-alphanumeric characters
    return re.sub(r"[^a-z0-9]", "", text.strip().lower())


def name_matches(student_text: str, target_text: str, aliases: Optional[List[str]] = None) -> bool:
    """Check if student input matches target or any allowed aliases using exact normalized equality."""
    s_norm = normalize_name(student_text)
    t_norm = normalize_name(target_text)
    if not s_norm or not t_norm:
        return False
    if s_norm == t_norm:
        return True
    if aliases:
        for alias in aliases:
            a_norm = normalize_name(alias)
            if a_norm and s_norm == a_norm:
                return True
    return False


def find_matching_application(
    student_apps: List[ARMApplication],
    criterion: RequiredAppCriterion,
) -> Optional[ARMApplication]:
    """Find a student application matching the criterion name or aliases."""
    for app in student_apps:
        if name_matches(app.name, criterion.name, criterion.aliases):
            return app
    return None


def evaluate_arm_graph(
    graph: ARMGraph,
    scenario: ARMLabScenario,
    attempts_used: int = 1,
    current_hint_index: int = 0,
) -> ARMEvaluationResult:
    """Evaluate a student's ARM diagram graph against the scenario criteria."""
    total_score = 0.0
    max_score = 0.0
    feedbacks: List[FeedbackItem] = []

    # Map student app IDs to App objects
    student_app_map: Dict[str, ARMApplication] = {app.id: app for app in graph.applications}

    # Track matched criteria to avoid double-crediting
    matched_app_by_crit: Dict[str, ARMApplication] = {}

    # 1. Evaluate Required Applications
    for app_crit in scenario.required_apps:
        max_score += app_crit.points
        matched_app = find_matching_application(graph.applications, app_crit)

        if matched_app:
            matched_app_by_crit[app_crit.name] = matched_app
            
            # Check scope if specified
            scope_ok = app_crit.scope is None or matched_app.scope == app_crit.scope
            if scope_ok:
                total_score += app_crit.points
                feedbacks.append(
                    FeedbackItem(
                        severity=FeedbackSeverity.SUCCESS,
                        entity_type="Application",
                        entity_name=matched_app.name,
                        message=f"Application '{matched_app.name}' [{matched_app.scope.value}] correctly identified.",
                        points_earned=app_crit.points,
                        points_possible=app_crit.points,
                    )
                )
            else:
                earned = app_crit.points * 0.75
                total_score += earned
                feedbacks.append(
                    FeedbackItem(
                        severity=FeedbackSeverity.WARNING,
                        entity_type="Application",
                        entity_name=matched_app.name,
                        message=f"Application '{matched_app.name}' found, but expected scope '{app_crit.scope.value}' (found '{matched_app.scope.value}').",
                        points_earned=earned,
                        points_possible=app_crit.points,
                    )
                )

            # Evaluate Required Business Capabilities on Application
            for cap_crit in getattr(app_crit, "required_capabilities", []):
                max_score += cap_crit.points
                found_cap = any(name_matches(c, cap_crit.name, cap_crit.aliases) for c in matched_app.business_capabilities)
                if found_cap:
                    total_score += cap_crit.points
                    feedbacks.append(
                        FeedbackItem(
                            severity=FeedbackSeverity.SUCCESS,
                            entity_type="Capability",
                            entity_name=f"{matched_app.name} -> {cap_crit.name}",
                            message=f"Business Capability '{cap_crit.name}' correctly implemented on '{matched_app.name}'.",
                            points_earned=cap_crit.points,
                            points_possible=cap_crit.points,
                        )
                    )
                else:
                    feedbacks.append(
                        FeedbackItem(
                            severity=FeedbackSeverity.ERROR,
                            entity_type="Capability",
                            entity_name=f"{matched_app.name} -> {cap_crit.name}",
                            message=f"Missing expected Business Capability '{cap_crit.name}' on '{matched_app.name}'.",
                            points_earned=0.0,
                            points_possible=cap_crit.points,
                        )
                    )

            # Evaluate Required Services within this application
            for srv_crit in app_crit.required_services:
                max_score += srv_crit.points
                matched_srv = next(
                    (s for s in matched_app.services if name_matches(s.name, srv_crit.name, srv_crit.aliases)),
                    None,
                )
                if matched_srv:
                    # Check service type if specified
                    type_ok = srv_crit.service_type is None or matched_srv.service_type == srv_crit.service_type
                    if type_ok:
                        total_score += srv_crit.points
                        feedbacks.append(
                            FeedbackItem(
                                severity=FeedbackSeverity.SUCCESS,
                                entity_type="Service",
                                entity_name=f"{matched_app.name} -> {matched_srv.name}",
                                message=f"Service interface '{matched_srv.name}' ({matched_srv.service_type.value}) correctly declared on '{matched_app.name}'.",
                                points_earned=srv_crit.points,
                                points_possible=srv_crit.points,
                            )
                        )
                    else:
                        earned = srv_crit.points * 0.5
                        total_score += earned
                        feedbacks.append(
                            FeedbackItem(
                                severity=FeedbackSeverity.WARNING,
                                entity_type="Service",
                                entity_name=f"{matched_app.name} -> {matched_srv.name}",
                                message=f"Service '{matched_srv.name}' found on '{matched_app.name}', but expected type '{srv_crit.service_type.value}' (found '{matched_srv.service_type.value}').",
                                points_earned=earned,
                                points_possible=srv_crit.points,
                            )
                        )
                else:
                    feedbacks.append(
                        FeedbackItem(
                            severity=FeedbackSeverity.ERROR,
                            entity_type="Service",
                            entity_name=f"{matched_app.name} -> {srv_crit.name}",
                            message=f"Missing expected service interface '{srv_crit.name}' on application '{matched_app.name}'.",
                            points_earned=0.0,
                            points_possible=srv_crit.points,
                        )
                    )

            # Evaluate Required Data Objects within this application
            for data_crit in app_crit.required_data_objects:
                max_score += data_crit.points
                matched_data = next(
                    (d for d in matched_app.data_objects if name_matches(d.name, data_crit.name, data_crit.aliases)),
                    None,
                )
                if matched_data:
                    total_score += data_crit.points
                    feedbacks.append(
                        FeedbackItem(
                            severity=FeedbackSeverity.SUCCESS,
                            entity_type="DataObject",
                            entity_name=f"{matched_app.name} -> {matched_data.name}",
                            message=f"Data object '{matched_data.name}' correctly assigned to '{matched_app.name}'.",
                            points_earned=data_crit.points,
                            points_possible=data_crit.points,
                        )
                    )
                else:
                    feedbacks.append(
                        FeedbackItem(
                            severity=FeedbackSeverity.ERROR,
                            entity_type="DataObject",
                            entity_name=f"{matched_app.name} -> {data_crit.name}",
                            message=f"Missing expected data object '{data_crit.name}' owned by '{matched_app.name}'.",
                            points_earned=0.0,
                            points_possible=data_crit.points,
                        )
                    )
        else:
            feedbacks.append(
                FeedbackItem(
                    severity=FeedbackSeverity.ERROR,
                    entity_type="Application",
                    entity_name=app_crit.name,
                    message=f"Missing required application '{app_crit.name}'.",
                    points_earned=0.0,
                    points_possible=app_crit.points,
                )
            )
            # Add points for child criteria to max_score
            for c in getattr(app_crit, "required_capabilities", []):
                max_score += c.points
            for s in app_crit.required_services:
                max_score += s.points
            for d in app_crit.required_data_objects:
                max_score += d.points

    # 2. Evaluate Required Dependencies (Service-to-Service)
    for dep_crit in scenario.required_dependencies:
        max_score += dep_crit.points

        # Find student apps corresponding to criterion source & target
        src_app = matched_app_by_crit.get(dep_crit.source_app)
        tgt_app = matched_app_by_crit.get(dep_crit.target_app)

        if not src_app or not tgt_app:
            feedbacks.append(
                FeedbackItem(
                    severity=FeedbackSeverity.ERROR,
                    entity_type="Dependency",
                    entity_name=f"{dep_crit.source_app} -> {dep_crit.target_app}",
                    message=f"Cannot verify dependency: source '{dep_crit.source_app}' or target '{dep_crit.target_app}' is missing.",
                    points_earned=0.0,
                    points_possible=dep_crit.points,
                )
            )
            continue

        # Look for matching dependency in student graph
        found_dep = None
        for d in graph.dependencies:
            if d.source_app_id == src_app.id and d.target_app_id == tgt_app.id:
                # Check target service if criterion specifies one
                if dep_crit.target_service:
                    target_srv = next((s for s in tgt_app.services if s.id == d.target_service_id), None)
                    if target_srv and name_matches(target_srv.name, dep_crit.target_service):
                        found_dep = d
                        break
                else:
                    found_dep = d
                    break

        if found_dep:
            # Check sync/async if specified
            sync_ok = dep_crit.sync_type is None or found_dep.sync_type == dep_crit.sync_type
            if sync_ok:
                total_score += dep_crit.points
                feedbacks.append(
                    FeedbackItem(
                        severity=FeedbackSeverity.SUCCESS,
                        entity_type="Dependency",
                        entity_name=f"{src_app.name} -> {tgt_app.name}",
                        message=f"Service dependency '{src_app.name}' -> '{tgt_app.name}' correctly modeled. {dep_crit.explanation}".strip(),
                        points_earned=dep_crit.points,
                        points_possible=dep_crit.points,
                    )
                )
            else:
                earned = dep_crit.points * 0.75
                total_score += earned
                feedbacks.append(
                    FeedbackItem(
                        severity=FeedbackSeverity.WARNING,
                        entity_type="Dependency",
                        entity_name=f"{src_app.name} -> {tgt_app.name}",
                        message=f"Dependency '{src_app.name}' -> '{tgt_app.name}' found, but expected {dep_crit.sync_type.value} mode.",
                        points_earned=earned,
                        points_possible=dep_crit.points,
                    )
                )
        else:
            # Check if student drew inverted dependency (pointing backwards)
            inverted = any(d.source_app_id == tgt_app.id and d.target_app_id == src_app.id for d in graph.dependencies)
            msg = (
                f"Missing service dependency from '{src_app.name}' to '{tgt_app.name}'."
                if not inverted
                else f"Inverted dependency! '{src_app.name}' depends on '{tgt_app.name}', but arrow points in reverse."
            )
            feedbacks.append(
                FeedbackItem(
                    severity=FeedbackSeverity.ERROR,
                    entity_type="Dependency",
                    entity_name=f"{src_app.name} -> {tgt_app.name}",
                    message=msg,
                    points_earned=0.0,
                    points_possible=dep_crit.points,
                )
            )

    # 3. Evaluate Forbidden Dependencies (Anti-Patterns)
    for forb_crit in scenario.forbidden_dependencies:
        for d in graph.dependencies:
            src_app = student_app_map.get(d.source_app_id)
            tgt_app = student_app_map.get(d.target_app_id)
            if src_app and tgt_app:
                if name_matches(src_app.name, forb_crit.source_app) and name_matches(tgt_app.name, forb_crit.target_app):
                    total_score = max(0.0, total_score - forb_crit.penalty)
                    feedbacks.append(
                        FeedbackItem(
                            severity=FeedbackSeverity.ERROR,
                            entity_type="Architecture",
                            entity_name=f"{src_app.name} -> {tgt_app.name}",
                            message=f"Anti-Pattern Violation (-{forb_crit.penalty} pts): {forb_crit.reason}",
                            points_earned=-forb_crit.penalty,
                            points_possible=0.0,
                        )
                    )

    # Ensure max_score > 0
    if max_score <= 0.0:
        max_score = 1.0

    percentage = round(min(1.0, max(0.0, total_score / max_score)), 4)
    passed = percentage >= scenario.passing_score

    # Compute hint
    current_hint = None
    if scenario.hints and 0 <= current_hint_index < len(scenario.hints):
        current_hint = scenario.hints[current_hint_index].text

    attempts_remaining = max(0, scenario.max_attempts - attempts_used)

    return ARMEvaluationResult(
        score=round(total_score, 2),
        max_score=round(max_score, 2),
        percentage=percentage,
        passed=passed,
        feedbacks=feedbacks,
        hints_available=len(scenario.hints),
        current_hint=current_hint,
        attempts_used=attempts_used,
        attempts_remaining=attempts_remaining,
    )

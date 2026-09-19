import type { SceneNode, SceneEdge } from './business-scene';

/** Display families only. Never infer identity, location or scientific confidence. */
export const nodeFamilies = {
  RIVER_REACH: 'water',
  BASIN: 'water',
  PLACE: 'water',
  MONITORING_POINT: 'site',
  ENTERPRISE: 'site',
  DOCUMENT: 'asset',
  POLICY: 'asset',
  EVENT: 'action',
  MODEL_RUN: 'action',
  CLAIM: 'claim',
  PERSON: 'actor',
  ORGANIZATION: 'actor',
  OBSERVATION: 'observation',
  INDICATOR_RECORD: 'observation',
  EXTERNAL_ENTITY: 'other',
} as const satisfies Record<SceneNode['kind'], string>;
export type NodeFamily = (typeof nodeFamilies)[SceneNode['kind']];
export const edgeFamilies = {
  HAS_DECLARED_MONITORING_POINT: 'evidence',
  HAS_REPORTED_INDICATOR: 'evidence',
  FLOWS_TO: 'spatial',
  BELONGS_TO_BASIN: 'spatial',
  CANDIDATE_RECEIVING_WATER: 'spatial',
  IDENTITY_MATCH: 'identity',
  EXPRESSES_CLAIM: 'claim',
  REPORTS_CLAIM: 'claim',
  ABOUT_ENTITY: 'context',
  OBSERVES_ENTITY: 'observation',
  OCCURRED_IN: 'action',
  CITES_SOURCE: 'evidence',
  DERIVED_FROM: 'evidence',
  APPLIES_TO: 'context',
  USES_DATA: 'evidence',
} as const satisfies Record<SceneEdge['row']['candidate']['predicate'], string>;
export type EdgeFamily =
  (typeof edgeFamilies)[SceneEdge['row']['candidate']['predicate']];
export const familyColor = (family: NodeFamily | EdgeFamily) =>
  `var(--scene-${family})`;

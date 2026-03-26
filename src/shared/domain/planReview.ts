export type PlanReviewStatus = 'pending' | 'acted';

export interface PendingPlanReviewRecord {
  id: string;
  status: PlanReviewStatus;
  agentId?: string;
  agentName?: string;
  summary: string;
  planContent: string;
  actions?: string[];
  recommendedAction?: string;
  requestedAt: string;
  actedAt?: string;
}

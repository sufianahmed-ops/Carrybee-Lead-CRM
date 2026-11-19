export type DateMode = 'registration' | 'activity' | 'milestone';

export type FunnelStage = {
  key: string;
  label: string;
  count: number;
  convPrev: number | null; // %
  dropPrev: number | null;
  avgDays: number | null;
  topReason: string | null;
  topReasonCount?: number;
  owners: { owner: string; count: number }[];
};

export type StatusDist = { status: string; count: number; pct: number; trend: number | null; isFinal: boolean };

export type CohortRow = {
  cohort: string; // YYYY-MM-DD
  registered: number;
  contacted: number;
  verified: number;
  qualified: number;
  onboarded: number;
  firstTrip: number;
  activation7: number;
  // % columns
  contactedPct: number;
  verifiedPct: number;
  qualifiedPct: number;
  onboardedPct: number;
  firstTripPct: number;
  activation7Pct: number;
  avgDaysToFirstTrip: number | null;
  mature: boolean;
};

export type LqtIncRow = {
  metric: string;
  lqt: number;
  inc: number;
  lqtPct?: number;
  incPct?: number;
  delta: number;
};

export type ExecRow = {
  id: string;
  name: string;
  team: string;
  assigned: number;
  contacted: number;
  qualified: number;
  onboarded: number;
  firstTrip: number;
  pending: number;
  overdue: number;
  onTimePct: number | null;
  tatAvg: number | null;
  activationRate: number | null;
};

export type AlertItem = {
  kind: 'sla_breach' | 'trip_overdue' | 'handover_backlog' | 'workload' | 'data_quality' | 'target_behind' | 'sync' | 'aging';
  title: string;
  body: string;
  count: number;
  owner?: string;
  severity: 'high' | 'medium' | 'low';
  leadIds?: string[];
};

export type TargetRow = {
  metric: string;
  actual: number;
  target: number;
  achievement: number;
  variance: number;
  prev: number | null;
  trend: 'up' | 'down' | 'flat';
};

export type CommandCenterData = {
  meta: { from: string; to: string; after13nov: boolean; dateMode: DateMode; generatedAt: string; totalLeads: number };
  overview: {
    kpis: TargetRow[];
    totals: { registered: number; contacted: number; verified: number; qualified: number; onboarded: number; firstTrip: number; activation7: number; overallConv: number };
  };
  funnel: FunnelStage[];
  statusDist: StatusDist[];
  cohorts: CohortRow[];
  lqtVsInc: { rows: LqtIncRow[]; lqt: Record<string, number>; inc: Record<string, number> };
  aging: { bucket: string; count: number }[];
  execs: ExecRow[];
  alerts: AlertItem[];
  bottleneck: { stage: string; stuckCount: number } | null;
};

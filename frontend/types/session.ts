import type { AgeGroup, Gender, Grade, MemberRole } from "./home";

export type ParticipantStatus =
  | "ARRIVED" // 정모 참석예정자 (콕 미제출 / 대기 진입 전)
  | "WAITING" // 선수현황 (콕 제출 완료 후 매칭 대기 인원)
  | "RESERVED" // 대기현황에 편성된 인원 (게임 투입 예정)
  | "IN_GAME" // 코트현황 (현재 코트에서 게임 진행 중)
  | "RESTING" // 휴식현황
  | "LEFT"; // 퇴장현황

export type MatchType = "MEN_DOUBLE" | "WOMEN_DOUBLE" | "MIXED_DOUBLE";
export type MatchQueueFilter = "ALL" | MatchType;
export type MatchStatus = "DRAFT" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED";
export type PlayerSortOption = "WAIT_ORDER" | "GAME_COUNT" | "GRADE_ORDER";

export interface SessionPlayer {
  id: number;
  memberId?: number;
  name: string;
  nickname: string;
  isGuest: boolean;
  role: MemberRole;
  gender: Gender;
  grade: Grade;
  ageGroup: AgeGroup;
  injuryLevel: "NONE" | "MILD" | "SEVERE";
  eloScore: number; // 순수 ELO 점수
  cockSubmitted: boolean;
  cockQuantity: number;
  cockSubmittedAt?: string;
  status: ParticipantStatus;
  arrivalOrder: number;
  lastWaitStartedAt: number; // 대기 시작 타임스탬프 (대기순 정렬용)
  totalGameCount: number;
  consecutiveGameCount: number;
  wins: number;
  losses: number;
  leftAt?: string;
}

export interface ConfirmedMatchHistoryEntry {
  matchId: string;
  matchSequence: number; // 세션 내 확정(CONFIRMED) 순번 (1, 2, 3...)
  playerIds: [number, number, number, number]; // 팀메이트·상대팀 구분 없이 함께 뛴 4인 ID
  confirmedAt: string;
  autoConfirmed?: boolean;
}

export interface HardBlockPoolThresholds {
  reduceToOneGameBelow: number; // 기본 12명 미만 시 하드 블록을 2경기 -> 1경기로 축소
  disableBelow: number; // 기본 8명 미만 시 하드 블록 완전 해제 (소프트 페널티만 적용)
}

export interface MatchDecisionLogCandidate {
  rank: number;
  teamANames: [string, string];
  teamBNames: [string, string];
  totalCost: number;
  teamDiff: number;
  groupSpread: number;
  softCoPlayerPenalty: number;
  waitPriorityCost: number;
  partnerBonus: number;
  recentFiveOverlapCount: number;
  selectionProbabilityPct: number;
}

export interface MatchDecisionLogEntry {
  id: string;
  matchId: string;
  createdAt: string;
  createdTimestamp: number;
  expiresAtTimestamp: number; // 90일 보존 만료 타임스탬프
  stageLabel: string;
  randomSeed: number;
  activeEligiblePoolSize: number;
  appliedHardBlockGap: number; // 2 | 1 | 0
  appliedSpreadLimit?: number;
  nearOptimalCandidates: MatchDecisionLogCandidate[];
  selectedSummary: string;
}

export interface MatchGame {
  id: string;
  matchType: MatchType;
  status: MatchStatus;
  origin: "AUTO" | "MANUAL";
  isReservedMatch?: boolean; // 선수현황 3인 이하 시 코트 선투입 인원과 혼합된 예약매칭 여부
  isRelaxedReservation?: boolean; // 조건을 완화하여 생성된 예약매칭 여부 (경고 배지 표시용)
  teamA: [number, number]; // SessionPlayer.id 2명
  teamB: [number, number]; // SessionPlayer.id 2명
  courtNumber?: number;
  createdAt: string;
  startedAt?: string;
  reasonSummary: string; // 매칭 근거 요약 (ELO 밸런스, 게임수 등)
  teamAAvgElo: number;
  teamBAvgElo: number;
  // 자동매칭 우선순위 고도화 메타데이터 (3~7번 명세)
  groupSpread?: number; // 4인 최고~최저 ELO 편차
  avoidConflictsCount?: number; // 기피 충돌 건수
  recentFiveOverlapCount?: number; // 최근 5경기 내 4인 조합의 동반 출전 누적 횟수
  playerRecentOverlapMap?: Record<number, number>; // 선수별 최근 5경기 내 현재 매칭 멤버와 겹친 횟수
  allowedSpreadStep?: number; // 1단계 통과 시 적용된 단계적 확장 허용폭 (200 | 250 | 300 | 350)
  isAutoConfirmEligible?: boolean; // 운영진 부재 시 자동 승인 신뢰도 기준(groupSpread <= 100, avoid 0, 파트너 미충돌) 충족 여부
  autoConfirmExcludeReason?: string; // 자동 승인 제외 사유
  autoConfirmed?: boolean; // 운영진 부재 시 시스템에 의해 자동 승인(CONFIRMED)되었는지 여부
  autoConfirmedAt?: string; // 자동 승인 시각
  decisionLog?: MatchDecisionLogEntry; // 90일 보존용 매칭 결정 로그
}

export interface CourtInfo {
  courtNumber: number;
  isActive: boolean;
  currentMatchId?: string;
  assignedOrder?: number;
}

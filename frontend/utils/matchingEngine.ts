import type { Grade, MemberPreferenceDto } from "@/types/home";
import type {
  ConfirmedMatchHistoryEntry,
  HardBlockPoolThresholds,
  MatchDecisionLogCandidate,
  MatchDecisionLogEntry,
  MatchGame,
  MatchType,
  SessionPlayer,
} from "@/types/session";

const GRADE_ORDER_LIST: Grade[] = ["S", "A", "B", "C", "D", "E", "F", "G"];

/**
 * 1단계 우선 매칭 및 예약매칭 4순위에서 사용하는 단계적 실력 편차(groupSpread) 확장 허용폭
 * - 가장 좁은 200점부터 탐색하고, 후보가 하나도 없을 때만 250 -> 300 -> 350점 순으로 확장
 */
export const STEPWISE_SPREAD_THRESHOLDS = [200, 250, 300, 350] as const;

/**
 * [명세 3번] 대기 풀(대기+휴식 포함 매칭 가능 인원) 전체 인원수에 따른 최근 동반자 하드 블록 동적 완화 기본 임계값
 * - 12명 미만: 하드 블록 기준을 직전 2경기(gap <= 2)에서 직전 1경기(gap <= 1)로 자동 축소
 * - 8명 미만: 하드 블록을 완전 해제(gap <= 0)하고 소프트 페널티만 적용
 */
export const DEFAULT_HARD_BLOCK_THRESHOLDS: HardBlockPoolThresholds = {
  reduceToOneGameBelow: 12,
  disableBelow: 8,
};

/**
 * 매칭 결정 로그 보존 기간: 90일 (밀리초)
 */
export const DECISION_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * 동급수 기준 남성 +2급수 가점 (1급수 = ELO 100점 기준 -> 남성 +200점 가점)
 */
export const MALE_GRADE_BONUS_ELO = 200;

/**
 * 대기 풀(대기+휴식 포함 매칭 가능 인원) 규모에 따라 동적으로 적용할 하드 블록 gap(2 | 1 | 0)을 반환합니다.
 */
export function resolveDynamicHardBlockGap(
  activeEligiblePoolSize: number,
  thresholds: HardBlockPoolThresholds = DEFAULT_HARD_BLOCK_THRESHOLDS
): number {
  if (activeEligiblePoolSize < thresholds.disableBelow) {
    return 0; // 8명 미만: 하드 블록 완전 해제 (소프트 페널티만 적용)
  }
  if (activeEligiblePoolSize < thresholds.reduceToOneGameBelow) {
    return 1; // 12명 미만: 하드 블록 기준을 2경기 -> 1경기로 자동 축소
  }
  return 2; // 12명 이상: 직전 2경기 이내(gap <= 2) 하드 블록
}

/**
 * 화면 표시용 보정 급수 산출 (남성의 경우 본래 급수보다 2단계 상향된 보정 급수 반환, 최대 S)
 */
export function getAdjustedGradeLabel(player: SessionPlayer): string {
  if (player.gender !== "MALE") {
    return `${player.grade}조`;
  }
  const idx = GRADE_ORDER_LIST.indexOf(player.grade);
  if (idx === -1) return `${player.grade}조`;
  const boostedIdx = Math.max(0, idx - 2);
  const boostedGrade = GRADE_ORDER_LIST[boostedIdx];
  return `${player.grade}조→보정${boostedGrade}조`;
}

/**
 * 매칭 밸런스 계산용 ELO 점수
 * - 기본 ELO(급수 기준 + 당일 승패 변동) + 남성 동급수 대비 2급수 가점(+200점)
 * - 부상 정도(MILD -50, SEVERE -120) 반영
 */
export function getEffectiveMatchingElo(player: SessionPlayer): number {
  const maleBonus = player.gender === "MALE" ? MALE_GRADE_BONUS_ELO : 0;
  const injuryPenalty =
    player.injuryLevel === "SEVERE"
      ? -120
      : player.injuryLevel === "MILD"
        ? -50
        : 0;

  return Math.round(player.eloScore + maleBonus + injuryPenalty);
}

/**
 * 4명의 성별 구성으로 매칭 종목(남복/여복/혼복) 판별
 */
export function detectMatchType(players: SessionPlayer[]): MatchType {
  const femaleCount = players.filter((p) => p.gender === "FEMALE").length;
  if (femaleCount === 0) return "MEN_DOUBLE";
  if (femaleCount === 4) return "WOMEN_DOUBLE";
  return "MIXED_DOUBLE";
}

/**
 * 4명의 성별 조합이 정식 복식(남4 / 여4 / 남2+여2)으로 유효한지 판별 (3:1 성별 불균형 조합 배제)
 */
export function isBalancedGenderQuartet(players: SessionPlayer[]): boolean {
  const femaleCount = players.filter((p) => p.gender === "FEMALE").length;
  return femaleCount === 0 || femaleCount === 2 || femaleCount === 4;
}

/**
 * ELO 승패 변동폭 계산 (K-factor = 32 기본)
 */
export function calculateEloDelta(
  teamAElo: number,
  teamBElo: number,
  winningTeam: "A" | "B",
  kFactor = 32
): { deltaA: number; deltaB: number } {
  const expectedA = 1 / (1 + Math.pow(10, (teamBElo - teamAElo) / 400));
  const actualA = winningTeam === "A" ? 1 : 0;
  const deltaA = Math.round(kFactor * (actualA - expectedA));
  return {
    deltaA,
    deltaB: -deltaA,
  };
}

/**
 * 두 선수가 서로(또는 일방이) 희망 파트너로 지정했는지 판별
 * - 두 선수 사이에 기피 설정이 있으면 무조건 false 반환
 * - matchType이 주어졌을 때:
 *   - 남복/여복(MEN_DOUBLE / WOMEN_DOUBLE)에서는 동성 희망 파트너(sameGenderPartnerId)만 유효
 *   - 혼복(MIXED_DOUBLE)에서는 이성 희망 파트너(mixedPartnerId)만 유효
 */
export function isPreferredPartnerPair(
  a: SessionPlayer,
  b: SessionPlayer,
  preferencesMap?: Record<number, MemberPreferenceDto>,
  matchType?: MatchType
): boolean {
  if (!preferencesMap) return false;
  if (hasAvoidConflict(a, b, preferencesMap)) return false;

  const aMemberId = a.memberId ?? a.id;
  const bMemberId = b.memberId ?? b.id;
  const prefA = preferencesMap[aMemberId];
  const prefB = preferencesMap[bMemberId];

  const isSameGender = a.gender === b.gender;

  if (matchType === "MIXED_DOUBLE" && isSameGender) {
    return false;
  }
  if (
    (matchType === "MEN_DOUBLE" || matchType === "WOMEN_DOUBLE") &&
    !isSameGender
  ) {
    return false;
  }

  if (isSameGender) {
    return (
      prefA?.sameGenderPartnerId === bMemberId ||
      prefB?.sameGenderPartnerId === aMemberId
    );
  }
  return (
    prefA?.mixedPartnerId === bMemberId ||
    prefB?.mixedPartnerId === aMemberId
  );
}

/**
 * 4인 그룹 내에 기피 관계가 1건이라도 존재하는지 판별하는 헬퍼
 * - 기피 인원 회피는 어떤 완화 단계에서도 절대 깨지지 않는 최후의 안전선으로 유지
 */
export function hasAnyAvoidInGroup(
  players: SessionPlayer[],
  preferencesMap?: Record<number, MemberPreferenceDto>
): boolean {
  if (!preferencesMap) return false;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      if (hasAvoidConflict(players[i], players[j], preferencesMap)) {
        return true;
      }
    }
  }
  return false;
}

export function hasAvoidConflict(
  a: SessionPlayer,
  b: SessionPlayer,
  preferencesMap?: Record<number, MemberPreferenceDto>
): boolean {
  if (!preferencesMap) return false;
  const aMemberId = a.memberId ?? a.id;
  const bMemberId = b.memberId ?? b.id;
  const prefA = preferencesMap[aMemberId];
  const prefB = preferencesMap[bMemberId];

  return (
    Boolean(prefA?.avoidMemberIds?.includes(bMemberId)) ||
    Boolean(prefB?.avoidMemberIds?.includes(aMemberId))
  );
}

/**
 * [명세 3번 & 6번] 최근 동반자 추적 매트릭스 평가 (확정 기준값 반영)
 * - 남복·여복·혼복 종목 구분 없이 세션 전체에서 하나의 매트릭스를 공유
 * - gap(두 사람이 마지막으로 함께 뛴 경기와 현재 매칭 시점 사이의 경기 수 차이) 기준:
 *   - 동일한 두 사람이 세션 중 여러 번 만났더라도 **가장 최근 만남만**을 기준으로 계산 (과거 만남 누적 가중 없음)
 *   - 직전 hardBlockMaxGap 경기 이내(기본 gap <= 2, 12명 미만 시 gap <= 1, 8명 미만 시 0): 하드 블록 대상
 *   - 직전 3~5경기 이내(3 <= gap <= 5): gap=3일 때 400점, gap=4일 때 300점, gap=5일 때 200점의 소프트 페널티 부과
 *   - (하드 블록이 완화되거나 2단계/예약매칭 완화에서 하드 블록이 소프트 페널티로 격하될 때도 gap 기준 소프트 페널티 반영)
 */
export interface CoPlayerEvaluationResult {
  hardBlockCount: number; // 현재 동적 하드 블록 기준(gap <= hardBlockMaxGap)에 걸린 쌍 건수
  softPenaltyScore: number; // 1단계/예약매칭 기본 소프트 페널티 (gap=3 -> 400, gap=4 -> 300, gap=5 -> 200 + 동적 완화 시 gap=1,2 소프트 점수)
  downgradedSoftPenaltyScore: number; // 2단계 폴백 및 예약매칭 완화 단계용 소프트 페널티 (하드 블록을 소프트 페널티로 격하)
  recentFiveOverlapCount: number; // 최근 5경기 내 이 4인 조합에서 겹친 총 동반 경기 수 (6번 운영진 보조 지표)
  playerRecentOverlapMap: Record<number, number>; // 각 선수별 최근 5경기 내 현재 4인 중 누군가와 함께 뛴 횟수
  mostRecentPairGapSum: number; // 생소함 가중치 산출용
}

export function evaluateCoPlayerHistory(
  fourPlayers: SessionPlayer[],
  matchHistory: ConfirmedMatchHistoryEntry[] = [],
  hardBlockMaxGap = 2
): CoPlayerEvaluationResult {
  const playerRecentOverlapMap: Record<number, number> = {};
  fourPlayers.forEach((p) => {
    playerRecentOverlapMap[p.id] = 0;
  });

  if (!matchHistory || matchHistory.length === 0) {
    return {
      hardBlockCount: 0,
      softPenaltyScore: 0,
      downgradedSoftPenaltyScore: 0,
      recentFiveOverlapCount: 0,
      playerRecentOverlapMap,
      mostRecentPairGapSum: 0,
    };
  }

  const totalConfirmed = matchHistory.length;
  let hardBlockCount = 0;
  let softPenaltyScore = 0;
  let downgradedSoftPenaltyScore = 0;
  let mostRecentPairGapSum = 0;

  // [명세 6번] 최근 5경기 내 이 조합과 몇 번 함께 뛰었는지 집계
  const recentFiveHistory = matchHistory.slice(-5);
  let recentFiveOverlapCount = 0;

  for (const entry of recentFiveHistory) {
    const matchedInEntry = fourPlayers.filter((p) =>
      entry.playerIds.includes(p.id)
    );
    if (matchedInEntry.length >= 2) {
      recentFiveOverlapCount++;
      matchedInEntry.forEach((p) => {
        playerRecentOverlapMap[p.id] =
          (playerRecentOverlapMap[p.id] ?? 0) + 1;
      });
    }
  }

  // 4인 내 모든 2인 쌍(6쌍)에 대해 "가장 최근 만남(gap)" 단 하나만 기준으로 계산 (과거 만남 누적 가중 없음)
  for (let a = 0; a < fourPlayers.length; a++) {
    for (let b = a + 1; b < fourPlayers.length; b++) {
      const idA = fourPlayers[a].id;
      const idB = fourPlayers[b].id;

      for (let hIdx = matchHistory.length - 1; hIdx >= 0; hIdx--) {
        const entry = matchHistory[hIdx];
        if (
          entry.playerIds.includes(idA) &&
          entry.playerIds.includes(idB)
        ) {
          const gap = totalConfirmed - hIdx; // 직전 1경기 = 1, 직전 2경기 = 2, 직전 3경기 = 3...
          mostRecentPairGapSum += Math.max(0, 6 - Math.min(6, gap));

          // 1) 동적 하드 블록 판별 (gap <= hardBlockMaxGap)
          if (hardBlockMaxGap > 0 && gap <= hardBlockMaxGap) {
            hardBlockCount++;
          }

          // 2) 확정 소프트 페널티 기준값: gap=3 -> 400점, gap=4 -> 300점, gap=5 -> 200점
          let pairSoftPenalty = 0;
          if (gap === 3) {
            pairSoftPenalty = 400;
          } else if (gap === 4) {
            pairSoftPenalty = 300;
          } else if (gap === 5) {
            pairSoftPenalty = 200;
          } else if (gap <= 2 && gap > hardBlockMaxGap) {
            // 인원수 동적 완화로 인해 하드 블록이 1경기 또는 0경기로 축소된 경우, 해제된 gap=1,2에 소프트 페널티 적용
            pairSoftPenalty = gap === 1 ? 500 : 450;
          }

          softPenaltyScore += pairSoftPenalty;

          // 3) 2단계 폴백 및 예약매칭 조건 완화 시(하드 블록을 소프트 페널티로 격하했을 때) 점수
          if (gap === 3) {
            downgradedSoftPenaltyScore += 400;
          } else if (gap === 4) {
            downgradedSoftPenaltyScore += 300;
          } else if (gap === 5) {
            downgradedSoftPenaltyScore += 200;
          } else if (gap === 2) {
            downgradedSoftPenaltyScore += 450;
          } else if (gap === 1) {
            downgradedSoftPenaltyScore += 500;
          }

          // 가장 최근 만남만 반영하고 이전 만남은 누적하지 않음
          break;
        }
      }
    }
  }

  return {
    hardBlockCount,
    softPenaltyScore,
    downgradedSoftPenaltyScore,
    recentFiveOverlapCount,
    playerRecentOverlapMap,
    mostRecentPairGapSum,
  };
}

/**
 * 4명의 선수를 받아 A팀(최강 + 최약) vs B팀(중간1 + 중간2) 구도로 분할하여
 * 파트너 간 개인 실력 차이는 나더라도 A팀 vs B팀의 '팀 단위 평균 ELO 편차'가 최소가 되도록 배정합니다.
 */
export function splitFourIntoHighLowBalancedTeams(
  fourPlayers: SessionPlayer[],
  preferencesMap?: Record<number, MemberPreferenceDto>
): {
  teamA: [SessionPlayer, SessionPlayer];
  teamB: [SessionPlayer, SessionPlayer];
  teamDiff: number;
} {
  const matchType = detectMatchType(fourPlayers);
  const scoreFn = (p: SessionPlayer) =>
    matchType === "MIXED_DOUBLE"
      ? getEffectiveMatchingElo(p)
      : Math.round(p.eloScore);

  // 1) 희망 파트너가 4인 안에 존재하면 해당 파트너 쌍을 같은 팀으로 우선 묶음
  if (preferencesMap) {
    const allPairs: Array<
      [[SessionPlayer, SessionPlayer], [SessionPlayer, SessionPlayer]]
    > = [
      [
        [fourPlayers[0], fourPlayers[1]],
        [fourPlayers[2], fourPlayers[3]],
      ],
      [
        [fourPlayers[0], fourPlayers[2]],
        [fourPlayers[1], fourPlayers[3]],
      ],
      [
        [fourPlayers[0], fourPlayers[3]],
        [fourPlayers[1], fourPlayers[2]],
      ],
    ];

    for (const [tA, tB] of allPairs) {
      const isMixedFour =
        matchType === "MIXED_DOUBLE" && isBalancedGenderQuartet(fourPlayers);
      if (
        isMixedFour &&
        (tA[0].gender === tA[1].gender || tB[0].gender === tB[1].gender)
      ) {
        continue;
      }
      if (
        isPreferredPartnerPair(tA[0], tA[1], preferencesMap, matchType) ||
        isPreferredPartnerPair(tB[0], tB[1], preferencesMap, matchType)
      ) {
        const avgA = Math.round((scoreFn(tA[0]) + scoreFn(tA[1])) / 2);
        const avgB = Math.round((scoreFn(tB[0]) + scoreFn(tB[1])) / 2);
        return { teamA: tA, teamB: tB, teamDiff: Math.abs(avgA - avgB) };
      }
    }
  }

  // 2) 4명을 실력(ELO) 내림차순 정렬: 1위(최강) >= 2위(중간1) >= 3위(중간2) >= 4위(최약)
  const sorted = [...fourPlayers].sort((a, b) => scoreFn(b) - scoreFn(a));

  const highLowTeamA: [SessionPlayer, SessionPlayer] = [sorted[0], sorted[3]];
  const highLowTeamB: [SessionPlayer, SessionPlayer] = [sorted[1], sorted[2]];
  const highLowAvgA = Math.round(
    (scoreFn(highLowTeamA[0]) + scoreFn(highLowTeamA[1])) / 2
  );
  const highLowAvgB = Math.round(
    (scoreFn(highLowTeamB[0]) + scoreFn(highLowTeamB[1])) / 2
  );
  const highLowDiff = Math.abs(highLowAvgA - highLowAvgB);

  const males = sorted.filter((p) => p.gender === "MALE");
  const females = sorted.filter((p) => p.gender === "FEMALE");

  if (males.length === 2 && females.length === 2) {
    // 혼복 [강한 남 + 약한 여] vs [약한 남 + 강한 여]와 비교해 팀 평균 편차가 더 작은 쪽 선택
    const mixedTeamA: [SessionPlayer, SessionPlayer] = [males[0], females[1]];
    const mixedTeamB: [SessionPlayer, SessionPlayer] = [males[1], females[0]];
    const mixedAvgA = Math.round(
      (scoreFn(mixedTeamA[0]) + scoreFn(mixedTeamA[1])) / 2
    );
    const mixedAvgB = Math.round(
      (scoreFn(mixedTeamB[0]) + scoreFn(mixedTeamB[1])) / 2
    );
    const mixedDiff = Math.abs(mixedAvgA - mixedAvgB);

    if (mixedDiff <= highLowDiff) {
      return { teamA: mixedTeamA, teamB: mixedTeamB, teamDiff: mixedDiff };
    }
  }

  return {
    teamA: highLowTeamA,
    teamB: highLowTeamB,
    teamDiff: highLowDiff,
  };
}

/**
 * [명세 7번] 운영진 공백 시 자동 승인(Auto-Confirm) 신뢰도 기준 검증
 * - groupSpread <= 100 && avoidConflicts === 0인 제안만 해당
 * - 애매한 조합(실력 편차가 크거나 희망 파트너 조건이 애매하게 걸치는 경우)은 자동 승인 대상에서 제외
 */
function evaluateAutoConfirmReliability(
  teamA: [SessionPlayer, SessionPlayer],
  teamB: [SessionPlayer, SessionPlayer],
  groupSpread: number,
  avoidConflicts: number,
  hardBlockCoPlayerCount: number,
  preferencesMap?: Record<number, MemberPreferenceDto>,
  waitingPool: SessionPlayer[] = []
): { eligible: boolean; excludeReason?: string } {
  if (avoidConflicts > 0) {
    return {
      eligible: false,
      excludeReason: "매칭 조건 추가 확인 필요 (운영진 검토 대기)",
    };
  }
  if (hardBlockCoPlayerCount > 0) {
    return {
      eligible: false,
      excludeReason: "직전 동반 출전 하드 블록 조건 검토 필요 (운영진 확인 대기)",
    };
  }
  if (groupSpread > 100) {
    return {
      eligible: false,
      excludeReason: `4인 실력 편차(${groupSpread}점)가 자동 승인 신뢰 기준(100점 이내) 초과`,
    };
  }

  if (preferencesMap && waitingPool.length > 0) {
    const allFour = [...teamA, ...teamB];
    const fourMemberIds = new Set(allFour.map((p) => p.memberId ?? p.id));
    const waitingMemberIds = new Set(
      waitingPool.map((p) => p.memberId ?? p.id)
    );

    for (const p of allFour) {
      const mId = p.memberId ?? p.id;
      const pref = preferencesMap[mId];
      if (!pref) continue;

      const candidatePartners = [
        pref.sameGenderPartnerId,
        pref.mixedPartnerId,
      ].filter((id): id is number => typeof id === "number");

      for (const partnerId of candidatePartners) {
        if (waitingMemberIds.has(partnerId) && !fourMemberIds.has(partnerId)) {
          return {
            eligible: false,
            excludeReason:
              "희망 파트너 조건 검토 필요 (대기 중 파트너 분리 · 운영진 확인 대기)",
          };
        }
      }
    }
  }

  return { eligible: true };
}

/**
 * 4인 팀 분할 결과로 MatchGame 객체 생성
 */
function buildMatchGameFromTeams(
  teamAPlayers: [SessionPlayer, SessionPlayer],
  teamBPlayers: [SessionPlayer, SessionPlayer],
  summaryPrefix: string,
  preferencesMap?: Record<number, MemberPreferenceDto>,
  existingId?: string,
  isReservedMatch = false,
  matchHistory: ConfirmedMatchHistoryEntry[] = [],
  allowedSpreadStep?: number,
  waitingPool: SessionPlayer[] = [],
  hardBlockMaxGap = 2,
  isRelaxedReservation = false,
  decisionLog?: MatchDecisionLogEntry
): MatchGame {
  const allFour = [...teamAPlayers, ...teamBPlayers];
  const matchType = detectMatchType(allFour);
  const isMixed = matchType === "MIXED_DOUBLE";

  const getScoreForType = (p: SessionPlayer) =>
    isMixed ? getEffectiveMatchingElo(p) : Math.round(p.eloScore);

  const elos = allFour.map(getScoreForType);
  const groupSpread = Math.max(...elos) - Math.min(...elos);

  let avoidConflictsCount = 0;
  for (let a = 0; a < 4; a++) {
    for (let b = a + 1; b < 4; b++) {
      if (hasAvoidConflict(allFour[a], allFour[b], preferencesMap)) {
        avoidConflictsCount++;
      }
    }
  }

  const coPlayerEval = evaluateCoPlayerHistory(
    allFour,
    matchHistory,
    hardBlockMaxGap
  );
  const autoConfirmCheck = evaluateAutoConfirmReliability(
    teamAPlayers,
    teamBPlayers,
    groupSpread,
    avoidConflictsCount,
    coPlayerEval.hardBlockCount,
    preferencesMap,
    waitingPool
  );

  const teamAAvgElo = Math.round(
    (getScoreForType(teamAPlayers[0]) + getScoreForType(teamAPlayers[1])) / 2
  );
  const teamBAvgElo = Math.round(
    (getScoreForType(teamBPlayers[0]) + getScoreForType(teamBPlayers[1])) / 2
  );

  const hasPartnerMatched =
    isPreferredPartnerPair(
      teamAPlayers[0],
      teamAPlayers[1],
      preferencesMap,
      matchType
    ) ||
    isPreferredPartnerPair(
      teamBPlayers[0],
      teamBPlayers[1],
      preferencesMap,
      matchType
    );

  // 누가 누구를 희망했는지 이름은 노출하지 않고 '희망파트너 반영'만 표시
  const partnerSummary = hasPartnerMatched ? "🤝 희망파트너 반영 · " : "";

  const diff = Math.abs(teamAAvgElo - teamBAvgElo);
  const balanceSummary = isMixed
    ? `${summaryPrefix} | 팀 보정 ELO 편차 ${diff}점`
    : `${summaryPrefix} | 팀 ELO 편차 ${diff}점`;

  const matchId = existingId || `match-${Date.now()}`;

  return {
    id: matchId,
    matchType,
    status: "DRAFT",
    origin: "AUTO",
    isReservedMatch,
    isRelaxedReservation,
    teamA: [teamAPlayers[0].id, teamAPlayers[1].id],
    teamB: [teamBPlayers[0].id, teamBPlayers[1].id],
    createdAt: new Date().toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    reasonSummary: `${partnerSummary}${balanceSummary}`,
    teamAAvgElo,
    teamBAvgElo,
    groupSpread,
    avoidConflictsCount,
    recentFiveOverlapCount: coPlayerEval.recentFiveOverlapCount,
    playerRecentOverlapMap: coPlayerEval.playerRecentOverlapMap,
    allowedSpreadStep,
    isAutoConfirmEligible: autoConfirmCheck.eligible,
    autoConfirmExcludeReason: autoConfirmCheck.excludeReason,
    decisionLog: decisionLog ? { ...decisionLog, matchId } : undefined,
  };
}

interface CandidateMatchItem {
  teamA: [SessionPlayer, SessionPlayer];
  teamB: [SessionPlayer, SessionPlayer];
  groupSig: string;
  isStrictPriority: boolean;
  allowedSpreadStep?: number;
  cost: number;
  teamDiff: number;
  groupSpread: number;
  softCoPlayerPenalty: number;
  waitPriorityCost: number;
  partnerBonus: number;
  recentFiveOverlapCount: number;
  mostRecentPairGapSum: number;
}

/**
 * [명세 4번] 최저 비용 대비 상위 10% 이내에 속하는 근접 후보군 중에서
 * 최근 동반자 매트릭스상 더 생소한 조합일수록 선택 확률이 높아지는 가중 무작위 샘플링 수행 및
 * 90일 보존용 매칭 결정 로그(랜덤 시드, 상위 후보군 목록 및 비용값, 최종 선택 조합) 생성
 */
function sampleTopTenPercentWithDecisionLog(
  sortedCandidates: CandidateMatchItem[],
  stageLabel: string,
  activeEligiblePoolSize: number,
  appliedHardBlockGap: number,
  appliedSpreadLimit?: number
): {
  chosen: CandidateMatchItem;
  decisionLog: MatchDecisionLogEntry;
} {
  const minCost = sortedCandidates[0].cost;
  // 최저 비용 대비 상위 10% 이내 근접 후보군 추출 (음수 비용일 때도 10% 폭 또는 최소 20점 범위 적용)
  const toleranceBand = Math.max(20, Math.abs(minCost) * 0.1);
  const nearOptimalPool = sortedCandidates
    .filter((c) => c.cost <= minCost + toleranceBand)
    .slice(0, 10);

  // 최근 동반자 매트릭스상 더 생소한 조합일수록 가중치 상승
  const rawWeights = nearOptimalPool.map((c) => {
    const noveltyWeight =
      1 /
      (1 +
        c.recentFiveOverlapCount * 2.5 +
        c.mostRecentPairGapSum * 0.8 +
        c.softCoPlayerPenalty / 200);
    return Math.max(0.05, noveltyWeight);
  });

  const totalWeight = rawWeights.reduce((acc, w) => acc + w, 0);

  // 기록 가능한 정수 랜덤 시드 생성
  const randomSeed = Math.floor(100000 + Math.random() * 900000);
  const pseudoRand = ((randomSeed * 9301 + 49297) % 233280) / 233280;
  let target = pseudoRand * totalWeight;
  let chosenIdx = 0;

  for (let i = 0; i < nearOptimalPool.length; i++) {
    target -= rawWeights[i];
    if (target <= 0) {
      chosenIdx = i;
      break;
    }
  }

  const chosen = nearOptimalPool[chosenIdx] ?? sortedCandidates[0];
  const nowTs = Date.now();
  const nowStr = new Date(nowTs).toLocaleString("ko-KR");

  const logCandidates: MatchDecisionLogCandidate[] = nearOptimalPool.map(
    (c, idx) => ({
      rank: idx + 1,
      teamANames: [c.teamA[0].name, c.teamA[1].name],
      teamBNames: [c.teamB[0].name, c.teamB[1].name],
      totalCost: Math.round(c.cost),
      teamDiff: c.teamDiff,
      groupSpread: c.groupSpread,
      softCoPlayerPenalty: c.softCoPlayerPenalty,
      waitPriorityCost: c.waitPriorityCost,
      partnerBonus: c.partnerBonus,
      recentFiveOverlapCount: c.recentFiveOverlapCount,
      selectionProbabilityPct:
        totalWeight > 0
          ? Math.round((rawWeights[idx] / totalWeight) * 1000) / 10
          : 100,
    })
  );

  const decisionLog: MatchDecisionLogEntry = {
    id: `dlog-${nowTs}-${randomSeed}`,
    matchId: "",
    createdAt: nowStr,
    createdTimestamp: nowTs,
    expiresAtTimestamp: nowTs + DECISION_LOG_RETENTION_MS,
    stageLabel,
    randomSeed,
    activeEligiblePoolSize,
    appliedHardBlockGap,
    appliedSpreadLimit,
    nearOptimalCandidates: logCandidates,
    selectedSummary: `A팀(${chosen.teamA[0].name}·${chosen.teamA[1].name}) vs B팀(${chosen.teamB[0].name}·${chosen.teamB[1].name}) [총 비용 ${Math.round(
      chosen.cost
    )}점]`,
  };

  return { chosen, decisionLog };
}

/**
 * 공통 2단계 매칭 후보 생성기 ('⚡ 자동매칭'과 '🔄 멤버 바꾸기' 두 버튼 모두 동일하게 사용)
 * - [1단계] 우선 매칭 알고리즘 (단계적 확장 구조: 200점 -> 250점 -> 300점 -> 350점):
 *   1) 기피 인원 충돌 0건 (avoidConflicts === 0, 고정 조건)
 *   2) 선택한 종목 필터 일치 (고정 조건)
 *   3) 3번 항목 기준의 최근 동반자 하드 블록 (대기+휴식 인원수 동적 완화 적용, 고정 조건)
 *   4) 4인 개인 간 실력 편차(groupSpread)가 허용 범위(200 -> 250 -> 300 -> 350점) 이내
 * - 1단계 비용 함수 확정값:
 *   - 희망 파트너 매칭: -1,500점
 *   - 최근 동반자 소프트 페널티: gap=3/4/5일 때 각각 +400점/+300점/+200점
 *   - A팀 vs B팀 평균 ELO 편차(teamDiff): 1점당 1점
 *   - 4인 개인 간 ELO 편차(groupSpread): 1점당 1점
 *   - 대기순·적은 경기 수 우선순위(waitPriorityCost): 대기 순번 1칸당 10점
 * - [2단계] 팀 밸런스 강제 매칭 폴백 (A팀[최강+최약] vs B팀[중간+중간]):
 *   1단계가 모든 확장 단계(200~350점)에서도 후보를 찾지 못했을 때 작동
 */
function collectRankedMatchCandidates(
  availablePlayers: SessionPlayer[],
  preferredType: MatchType | "ALL" = "ALL",
  preferencesMap?: Record<number, MemberPreferenceDto>,
  matchHistory: ConfirmedMatchHistoryEntry[] = [],
  activeEligiblePoolSize?: number,
  thresholds: HardBlockPoolThresholds = DEFAULT_HARD_BLOCK_THRESHOLDS
): {
  strictCandidates: CandidateMatchItem[];
  fallbackBalancedCandidates: CandidateMatchItem[];
  appliedSpreadThreshold?: number;
  appliedHardBlockGap: number;
  effectivePoolSize: number;
} {
  const effectivePoolSize = activeEligiblePoolSize ?? availablePlayers.length;
  const appliedHardBlockGap = resolveDynamicHardBlockGap(
    effectivePoolSize,
    thresholds
  );

  // 1. 선수현황 후보 풀 정렬 우선순위:
  // (1순위) 연속 2게임 이상 후순위 -> (2순위) 누적 경기 수 오름차순 -> (3순위) 대기 시작 시각 오름차순
  const sortedByWait = [...availablePlayers].sort((a, b) => {
    const aConsecutivePenalty = a.consecutiveGameCount >= 2 ? 1 : 0;
    const bConsecutivePenalty = b.consecutiveGameCount >= 2 ? 1 : 0;
    if (aConsecutivePenalty !== bConsecutivePenalty) {
      return aConsecutivePenalty - bConsecutivePenalty;
    }
    if (a.totalGameCount !== b.totalGameCount) {
      return a.totalGameCount - b.totalGameCount;
    }
    return a.lastWaitStartedAt - b.lastWaitStartedAt;
  });

  let pool: SessionPlayer[] = [];
  if (preferredType === "MEN_DOUBLE") {
    const males = sortedByWait.filter((p) => p.gender === "MALE");
    pool = males.length >= 4 ? males.slice(0, 16) : sortedByWait.slice(0, 16);
  } else if (preferredType === "WOMEN_DOUBLE") {
    const females = sortedByWait.filter((p) => p.gender === "FEMALE");
    pool =
      females.length >= 4 ? females.slice(0, 16) : sortedByWait.slice(0, 16);
  } else if (preferredType === "MIXED_DOUBLE") {
    const males = sortedByWait.filter((p) => p.gender === "MALE");
    const females = sortedByWait.filter((p) => p.gender === "FEMALE");
    if (males.length >= 2 && females.length >= 2) {
      pool = [...males.slice(0, 8), ...females.slice(0, 8)];
    } else {
      pool = sortedByWait.slice(0, 16);
    }
  } else {
    pool = sortedByWait.slice(0, 16);
  }

  interface RawEvaluatedQuartet {
    teamA: [SessionPlayer, SessionPlayer];
    teamB: [SessionPlayer, SessionPlayer];
    groupSig: string;
    matchesTypeFilter: boolean;
    isBalancedGender: boolean;
    avoidConflicts: number;
    partnerMatches: number;
    teamDiff: number;
    groupSpread: number;
    waitPriorityCost: number;
    coPlayerEval: CoPlayerEvaluationResult;
  }

  const allQuartets: RawEvaluatedQuartet[] = [];

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      for (let k = j + 1; k < pool.length; k++) {
        for (let l = k + 1; l < pool.length; l++) {
          const group = [pool[i], pool[j], pool[k], pool[l]];
          const detectedType = detectMatchType(group);
          const isBalancedGender = isBalancedGenderQuartet(group);
          const matchesTypeFilter =
            (preferredType === "ALL" || detectedType === preferredType) &&
            isBalancedGender;

          let avoidConflicts = 0;
          let partnerMatches = 0;
          for (let a = 0; a < 4; a++) {
            for (let b = a + 1; b < 4; b++) {
              if (hasAvoidConflict(group[a], group[b], preferencesMap)) {
                avoidConflicts++;
              }
              if (
                isPreferredPartnerPair(
                  group[a],
                  group[b],
                  preferencesMap,
                  detectedType
                )
              ) {
                partnerMatches++;
              }
            }
          }

          // 기피 인원이 포함된 조합은 1단계와 2단계 모두 대기현황에 절대 잡히지 않도록 하드 제외
          if (avoidConflicts > 0) {
            continue;
          }

          const { teamA, teamB, teamDiff } = splitFourIntoHighLowBalancedTeams(
            group,
            preferencesMap
          );

          const scoreFn = (p: SessionPlayer) =>
            detectedType === "MIXED_DOUBLE"
              ? getEffectiveMatchingElo(p)
              : Math.round(p.eloScore);
          const elos = group.map(scoreFn);
          const groupSpread = Math.max(...elos) - Math.min(...elos);

          const groupSig = group
            .map((p) => p.id)
            .sort((a, b) => a - b)
            .join(",");

          // 대기 순번 1칸당 10점 환산
          const waitPriorityCost = (i + j + k + l) * 10;
          const coPlayerEval = evaluateCoPlayerHistory(
            group,
            matchHistory,
            appliedHardBlockGap
          );

          allQuartets.push({
            teamA,
            teamB,
            groupSig,
            matchesTypeFilter,
            isBalancedGender,
            avoidConflicts,
            partnerMatches,
            teamDiff,
            groupSpread,
            waitPriorityCost,
            coPlayerEval,
          });
        }
      }
    }
  }

  // [1단계] 고정 3조건(기피 0, 종목 일치, 동적 최근 동반자 하드블록 0)을 유지한 채
  // 실력 편차(groupSpread) 허용폭만 200 -> 250 -> 300 -> 350점 순으로 단계적 확장
  const strictCandidates: CandidateMatchItem[] = [];
  let appliedSpreadThreshold: number | undefined;

  for (const spreadLimit of STEPWISE_SPREAD_THRESHOLDS) {
    const matchingAtLimit = allQuartets.filter(
      (q) =>
        q.matchesTypeFilter &&
        q.avoidConflicts === 0 &&
        q.coPlayerEval.hardBlockCount === 0 &&
        q.groupSpread <= spreadLimit
    );

    if (matchingAtLimit.length > 0) {
      appliedSpreadThreshold = spreadLimit;
      for (const q of matchingAtLimit) {
        const partnerBonus = -q.partnerMatches * 1500;
        // 1단계 확정 비용 함수:
        // 희망 파트너(-1,500점) + 최근 동반자 소프트 페널티(400/300/200점) + teamDiff(1:1) + groupSpread(1:1) + waitPriorityCost(1칸당 10점)
        const cost =
          partnerBonus +
          q.coPlayerEval.softPenaltyScore +
          q.teamDiff +
          q.groupSpread +
          q.waitPriorityCost;

        strictCandidates.push({
          teamA: q.teamA,
          teamB: q.teamB,
          groupSig: q.groupSig,
          isStrictPriority: true,
          allowedSpreadStep: spreadLimit,
          teamDiff: q.teamDiff,
          groupSpread: q.groupSpread,
          softCoPlayerPenalty: q.coPlayerEval.softPenaltyScore,
          waitPriorityCost: q.waitPriorityCost,
          partnerBonus,
          cost,
          recentFiveOverlapCount: q.coPlayerEval.recentFiveOverlapCount,
          mostRecentPairGapSum: q.coPlayerEval.mostRecentPairGapSum,
        });
      }
      break;
    }
  }

  // [2단계] 팀 밸런스 강제 매칭 폴백 (A팀[최강+최약] vs B팀[중간+중간]):
  // 하드 블록은 해제하고 소프트 페널티만 반영, teamDiff가 0점에 가까운 순 + 대기순(1칸당 10점)
  const strictSigSet = new Set(strictCandidates.map((c) => c.groupSig));
  const fallbackBalancedCandidates: CandidateMatchItem[] = [];

  for (const q of allQuartets) {
    if (strictSigSet.has(q.groupSig)) continue;

    const typePenalty = q.matchesTypeFilter
      ? 0
      : q.isBalancedGender
        ? 3000
        : 6000;
    const partnerBonus = -q.partnerMatches * 1500;

    // 2단계 비용 함수:
    // 기피 인원 회피(avoidConflicts * 50,000) + 최근 동반자 소프트 페널티(gap=3/4/5 -> 400/300/200점 등) + 희망 파트너(-1,500점) + teamDiff 최소화 + 대기순(1칸당 10점)
    const cost =
      q.avoidConflicts * 50000 +
      q.coPlayerEval.downgradedSoftPenaltyScore +
      typePenalty +
      partnerBonus +
      q.teamDiff * 10 +
      q.waitPriorityCost;

    fallbackBalancedCandidates.push({
      teamA: q.teamA,
      teamB: q.teamB,
      groupSig: q.groupSig,
      isStrictPriority: false,
      teamDiff: q.teamDiff,
      groupSpread: q.groupSpread,
      softCoPlayerPenalty: q.coPlayerEval.downgradedSoftPenaltyScore,
      waitPriorityCost: q.waitPriorityCost,
      partnerBonus,
      cost,
      recentFiveOverlapCount: q.coPlayerEval.recentFiveOverlapCount,
      mostRecentPairGapSum: q.coPlayerEval.mostRecentPairGapSum,
    });
  }

  strictCandidates.sort((a, b) => a.cost - b.cost);
  fallbackBalancedCandidates.sort((a, b) => a.cost - b.cost);

  return {
    strictCandidates,
    fallbackBalancedCandidates,
    appliedSpreadThreshold,
    appliedHardBlockGap,
    effectivePoolSize,
  };
}

/**
 * '⚡ 자동매칭' 버튼 실행 함수
 */
export function generateAutoMatchDraft(
  waitingPlayers: SessionPlayer[],
  preferredType: MatchType | "ALL" = "ALL",
  preferencesMap?: Record<number, MemberPreferenceDto>,
  stepIndex = 0,
  matchHistory: ConfirmedMatchHistoryEntry[] = [],
  activeEligiblePoolSize?: number,
  thresholds: HardBlockPoolThresholds = DEFAULT_HARD_BLOCK_THRESHOLDS
): MatchGame | null {
  if (waitingPlayers.length < 4) {
    return null;
  }

  const {
    strictCandidates,
    fallbackBalancedCandidates,
    appliedSpreadThreshold,
    appliedHardBlockGap,
    effectivePoolSize,
  } = collectRankedMatchCandidates(
    waitingPlayers,
    preferredType,
    preferencesMap,
    matchHistory,
    activeEligiblePoolSize,
    thresholds
  );

  // stepIndex === 0 (최초 자동매칭 클릭 시): 1단계 통과 후보가 있으면 최저 비용 대비 상위 10% 이내 근접 후보군 가중 무작위 샘플링 + 결정 로그 생성
  if (stepIndex === 0 && strictCandidates.length > 0) {
    const stepText =
      appliedSpreadThreshold && appliedSpreadThreshold > 200
        ? ` (허용폭 ${appliedSpreadThreshold}점 확장)`
        : " (허용폭 200점 이내)";
    const stageLabel = `대기순·동급 밸런스 1단계 우선 매칭${stepText}`;

    const { chosen, decisionLog } = sampleTopTenPercentWithDecisionLog(
      strictCandidates,
      stageLabel,
      effectivePoolSize,
      appliedHardBlockGap,
      appliedSpreadThreshold
    );

    return buildMatchGameFromTeams(
      chosen.teamA,
      chosen.teamB,
      stageLabel,
      preferencesMap,
      undefined,
      false,
      matchHistory,
      chosen.allowedSpreadStep,
      waitingPlayers,
      appliedHardBlockGap,
      false,
      decisionLog
    );
  }

  const combinedQueue = [...strictCandidates, ...fallbackBalancedCandidates];

  if (combinedQueue.length === 0) {
    return null;
  }

  const chosen = combinedQueue[stepIndex % combinedQueue.length];
  const label = chosen.isStrictPriority
    ? `대기순·동급 밸런스 1단계 우선 매칭 (허용폭 ${chosen.allowedSpreadStep ?? 200}점)`
    : "⚖️ 2단계 A팀(최강+최약) vs B팀(중간+중간) 팀 밸런스 폴백 매칭";

  const { decisionLog } = sampleTopTenPercentWithDecisionLog(
    [chosen],
    label,
    effectivePoolSize,
    appliedHardBlockGap,
    chosen.allowedSpreadStep
  );

  return buildMatchGameFromTeams(
    chosen.teamA,
    chosen.teamB,
    label,
    preferencesMap,
    undefined,
    false,
    matchHistory,
    chosen.allowedSpreadStep,
    waitingPlayers,
    appliedHardBlockGap,
    false,
    decisionLog
  );
}

/**
 * '🔄 멤버 바꾸기' 버튼 실행 함수
 */
export function rematchByEloRanking(
  availablePool: SessionPlayer[],
  currentMatch: MatchGame,
  preferredType: MatchType | "ALL",
  variationStep: number,
  preferencesMap?: Record<number, MemberPreferenceDto>,
  matchHistory: ConfirmedMatchHistoryEntry[] = [],
  activeEligiblePoolSize?: number,
  thresholds: HardBlockPoolThresholds = DEFAULT_HARD_BLOCK_THRESHOLDS
): MatchGame | null {
  if (availablePool.length < 4) {
    return null;
  }

  const currentGroupSignature = [...currentMatch.teamA, ...currentMatch.teamB]
    .sort((a, b) => a - b)
    .join(",");

  const {
    strictCandidates,
    fallbackBalancedCandidates,
    appliedHardBlockGap,
    effectivePoolSize,
  } = collectRankedMatchCandidates(
    availablePool,
    preferredType,
    preferencesMap,
    matchHistory,
    activeEligiblePoolSize,
    thresholds
  );

  const strictDifferent = strictCandidates.filter(
    (c) => c.groupSig !== currentGroupSignature
  );
  const fallbackDifferent = fallbackBalancedCandidates.filter(
    (c) => c.groupSig !== currentGroupSignature
  );

  const orderedPool =
    strictDifferent.length > 0 || fallbackDifferent.length > 0
      ? [...strictDifferent, ...fallbackDifferent]
      : [...strictCandidates, ...fallbackBalancedCandidates];

  if (orderedPool.length === 0) {
    return null;
  }

  const chosen = orderedPool[(variationStep - 1) % orderedPool.length];
  const label = chosen.isStrictPriority
    ? `ELO 동급 1단계 우선 재매칭 (허용폭 ${chosen.allowedSpreadStep ?? 200}점)`
    : "⚖️ 2단계 A팀(최강+최약) vs B팀(중간+중간) 팀 밸런스 재매칭";

  const { decisionLog } = sampleTopTenPercentWithDecisionLog(
    orderedPool.slice(0, 10),
    label,
    effectivePoolSize,
    appliedHardBlockGap,
    chosen.allowedSpreadStep
  );

  return buildMatchGameFromTeams(
    chosen.teamA,
    chosen.teamB,
    label,
    preferencesMap,
    currentMatch.id,
    Boolean(currentMatch.isReservedMatch),
    matchHistory,
    chosen.allowedSpreadStep,
    availablePool,
    appliedHardBlockGap,
    Boolean(currentMatch.isRelaxedReservation),
    decisionLog
  );
}

/**
 * [명세 5번] 예약매칭 생성기 (선수현황 대기 인원이 1~3명이고 코트에 진행 중인 경기가 있을 때 작동)
 * - 선수현황 대기 인원(1~3명) 전원 100% 필수 투입(fixedWaiting) + 부족한 (4 - 대기인원수)명만 코트현황에서 충원
 * - 코트 충원 1~7순위:
 *   1순위: 기피 인원 회피 (avoidConflicts === 0, 어떤 완화 단계에서도 절대 깨지지 않는 최후의 안전선)
 *   2순위: 성별 조합 유효성 (남4·여4·남2+여2 정상 성립 우선, 3:1 성별 불균형 배제)
 *   3순위: 최근 동반자 회피 (동적 완화 규칙 포함 gap <= 2 하드 블록 제외, 3 <= gap <= 5일 때 400/300/200점 소프트 페널티)
 *   4순위: 동급 밸런스(groupSpread: 200 -> 250 -> 300 -> 350점 단계적 확장 적용) 및 희망 파트너 가점(-1,500점)
 *   5순위: 코트 먼저 투입된 순번 (투입 순번 차이 1단계당 10점씩 부과하되 최대 50점 상한 Cap)
 *   6순위: 누적 경기 수 적은 순 및 연속 2게임 미만 우선
 *   7순위: A팀(최강+최약) vs B팀(중간+중간) 팀 평균 ELO 편차(teamDiff) 최소화
 * - 유효 조합이 하나도 나오지 않을 때의 3단계 조건 완화:
 *   1) 4순위(groupSpread)를 200->250->300->350점까지 단계적으로 완화하며 재탐색
 *   2) 그래도 없으면 3순위(최근 동반자 회피)의 하드 블록을 소프트 페널티로 격하시켜 재탐색
 *   3) 그래도 없으면 1순위(기피 인원 회피)와 2순위(성별 조합 유효성)만 최소 안전장치로 유지한 채 예약매칭을 강제 생성하고,
 *      카드에 "조건을 완화하여 생성된 예약매칭입니다" 경고 배지(isRelaxedReservation: true) 표시
 */
export function generateReservationMatchDraft(
  waitingPlayers: SessionPlayer[],
  courtOrderedPlayers: SessionPlayer[],
  preferredType: MatchType | "ALL" = "ALL",
  preferencesMap?: Record<number, MemberPreferenceDto>,
  stepIndex = 0,
  existingId?: string,
  matchHistory: ConfirmedMatchHistoryEntry[] = [],
  activeEligiblePoolSize?: number,
  thresholds: HardBlockPoolThresholds = DEFAULT_HARD_BLOCK_THRESHOLDS
): MatchGame | null {
  const fixedWaiting = waitingPlayers.slice(0, 4);
  const fixedIds = new Set(fixedWaiting.map((p) => p.id));
  const neededFromCourt = 4 - fixedWaiting.length;

  const courtPool = courtOrderedPlayers.filter((p) => !fixedIds.has(p.id));

  if (fixedWaiting.length + courtPool.length < 4) {
    return null;
  }

  // 대기 인원 자체에 이미 기피 충돌이 있으면 매칭 불가
  if (hasAnyAvoidInGroup(fixedWaiting, preferencesMap)) {
    return null;
  }

  const effectivePoolSize =
    activeEligiblePoolSize ?? waitingPlayers.length + courtPool.length;
  const appliedHardBlockGap = resolveDynamicHardBlockGap(
    effectivePoolSize,
    thresholds
  );

  if (neededFromCourt <= 0) {
    const { teamA, teamB } = splitFourIntoHighLowBalancedTeams(
      fixedWaiting,
      preferencesMap
    );
    return buildMatchGameFromTeams(
      teamA,
      teamB,
      "📌 예약매칭",
      preferencesMap,
      existingId,
      true,
      matchHistory,
      undefined,
      waitingPlayers,
      appliedHardBlockGap,
      false
    );
  }

  const limitedCourtPool = courtPool.slice(0, 16);

  interface RawReservationCandidate {
    teamA: [SessionPlayer, SessionPlayer];
    teamB: [SessionPlayer, SessionPlayer];
    groupSig: string;
    isValidGenderCombo: boolean;
    matchesTypeFilter: boolean;
    coPlayerEval: CoPlayerEvaluationResult;
    groupSpread: number;
    partnerMatches: number;
    courtRankCost: number; // 투입 순번 차이 1단계당 10점, 최대 50점 상한
    gameCountCost: number;
    teamDiff: number;
  }

  const rawList: RawReservationCandidate[] = [];

  const collectGroup = (group: SessionPlayer[], courtRankDiffSteps: number) => {
    // 1순위: 기피 인원 회피 (절대 깨지지 않는 최후의 안전선)
    if (hasAnyAvoidInGroup(group, preferencesMap)) {
      return;
    }

    const detectedType = detectMatchType(group);
    const isValidGenderCombo = isBalancedGenderQuartet(group);
    const matchesTypeFilter =
      (preferredType === "ALL" || detectedType === preferredType) &&
      isValidGenderCombo;

    let partnerMatches = 0;
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        if (
          isPreferredPartnerPair(
            group[a],
            group[b],
            preferencesMap,
            detectedType
          )
        ) {
          partnerMatches++;
        }
      }
    }

    const { teamA, teamB, teamDiff } = splitFourIntoHighLowBalancedTeams(
      group,
      preferencesMap
    );

    const scoreFn = (p: SessionPlayer) =>
      detectedType === "MIXED_DOUBLE"
        ? getEffectiveMatchingElo(p)
        : Math.round(p.eloScore);
    const elos = group.map(scoreFn);
    const groupSpread = Math.max(...elos) - Math.min(...elos);

    const coPlayerEval = evaluateCoPlayerHistory(
      group,
      matchHistory,
      appliedHardBlockGap
    );

    // 5순위 코트 투입 순번 비용: 투입 순번 차이 1단계당 10점씩 부과하되 최대 50점에서 상한(Cap) 적용
    const courtRankCost = Math.min(50, courtRankDiffSteps * 10);

    // 6순위 누적 경기 수 적은 순 및 연속 2게임 미만 우선
    const gameCountCost = group.reduce(
      (acc, cur) =>
        acc +
        cur.totalGameCount * 15 +
        (cur.consecutiveGameCount >= 2 ? 80 : 0),
      0
    );

    const groupSig = group
      .map((p) => p.id)
      .sort((a, b) => a - b)
      .join(",");

    rawList.push({
      teamA,
      teamB,
      groupSig,
      isValidGenderCombo,
      matchesTypeFilter,
      coPlayerEval,
      groupSpread,
      partnerMatches,
      courtRankCost,
      gameCountCost,
      teamDiff,
    });
  };

  if (neededFromCourt === 1) {
    for (let i = 0; i < limitedCourtPool.length; i++) {
      collectGroup([...fixedWaiting, limitedCourtPool[i]], Math.floor(i / 4));
    }
  } else if (neededFromCourt === 2) {
    for (let i = 0; i < limitedCourtPool.length; i++) {
      for (let j = i + 1; j < limitedCourtPool.length; j++) {
        collectGroup(
          [...fixedWaiting, limitedCourtPool[i], limitedCourtPool[j]],
          Math.floor(i / 4) + Math.floor(j / 4)
        );
      }
    }
  } else if (neededFromCourt === 3) {
    for (let i = 0; i < limitedCourtPool.length; i++) {
      for (let j = i + 1; j < limitedCourtPool.length; j++) {
        for (let k = j + 1; k < limitedCourtPool.length; k++) {
          collectGroup(
            [
              ...fixedWaiting,
              limitedCourtPool[i],
              limitedCourtPool[j],
              limitedCourtPool[k],
            ],
            Math.floor(i / 4) + Math.floor(j / 4) + Math.floor(k / 4)
          );
        }
      }
    }
  } else {
    for (let i = 0; i < limitedCourtPool.length; i++) {
      for (let j = i + 1; j < limitedCourtPool.length; j++) {
        for (let k = j + 1; k < limitedCourtPool.length; k++) {
          for (let l = k + 1; l < limitedCourtPool.length; l++) {
            collectGroup(
              [
                limitedCourtPool[i],
                limitedCourtPool[j],
                limitedCourtPool[k],
                limitedCourtPool[l],
              ],
              Math.floor(i / 4) +
                Math.floor(j / 4) +
                Math.floor(k / 4) +
                Math.floor(l / 4)
            );
          }
        }
      }
    }
  }

  if (rawList.length === 0) {
    return null;
  }

  interface RankedReservationItem {
    teamA: [SessionPlayer, SessionPlayer];
    teamB: [SessionPlayer, SessionPlayer];
    groupSig: string;
    allowedSpreadStep?: number;
    isRelaxedReservation: boolean;
    stageDescription: string;
    cost: number;
  }

  const computeReservationCost = (
    r: RawReservationCandidate,
    useDowngradedCoPlayerPenalty: boolean
  ) => {
    const coPenalty = useDowngradedCoPlayerPenalty
      ? r.coPlayerEval.downgradedSoftPenaltyScore
      : r.coPlayerEval.softPenaltyScore;

    // 희망 파트너(-1,500점) + 최근 동반자 소프트 페널티(400/300/200점) + groupSpread(1:1) + 코트 투입 순번(최대 50점 상한) + 경기 수 + teamDiff(1:1)
    return (
      -r.partnerMatches * 1500 +
      coPenalty +
      r.groupSpread +
      r.courtRankCost +
      r.gameCountCost +
      r.teamDiff
    );
  };

  // [완화 1단계] 1순위(기피 0) + 2순위(성별 조합 유효) + 3순위(최근 동반자 하드블록 0)을 유지한 채
  // 4순위(groupSpread)를 200 -> 250 -> 300 -> 350점까지 단계적으로 확장하며 탐색
  const stage1Pool: RankedReservationItem[] = [];
  for (const spreadStep of STEPWISE_SPREAD_THRESHOLDS) {
    const matched = rawList.filter(
      (r) =>
        r.matchesTypeFilter &&
        r.coPlayerEval.hardBlockCount === 0 &&
        r.groupSpread <= spreadStep
    );
    if (matched.length > 0) {
      for (const r of matched) {
        stage1Pool.push({
          teamA: r.teamA,
          teamB: r.teamB,
          groupSig: r.groupSig,
          allowedSpreadStep: spreadStep,
          isRelaxedReservation: false,
          stageDescription: `📌 예약매칭 (대기 ${fixedWaiting.length}명 전원 + 코트 ${neededFromCourt}명 · 허용폭 ${spreadStep}점 동급 밸런스)`,
          cost: computeReservationCost(r, false),
        });
      }
      break;
    }
  }

  // [완화 2단계] 1단계(200~350점)에서 조합이 없으면, 3순위(최근 동반자 회피)의 하드 블록을 소프트 페널티로 격하시켜 재탐색
  const stage2Pool: RankedReservationItem[] = [];
  if (stage1Pool.length === 0) {
    for (const spreadStep of STEPWISE_SPREAD_THRESHOLDS) {
      const matched = rawList.filter(
        (r) => r.matchesTypeFilter && r.groupSpread <= spreadStep
      );
      if (matched.length > 0) {
        for (const r of matched) {
          stage2Pool.push({
            teamA: r.teamA,
            teamB: r.teamB,
            groupSig: r.groupSig,
            allowedSpreadStep: spreadStep,
            isRelaxedReservation: false,
            stageDescription: `📌 예약매칭 (대기 ${fixedWaiting.length}명 전원 + 코트 ${neededFromCourt}명 · 동반자 하드블록 완화)`,
            cost: computeReservationCost(r, true),
          });
        }
        break;
      }
    }
  }

  // [완화 3단계] 위 두 단계 완화로도 끝내 조합이 나오지 않으면,
  // 1순위(기피 인원 회피)와 2순위(성별 조합 유효성)만 최소 안전장치로 유지한 채 예약매칭 강제 생성
  // -> "조건을 완화하여 생성된 예약매칭입니다" 경고 배지(isRelaxedReservation: true) 필수 표시
  const stage3ForcedPool: RankedReservationItem[] = [];
  const validGenderOnly = rawList.filter((r) => r.isValidGenderCombo);
  const poolForStage3 = validGenderOnly.length > 0 ? validGenderOnly : rawList;

  for (const r of poolForStage3) {
    const typeFilterPenalty = r.matchesTypeFilter ? 0 : 1000;
    stage3ForcedPool.push({
      teamA: r.teamA,
      teamB: r.teamB,
      groupSig: r.groupSig,
      isRelaxedReservation: true,
      stageDescription: `📌 예약매칭 (대기 ${fixedWaiting.length}명 전원 + 코트 ${neededFromCourt}명 · A팀[최강+최약] vs B팀[중간+중간])`,
      cost: computeReservationCost(r, true) + typeFilterPenalty,
    });
  }

  stage1Pool.sort((a, b) => a.cost - b.cost);
  stage2Pool.sort((a, b) => a.cost - b.cost);
  stage3ForcedPool.sort((a, b) => a.cost - b.cost);

  const primaryPool =
    stage1Pool.length > 0
      ? stage1Pool
      : stage2Pool.length > 0
        ? stage2Pool
        : stage3ForcedPool;

  // '멤버 바꾸기' 순환을 위해 중복 시그니처 없이 전체 우선순위 큐 구성
  const seenSigs = new Set<string>();
  const combinedCandidates: RankedReservationItem[] = [];
  for (const item of [...stage1Pool, ...stage2Pool, ...stage3ForcedPool]) {
    if (!seenSigs.has(item.groupSig)) {
      seenSigs.add(item.groupSig);
      combinedCandidates.push(item);
    }
  }

  if (combinedCandidates.length === 0) {
    return null;
  }

  const chosen =
    stepIndex === 0
      ? primaryPool[0]
      : combinedCandidates[stepIndex % combinedCandidates.length];

  return buildMatchGameFromTeams(
    chosen.teamA,
    chosen.teamB,
    chosen.stageDescription,
    preferencesMap,
    existingId,
    true,
    matchHistory,
    chosen.allowedSpreadStep,
    waitingPlayers,
    appliedHardBlockGap,
    chosen.isRelaxedReservation
  );
}

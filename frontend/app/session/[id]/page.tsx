"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { GenderBadge } from "@/components/common/GenderBadge";
import { Modal } from "@/components/common/Modal";
import { PlayerBlock } from "@/components/common/PlayerBlock";
import { ProfileSection } from "@/components/features/home/ProfileSection";
import {
  GRADE_BASE_ELO,
  GRADE_SORT_ORDER,
  getAvatarGradientByGender,
} from "@/data/membersData";
import type {
  AgeGroup,
  Gender,
  Grade,
  MeetupScheduleDto,
  MemberDto,
  MemberPreferenceDto,
} from "@/types/home";
import type {
  ConfirmedMatchHistoryEntry,
  CourtInfo,
  HardBlockPoolThresholds,
  MatchDecisionLogEntry,
  MatchGame,
  MatchQueueFilter,
  PlayerSortOption,
  SessionPlayer,
} from "@/types/session";
import {
  calculateEloDelta,
  DEFAULT_HARD_BLOCK_THRESHOLDS,
  detectMatchType,
  evaluateCoPlayerHistory,
  generateAutoMatchDraft,
  generateReservationMatchDraft,
  getAdjustedGradeLabel,
  getEffectiveMatchingElo,
  hasAnyAvoidInGroup,
  hasAvoidConflict,
  rematchByEloRanking,
  resolveDynamicHardBlockGap,
} from "@/utils/matchingEngine";

const DESIGNATED_SHUTTLECOCKS = [
  {
    name: "삼화더블랙",
    tag: "기본 지정콕",
    desc: "내구성과 비행 안정성이 우수한 메인 지정구",
  },
  {
    name: "삼화900",
    tag: "지정콕",
    desc: "정모 호환 제출 가능 지정구",
  },
  {
    name: "KBB79",
    tag: "지정콕",
    desc: "정모 호환 제출 가능 지정구",
  },
  {
    name: "보본365",
    tag: "지정콕",
    desc: "정모 호환 제출 가능 지정구",
  },
  {
    name: "닉텐블랙",
    tag: "지정콕",
    desc: "정모 호환 제출 가능 지정구",
  },
] as const;

const MATCH_TYPE_LABEL: Record<MatchGame["matchType"], string> = {
  MEN_DOUBLE: "남복",
  WOMEN_DOUBLE: "여복",
  MIXED_DOUBLE: "혼복",
};

function buildCourtsFromMeetup(meetup: MeetupScheduleDto): CourtInfo[] {
  const totalCount = Math.max(1, meetup.availableCourtCount || 6);
  const plannedSet = new Set(
    meetup.plannedCourts && meetup.plannedCourts.length > 0
      ? meetup.plannedCourts
      : [1, 2, 3, 4]
  );

  return Array.from({ length: totalCount }, (_, idx) => {
    const courtNumber = idx + 1;
    return {
      courtNumber,
      isActive: plannedSet.has(courtNumber),
    };
  });
}

function createInitialSessionPlayers(meetup: MeetupScheduleDto): SessionPlayer[] {
  const baseTime = Date.now() - 3600 * 1000;

  return (meetup.guests || []).map((guest, gIdx) => ({
    id: guest.id < 1_000_000_000 ? 1_000_000_000 + guest.id : guest.id,
    name: guest.name,
    nickname: guest.name,
    isGuest: true,
    role: "MEMBER",
    gender: guest.gender,
    grade: guest.grade,
    ageGroup: guest.ageGroup,
    injuryLevel: "NONE",
    eloScore: GRADE_BASE_ELO[guest.grade],
    cockSubmitted: false,
    cockQuantity: 0,
    status: "ARRIVED",
    arrivalOrder: gIdx + 1,
    lastWaitStartedAt: baseTime + gIdx * 60000,
    totalGameCount: 0,
    consecutiveGameCount: 0,
    wins: 0,
    losses: 0,
  }));
}

function resolveInitialMeetup(meetupId: number): MeetupScheduleDto {
  if (typeof window !== "undefined") {
    try {
      const listSaved = sessionStorage.getItem("dailyminton_meetups");
      if (listSaved) {
        const list = JSON.parse(listSaved) as MeetupScheduleDto[];
        const found = list.find((m) => m.id === meetupId);
        if (found) return found;
      }

      const directSaved = sessionStorage.getItem(
        `dailyminton_meetup_${meetupId}`
      );
      if (directSaved) {
        return JSON.parse(directSaved) as MeetupScheduleDto;
      }
    } catch {
      // ignore
    }
  }
  return {
    id: meetupId,
    title: "정모 경기 진행",
    badgeDay: "",
    badgeTime: "",
    dateTimeText: "",
    location: "체육관",
    feeText: "입장료 무료",
    currentParticipants: 0,
    maxParticipants: 16,
    participantIds: [],
    guests: [],
    availableCourtCount: 6,
    plannedCourts: [1, 2, 3, 4],
    participantAvatars: [],
    thumbnailTheme: "gymWindow",
  };
}

function SessionMatchContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const meetupId = Number(params?.id || 1);

  const [dbMeetup, setDbMeetup] = useState<MeetupScheduleDto | null>(null);

  // DB 정모 정보 -> URL 쿼리 파라미터 -> sessionStorage -> 기본 시드 순으로 정모 및 코트 설정 해석
  const meetup = useMemo<MeetupScheduleDto>(() => {
    const base = dbMeetup ?? resolveInitialMeetup(meetupId);
    const qTitle = searchParams.get("title");
    const qDate = searchParams.get("date");
    const qLocation = searchParams.get("location");
    const qFee = searchParams.get("fee");
    const qAvailable = searchParams.get("available");
    const qPlanned = searchParams.get("planned");
    const qParticipants = searchParams.get("participants");

    const availableCourtCount = dbMeetup
      ? dbMeetup.availableCourtCount || 6
      : qAvailable
        ? Math.max(1, Number(qAvailable))
        : base.availableCourtCount || 6;

    const plannedCourts = dbMeetup
      ? dbMeetup.plannedCourts || [1, 2, 3, 4]
      : qPlanned !== null
        ? qPlanned
          .split(",")
          .map((s) => Number(s.trim()))
          .filter(
            (n) => Number.isInteger(n) && n >= 1 && n <= availableCourtCount
          )
        : base.plannedCourts || [1, 2, 3, 4];

    const participantIds = dbMeetup
      ? dbMeetup.participantIds
      : qParticipants !== null && qParticipants.trim().length > 0
        ? qParticipants
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n > 0)
        : base.participantIds;

    return {
      ...base,
      title: dbMeetup?.title || qTitle || base.title,
      dateTimeText: dbMeetup?.dateTimeText || qDate || base.dateTimeText,
      location: dbMeetup?.location || qLocation || base.location,
      feeText: dbMeetup?.feeText || qFee || base.feeText,
      availableCourtCount,
      plannedCourts,
      participantIds,
    };
  }, [dbMeetup, meetupId, searchParams]);

  const [players, setPlayers] = useState<SessionPlayer[]>(() =>
    createInitialSessionPlayers(meetup)
  );
  const [clubMembers, setClubMembers] = useState<MemberDto[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean>(
    () => searchParams.get("role") !== "member"
  );

  // 경기 진행 화면 안에서 운영진이 수동으로 개별 코트 활성/비활성을 토글한 내역
  const [courtActiveOverrides, setCourtActiveOverrides] = useState<
    Record<number, boolean>
  >({});
  // 코트 번호 -> 현재 배정된 경기 정보
  const [courtAssignmentMap, setCourtAssignmentMap] = useState<
    Record<number, { currentMatchId: string; assignedOrder: number }>
  >({});

  // 정모의 사용가능코트 / 사용예정코트 설정과 실시간 오버라이드를 결합해 코트 목록 산출
  const courts = useMemo<CourtInfo[]>(() => {
    const baseCourts = buildCourtsFromMeetup(meetup);
    return baseCourts.map((c) => {
      const isOverridden = Object.prototype.hasOwnProperty.call(
        courtActiveOverrides,
        c.courtNumber
      );
      const assignment = courtAssignmentMap[c.courtNumber];
      return {
        courtNumber: c.courtNumber,
        isActive: isOverridden ? courtActiveOverrides[c.courtNumber] : c.isActive,
        currentMatchId: assignment?.currentMatchId,
        assignedOrder: assignment?.assignedOrder,
      };
    });
  }, [meetup, courtActiveOverrides, courtAssignmentMap]);

  // PostgreSQL(dailyminton/Supabase DB)에서 전체 회원과 정모 참가자·게스트 명단을 동시에 로드하여 Race Condition 없이 동기화
  useEffect(() => {
    let isMounted = true;

    Promise.all([
      fetch("/api/members", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
      fetch(`/api/meetups?id=${meetupId}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
    ]).then(
      ([membersData, meetupRes]: [
        MemberDto[] | null,
        { source?: string; meetups?: MeetupScheduleDto[] } | null,
      ]) => {
        if (!isMounted) return;

        const dbMembers = Array.isArray(membersData) ? membersData : [];
        if (dbMembers.length > 0) {
          setClubMembers(dbMembers);
        }
        const dbMemberMap = new Map<number, MemberDto>();
        dbMembers.forEach((m) => dbMemberMap.set(m.id, m));

        const loadedMeetup =
          meetupRes?.source === "db" &&
            Array.isArray(meetupRes.meetups) &&
            meetupRes.meetups.length > 0
            ? meetupRes.meetups[0]
            : null;

        if (loadedMeetup) {
          setDbMeetup(loadedMeetup);
        }

        let cachedEloMap: Record<string, number> = {};
        try {
          const rawElo = localStorage.getItem("dailyminton_member_elos");
          if (rawElo) {
            cachedEloMap = JSON.parse(rawElo) as Record<string, number>;
          }
        } catch {
          // ignore
        }

        const effectiveParticipantIds = loadedMeetup
          ? loadedMeetup.participantIds || []
          : meetup.participantIds || [];
        const effectiveGuests = loadedMeetup
          ? loadedMeetup.guests || []
          : meetup.guests || [];

        setPlayers((prev) => {
          const hasActiveProgress = prev.some(
            (p) =>
              p.cockSubmitted ||
              p.status !== "ARRIVED" ||
              p.totalGameCount > 0
          );

          if (!hasActiveProgress) {
            const baseTime = Date.now() - 3600 * 1000;
            const syncedMembers: SessionPlayer[] = effectiveParticipantIds
              .map((pid) => dbMemberMap.get(pid))
              .filter((m): m is MemberDto => m !== undefined)
              .map((m, idx) => ({
                id: m.id,
                memberId: m.id,
                name: m.name,
                nickname: m.nickname,
                isGuest: false,
                role: m.role,
                gender: m.gender,
                grade: m.grade,
                ageGroup: m.ageGroup,
                injuryLevel: m.injuryLevel ?? "NONE",
                eloScore:
                  m.eloScore ??
                  cachedEloMap[String(m.id)] ??
                  GRADE_BASE_ELO[m.grade],
                cockSubmitted: false,
                cockQuantity: 0,
                status: "ARRIVED",
                arrivalOrder: idx + 1,
                lastWaitStartedAt: baseTime + idx * 60000,
                totalGameCount: 0,
                consecutiveGameCount: 0,
                wins: 0,
                losses: 0,
              }));

            const syncedGuests: SessionPlayer[] = effectiveGuests.map(
              (g, gIdx) => ({
                id: g.id < 1_000_000_000 ? 1_000_000_000 + g.id : g.id,
                name: g.name,
                nickname: g.name,
                isGuest: true,
                role: "MEMBER",
                gender: g.gender,
                grade: g.grade,
                ageGroup: g.ageGroup,
                injuryLevel: "NONE",
                eloScore: GRADE_BASE_ELO[g.grade],
                cockSubmitted: false,
                cockQuantity: 0,
                status: "ARRIVED",
                arrivalOrder: syncedMembers.length + gIdx + 1,
                lastWaitStartedAt:
                  baseTime + (syncedMembers.length + gIdx) * 60000,
                totalGameCount: 0,
                consecutiveGameCount: 0,
                wins: 0,
                losses: 0,
              })
            );

            return [...syncedMembers, ...syncedGuests];
          }

          // 이미 경기 진행 중이면 기존 선수 정보 최신화 + 누락된 회원/게스트만 추가
          const updated = prev.map((p) => {
            if (!p.memberId) return p;
            const synced = dbMemberMap.get(p.memberId);
            if (!synced) return p;
            const isPreGame =
              p.totalGameCount === 0 && p.wins === 0 && p.losses === 0;
            return {
              ...p,
              name: synced.name,
              nickname: synced.nickname,
              role: synced.role,
              gender: synced.gender,
              grade: synced.grade,
              ageGroup: synced.ageGroup,
              injuryLevel: synced.injuryLevel ?? p.injuryLevel,
              eloScore: isPreGame
                ? (synced.eloScore ??
                  cachedEloMap[String(p.memberId)] ??
                  p.eloScore)
                : p.eloScore,
            };
          });

          const existingIds = new Set(
            updated.filter((p) => !p.isGuest && p.memberId).map((p) => p.memberId!)
          );
          const existingGuestNames = new Set(
            updated.filter((p) => p.isGuest).map((p) => p.name)
          );
          const additions: SessionPlayer[] = [];

          effectiveParticipantIds.forEach((pid) => {
            if (existingIds.has(pid)) return;
            const m = dbMemberMap.get(pid);
            if (!m) return;
            additions.push({
              id: m.id,
              memberId: m.id,
              name: m.name,
              nickname: m.nickname,
              isGuest: false,
              role: m.role,
              gender: m.gender,
              grade: m.grade,
              ageGroup: m.ageGroup,
              injuryLevel: "NONE",
              eloScore:
                m.eloScore ??
                cachedEloMap[String(m.id)] ??
                GRADE_BASE_ELO[m.grade],
              cockSubmitted: false,
              cockQuantity: 0,
              status: "ARRIVED",
              arrivalOrder: updated.length + additions.length + 1,
              lastWaitStartedAt: Date.now(),
              totalGameCount: 0,
              consecutiveGameCount: 0,
              wins: 0,
              losses: 0,
            });
          });

          effectiveGuests.forEach((g) => {
            if (existingGuestNames.has(g.name)) return;
            additions.push({
              id: g.id < 1_000_000_000 ? 1_000_000_000 + g.id : g.id,
              name: g.name,
              nickname: g.name,
              isGuest: true,
              role: "MEMBER",
              gender: g.gender,
              grade: g.grade,
              ageGroup: g.ageGroup,
              injuryLevel: "NONE",
              eloScore: GRADE_BASE_ELO[g.grade],
              cockSubmitted: false,
              cockQuantity: 0,
              status: "ARRIVED",
              arrivalOrder: updated.length + additions.length + 1,
              lastWaitStartedAt: Date.now(),
              totalGameCount: 0,
              consecutiveGameCount: 0,
              wins: 0,
              losses: 0,
            });
          });

          return additions.length > 0 ? [...updated, ...additions] : updated;
        });
      }
    );

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetupId]);

  const [draftMatch, setDraftMatch] = useState<MatchGame | null>(null);
  const [dismissedAutoReservationSig, setDismissedAutoReservationSig] =
    useState<string | null>(null);
  const [rematchStep, setRematchStep] = useState<number>(0);
  const [waitingMatches, setWaitingMatches] = useState<MatchGame[]>([]);
  const [activeCourtMatches, setActiveCourtMatches] = useState<MatchGame[]>([]);

  // [명세 3번] 최근 동반자 추적 매트릭스: 세션 전체 확정(CONFIRMED) 경기 이력
  const [confirmedMatchHistory, setConfirmedMatchHistory] = useState<
    ConfirmedMatchHistoryEntry[]
  >([]);

  // [명세 7번] 운영진 공백 시 자동 승인(Auto-Confirm) 45초 카운트다운 상태 및 2초 비관적 락 상태
  const [autoConfirmTimerState, setAutoConfirmTimerState] = useState<{
    draftId: string;
    remainingSec: number;
  }>({ draftId: "", remainingSec: 45 });
  const [pessimisticLockedDraftId, setPessimisticLockedDraftId] = useState<
    string | null
  >(null);

  // [명세 3번] 대기 풀(대기+휴식) 인원수에 따른 최근 동반자 하드 블록 동적 완화 임계값 (기본 12명, 8명)
  const [hardBlockThresholds, setHardBlockThresholds] =
    useState<HardBlockPoolThresholds>(DEFAULT_HARD_BLOCK_THRESHOLDS);

  // [명세 4번] 90일 보존용 매칭 결정 로그(랜덤 시드, 상위 후보군 및 비용값, 최종 선택 조합)
  const [decisionLogs, setDecisionLogs] = useState<MatchDecisionLogEntry[]>(
    () => {
      if (typeof window !== "undefined") {
        try {
          const saved = localStorage.getItem("dailyminton_match_decision_logs");
          if (saved) {
            const parsed = JSON.parse(saved) as MatchDecisionLogEntry[];
            const nowTs = Date.now();
            return Array.isArray(parsed)
              ? parsed.filter((entry) => entry.expiresAtTimestamp > nowTs)
              : [];
          }
        } catch {
          // ignore
        }
      }
      return [];
    }
  );
  const [isDecisionLogModalOpen, setIsDecisionLogModalOpen] = useState(false);

  // 선수현황 검색 및 정렬 상태
  const [playerSearch, setPlayerSearch] = useState("");
  const [playerSort, setPlayerSort] = useState<PlayerSortOption>("WAIT_ORDER");
  const [queueFilter, setQueueFilter] = useState<MatchQueueFilter>("ALL");

  // 수동 매칭용 선택된 선수 ID (최대 4명)
  const [manualSelectedIds, setManualSelectedIds] = useState<number[]>([]);

  // 멤버 바꾸기 모달 상태
  const [swapTarget, setSwapTarget] = useState<{
    matchId: string;
    isDraft: boolean;
    oldPlayerId: number;
  } | null>(null);

  // 지정콕 확인 팝업 & 게스트 추가 모달 & 미참석 회원 추가 모달 상태
  const [isDesignatedCockModalOpen, setIsDesignatedCockModalOpen] =
    useState(false);
  const [arrivedTab, setArrivedTab] = useState<"UNSUBMITTED" | "SUBMITTED">(
    "UNSUBMITTED"
  );
  const [cockToastMessage, setCockToastMessage] = useState<string | null>(null);
  const [isGuestModalOpen, setIsGuestModalOpen] = useState(false);
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [addMemberSearch, setAddMemberSearch] = useState("");
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isEndSessionModalOpen, setIsEndSessionModalOpen] = useState(false);

  // 회원별 희망 파트너(남복/여복 1명, 혼복 1명) 및 기피 인원(최대 3명) 실시간 맵
  const [preferencesMap, setPreferencesMap] = useState<
    Record<number, MemberPreferenceDto>
  >(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = localStorage.getItem("dailyminton_preferences");
        if (cached) {
          return JSON.parse(cached) as Record<number, MemberPreferenceDto>;
        }
      } catch {
        // ignore
      }
    }
    return {};
  });

  // DB에서 전체 회원의 최신 파트너/기피 설정 로드
  useEffect(() => {
    let isMounted = true;
    fetch("/api/preferences", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Record<number, MemberPreferenceDto> | null) => {
        if (!isMounted || !data || typeof data !== "object") return;
        setPreferencesMap((prev) => ({ ...prev, ...data }));
      })
      .catch(() => {
        // ignore
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const [guestForm, setGuestForm] = useState({
    name: "",
    gender: "MALE" as Gender,
    grade: "D" as Grade,
    ageGroup: "30S" as AgeGroup,
    injuryLevel: "NONE" as "NONE" | "MILD" | "SEVERE",
  });

  const playerMap = useMemo(() => {
    const map = new Map<number, SessionPlayer>();
    players.forEach((p) => map.set(p.id, p));
    return map;
  }, [players]);

  // 코트에 먼저 투입된 순서(1순번, 2순번, 3순번...) 매핑 및 코트 투입 선수 매핑
  const courtEntryRankMap = useMemo(() => {
    const map = new Map<string, number>();
    activeCourtMatches.forEach((m, idx) => {
      map.set(m.id, idx + 1);
    });
    return map;
  }, [activeCourtMatches]);

  const playerInGameCourtMap = useMemo(() => {
    const map = new Map<
      number,
      { courtNumber: number; entryRank: number }
    >();
    activeCourtMatches.forEach((m, idx) => {
      const rank = idx + 1;
      const cNum = m.courtNumber ?? 0;
      [...m.teamA, ...m.teamB].forEach((pid) => {
        map.set(pid, { courtNumber: cNum, entryRank: rank });
      });
    });
    return map;
  }, [activeCourtMatches]);

  // 확정된 대기현황(waitingMatches)에 이미 편성된 선수 ID 집합
  const confirmedReservedIds = useMemo(() => {
    const set = new Set<number>();
    waitingMatches.forEach((m) => {
      m.teamA.forEach((id) => set.add(id));
      m.teamB.forEach((id) => set.add(id));
    });
    return set;
  }, [waitingMatches]);

  // 선수현황 가용 대기 인원 (확정 대기열에 묶이지 않은 WAITING 인원)
  const unassignedWaitingPool = useMemo(
    () =>
      players
        .filter(
          (p) => p.status === "WAITING" && !confirmedReservedIds.has(p.id)
        )
        .sort((a, b) => a.lastWaitStartedAt - b.lastWaitStartedAt),
    [players, confirmedReservedIds]
  );

  // 코트현황에서 먼저 투입된 코트 순(투입 1순번 -> 2순번 -> ...)으로 정렬된 진행중 선수 목록
  const courtOrderedPlayers = useMemo(() => {
    const list: SessionPlayer[] = [];
    activeCourtMatches.forEach((m) => {
      [...m.teamA, ...m.teamB].forEach((pid) => {
        if (confirmedReservedIds.has(pid)) return;
        const p = playerMap.get(pid);
        if (p) list.push(p);
      });
    });
    return list;
  }, [activeCourtMatches, confirmedReservedIds, playerMap]);

  // 예약매칭 자동 활성화 조건:
  // 선수현황에 대기 중인 인원이 1~3명(3인 이하) 있고, 코트현황에 투입된 인원이 있으며, 합산 가용 인원이 4명 이상일 때
  const isReservationModeActive = useMemo(
    () =>
      unassignedWaitingPool.length >= 1 &&
      unassignedWaitingPool.length <= 3 &&
      activeCourtMatches.length > 0 &&
      unassignedWaitingPool.length + courtOrderedPlayers.length >= 4,
    [
      unassignedWaitingPool.length,
      activeCourtMatches.length,
      courtOrderedPlayers.length,
    ]
  );

  const currentReservationStateSig = useMemo(() => {
    if (!isReservationModeActive) return "";
    const wIds = unassignedWaitingPool.map((p) => p.id).join(",");
    const cIds = courtOrderedPlayers.map((p) => p.id).join(",");
    return `${wIds}|${cIds}|${queueFilter}`;
  }, [
    isReservationModeActive,
    unassignedWaitingPool,
    courtOrderedPlayers,
    queueFilter,
  ]);

  // [명세 7번] 운영진 공백 감지:
  // 운영진 계정(모임장 LEADER / 운영진 ADMIN) 중 현재 코트에 투입되어 있지 않은(status !== "IN_GAME", 퇴장 제외) 인원이 0명으로 감지될 때
  // (메인 화면 '운영진 부여' 시 role은 "ADMIN"으로 저장되므로 반드시 포함)
  const availableAdminsOutsideCourt = useMemo(
    () =>
      players.filter(
        (p) =>
          (p.role === "LEADER" || p.role === "ADMIN") &&
          p.status !== "IN_GAME" &&
          p.status !== "LEFT"
      ),
    [players]
  );

  const isAdminVacuumDetected = availableAdminsOutsideCourt.length === 0;

  // [명세 3번] 대기 풀(대기+휴식 포함 매칭 가능 인원) 전체 인원수 계산 (12명 미만 1경기 축소, 8명 미만 하드블록 해제용)
  const activeEligiblePoolSize = useMemo(
    () =>
      players.filter(
        (p) => p.status === "WAITING" || p.status === "RESTING"
      ).length,
    [players]
  );

  const currentDynamicHardBlockGap = useMemo(
    () =>
      resolveDynamicHardBlockGap(activeEligiblePoolSize, hardBlockThresholds),
    [activeEligiblePoolSize, hardBlockThresholds]
  );

  // 선수현황이 3인 이하이고 코트에 진행 인원이 있을 때 자동으로 생성되는 예약매칭 제안(Draft)
  const autoReservationDraft = useMemo<MatchGame | null>(() => {
    if (!isReservationModeActive) return null;
    if (waitingMatches.some((m) => m.isReservedMatch)) return null;
    if (
      dismissedAutoReservationSig &&
      dismissedAutoReservationSig === currentReservationStateSig
    ) {
      return null;
    }
    return generateReservationMatchDraft(
      unassignedWaitingPool,
      courtOrderedPlayers,
      queueFilter,
      preferencesMap,
      rematchStep,
      undefined,
      confirmedMatchHistory,
      activeEligiblePoolSize,
      hardBlockThresholds
    );
  }, [
    isReservationModeActive,
    waitingMatches,
    dismissedAutoReservationSig,
    currentReservationStateSig,
    unassignedWaitingPool,
    courtOrderedPlayers,
    queueFilter,
    preferencesMap,
    rematchStep,
    confirmedMatchHistory,
    activeEligiblePoolSize,
    hardBlockThresholds,
  ]);

  // 운영진 공백(가용 운영진 0명) 상태에서 대기현황이 비어 있고 대기 인원이 4명 이상이면 자동으로 DRAFT 매칭 제안 생성
  const autoVacuumDraft = useMemo<MatchGame | null>(() => {
    if (!isAdminVacuumDetected) return null;
    if (isReservationModeActive) return null;
    if (waitingMatches.length > 0) return null;
    if (unassignedWaitingPool.length < 4) return null;
    return generateAutoMatchDraft(
      unassignedWaitingPool,
      queueFilter,
      preferencesMap,
      rematchStep,
      confirmedMatchHistory,
      activeEligiblePoolSize,
      hardBlockThresholds
    );
  }, [
    isAdminVacuumDetected,
    isReservationModeActive,
    waitingMatches.length,
    unassignedWaitingPool,
    queueFilter,
    preferencesMap,
    rematchStep,
    confirmedMatchHistory,
    activeEligiblePoolSize,
    hardBlockThresholds,
  ]);

  // 화면에 실제로 표시할 제안 카드 (수동/클릭 생성된 draftMatch 우선, 단 기피 인원이 포함되어 있으면 즉시 재계산하여 절대 노출되지 않도록 보장)
  const activeDraftMatch = useMemo<MatchGame | null>(() => {
    if (draftMatch) {
      const draftPlayers = [...draftMatch.teamA, ...draftMatch.teamB]
        .map((id) => playerMap.get(id))
        .filter((p): p is SessionPlayer => p !== undefined);

      if (
        draftPlayers.length === 4 &&
        hasAnyAvoidInGroup(draftPlayers, preferencesMap)
      ) {
        if (
          draftMatch.isReservedMatch ||
          (unassignedWaitingPool.length <= 3 && activeCourtMatches.length > 0)
        ) {
          return generateReservationMatchDraft(
            unassignedWaitingPool,
            courtOrderedPlayers,
            queueFilter,
            preferencesMap,
            rematchStep,
            draftMatch.id,
            confirmedMatchHistory,
            activeEligiblePoolSize,
            hardBlockThresholds
          );
        }
        return generateAutoMatchDraft(
          unassignedWaitingPool,
          queueFilter,
          preferencesMap,
          rematchStep,
          confirmedMatchHistory,
          activeEligiblePoolSize,
          hardBlockThresholds
        );
      }
      return draftMatch;
    }
    return autoReservationDraft ?? autoVacuumDraft;
  }, [
    draftMatch,
    playerMap,
    preferencesMap,
    unassignedWaitingPool,
    activeCourtMatches.length,
    courtOrderedPlayers,
    queueFilter,
    rematchStep,
    confirmedMatchHistory,
    activeEligiblePoolSize,
    hardBlockThresholds,
    autoReservationDraft,
    autoVacuumDraft,
  ]);

  const reservedPlayerIds = useMemo(() => {
    const set = new Set<number>();
    if (activeDraftMatch) {
      activeDraftMatch.teamA.forEach((id) => set.add(id));
      activeDraftMatch.teamB.forEach((id) => set.add(id));
    }
    waitingMatches.forEach((m) => {
      m.teamA.forEach((id) => set.add(id));
      m.teamB.forEach((id) => set.add(id));
    });
    return set;
  }, [activeDraftMatch, waitingMatches]);

  // 1) 정모 참석예정자 리스트 (status === "ARRIVED")
  const arrivedPlayers = useMemo(
    () =>
      players
        .filter((p) => p.status === "ARRIVED")
        .sort((a, b) => a.arrivalOrder - b.arrivalOrder),
    [players]
  );

  // 4) 선수현황 리스트 (status === "WAITING")
  const waitingPlayers = useMemo(() => {
    const keyword = playerSearch.trim().toLowerCase();
    const filtered = players.filter((p) => {
      if (p.status !== "WAITING") return false;
      if (reservedPlayerIds.has(p.id)) return false;
      if (!keyword) return true;
      return (
        p.name.toLowerCase().includes(keyword) ||
        p.nickname.toLowerCase().includes(keyword)
      );
    });

    return [...filtered].sort((a, b) => {
      if (playerSort === "WAIT_ORDER") {
        const aPenalty = a.consecutiveGameCount >= 2 ? 1 : 0;
        const bPenalty = b.consecutiveGameCount >= 2 ? 1 : 0;
        if (aPenalty !== bPenalty) return aPenalty - bPenalty;
        return a.lastWaitStartedAt - b.lastWaitStartedAt;
      }
      if (playerSort === "GAME_COUNT") {
        if (a.totalGameCount !== b.totalGameCount) {
          return a.totalGameCount - b.totalGameCount;
        }
        return a.lastWaitStartedAt - b.lastWaitStartedAt;
      }
      if (GRADE_SORT_ORDER[a.grade] !== GRADE_SORT_ORDER[b.grade]) {
        return GRADE_SORT_ORDER[a.grade] - GRADE_SORT_ORDER[b.grade];
      }
      return b.eloScore - a.eloScore;
    });
  }, [players, reservedPlayerIds, playerSearch, playerSort]);

  // 5) 휴식현황 리스트 (status === "RESTING")
  const restingPlayers = useMemo(
    () => players.filter((p) => p.status === "RESTING"),
    [players]
  );

  // 6) 퇴장현황 리스트 (status === "LEFT")
  const leftPlayers = useMemo(
    () => players.filter((p) => p.status === "LEFT"),
    [players]
  );

  const filteredWaitingMatches = useMemo(() => {
    if (queueFilter === "ALL") return waitingMatches;
    return waitingMatches.filter((m) => m.matchType === queueFilter);
  }, [waitingMatches, queueFilter]);

  const cockSummary = useMemo(() => {
    const submittedList = players.filter((p) => p.cockSubmitted);
    const totalCocks = submittedList.reduce(
      (acc, cur) => acc + cur.cockQuantity,
      0
    );
    return {
      submittedCount: submittedList.length,
      totalParticipants: players.length,
      totalCocks,
      submittedList,
    };
  }, [players]);

  // 경기 운영 종료 모달용: 참가자 전원 승률 순위(Win Rate Ranking) 및 전적(몇승 몇패) 집계
  const sessionWinRateRankings = useMemo(() => {
    const enriched = players.map((p) => {
      const decidedGames = p.wins + p.losses;
      const winRate =
        decidedGames > 0
          ? Math.round((p.wins / decidedGames) * 1000) / 10
          : 0;
      const baseElo = GRADE_BASE_ELO[p.grade];
      const eloDiff = Math.round(p.eloScore - baseElo);
      return {
        player: p,
        decidedGames,
        winRate,
        eloDiff,
      };
    });

    enriched.sort((a, b) => {
      // 1순위: 승패 기록( 또는 경기 진행)이 있는 참가자를 미진행(0게임) 참가자보다 상위에 배치
      const aPlayed = a.decidedGames > 0 || a.player.totalGameCount > 0 ? 1 : 0;
      const bPlayed = b.decidedGames > 0 || b.player.totalGameCount > 0 ? 1 : 0;
      if (aPlayed !== bPlayed) return bPlayed - aPlayed;

      // 2순위: 승률(%) 높은 순
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;

      // 3순위: 승률 동률 시 다승(승수 많은 순)
      if (b.player.wins !== a.player.wins) return b.player.wins - a.player.wins;

      // 4순위: 패수 적은 순
      if (a.player.losses !== b.player.losses)
        return a.player.losses - b.player.losses;

      // 5순위: 총 진행 게임 수 많은 순
      if (b.player.totalGameCount !== a.player.totalGameCount) {
        return b.player.totalGameCount - a.player.totalGameCount;
      }

      // 6순위: 실시간 ELO 점수 높은 순
      if (b.player.eloScore !== a.player.eloScore) {
        return b.player.eloScore - a.player.eloScore;
      }

      return a.player.name.localeCompare(b.player.name, "ko");
    });

    // 공동 순위(동일 승률·동일 승패) 계산 포함
    const rankedList: Array<
      (typeof enriched)[number] & {
        rank: number;
      }
    > = [];
    for (let idx = 0; idx < enriched.length; idx++) {
      const item = enriched[idx];
      let rank = idx + 1;
      if (idx > 0) {
        const prev = rankedList[idx - 1];
        const isSameRecord =
          prev.winRate === item.winRate &&
          prev.player.wins === item.player.wins &&
          prev.player.losses === item.player.losses &&
          prev.player.totalGameCount === item.player.totalGameCount;
        if (isSameRecord) {
          rank = prev.rank;
        }
      }
      rankedList.push({
        ...item,
        rank,
      });
    }
    return rankedList;
  }, [players]);

  const sessionSummaryStats = useMemo(() => {
    const totalPlayerGames = players.reduce(
      (acc, p) => acc + p.totalGameCount,
      0
    );
    const completedCourtGames = Math.floor(totalPlayerGames / 4);
    const playedMemberCount = players.filter(
      (p) => p.totalGameCount > 0 || p.wins + p.losses > 0
    ).length;
    const topPlayer =
      sessionWinRateRankings.length > 0 &&
        (sessionWinRateRankings[0].decidedGames > 0 ||
          sessionWinRateRankings[0].player.totalGameCount > 0)
        ? sessionWinRateRankings[0]
        : null;

    return {
      totalParticipants: players.length,
      completedCourtGames,
      playedMemberCount,
      topPlayer,
    };
  }, [players, sessionWinRateRankings]);

  // 정모 참석예정자 -> 콕 제출 클릭 시 선수현황(WAITING)으로 이동
  const handleSubmitCockAndMoveToActive = useCallback(
    (playerId: number, quantity = 2) => {
      const nowTime = new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      });

      const targetPlayer = playerMap.get(playerId);
      setPlayers((prev) =>
        prev.map((p) =>
          p.id === playerId
            ? {
              ...p,
              cockSubmitted: true,
              cockQuantity: quantity,
              cockSubmittedAt: nowTime,
              status: "WAITING",
              lastWaitStartedAt: Date.now(),
            }
            : p
        )
      );

      if (targetPlayer) {
        setCockToastMessage(
          `${targetPlayer.name}님 지정콕 ${quantity}개 제출 완료 → 선수현황으로 이동되었습니다.`
        );
      }
    },
    [playerMap]
  );

  // 콕 제출 취소 (제출 상태를 원복하고 선수현황 -> 정모 참석예정자 리스트로 되돌림)
  const handleCancelCockSubmission = useCallback(
    (playerId: number) => {
      const targetPlayer = playerMap.get(playerId);
      if (!targetPlayer) return;

      if (targetPlayer.status === "IN_GAME") {
        alert("현재 코트에서 게임 진행 중인 선수는 콕 제출을 취소할 수 없습니다.");
        return;
      }
      if (reservedPlayerIds.has(playerId)) {
        alert(
          "대기현황(또는 매칭 제안)에 편성된 선수입니다. 먼저 매칭에서 제외한 뒤 취소해주세요."
        );
        return;
      }

      setManualSelectedIds((prev) => prev.filter((id) => id !== playerId));
      setPlayers((prev) =>
        prev.map((p) =>
          p.id === playerId
            ? {
              ...p,
              cockSubmitted: false,
              cockQuantity: 0,
              cockSubmittedAt: undefined,
              status: "ARRIVED",
            }
            : p
        )
      );

      setCockToastMessage(
        `${targetPlayer.name}님의 콕 제출이 취소되어 정모 참석예정자 리스트로 원복되었습니다.`
      );
    },
    [playerMap, reservedPlayerIds]
  );

  const handleSubmitAllArrivedCock = useCallback(() => {
    if (arrivedPlayers.length === 0) return;
    const nowTime = new Date().toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const baseNow = Date.now();

    setPlayers((prev) =>
      prev.map((p, idx) =>
        p.status === "ARRIVED"
          ? {
            ...p,
            cockSubmitted: true,
            cockQuantity: 2,
            cockSubmittedAt: nowTime,
            status: "WAITING",
            lastWaitStartedAt: baseNow + idx * 10,
          }
          : p
      )
    );
    setCockToastMessage(
      `참석예정자 ${arrivedPlayers.length}명 전원 콕 제출 완료 → 선수현황으로 이동되었습니다.`
    );
  }, [arrivedPlayers.length]);

  const handleMovePlayerStatus = useCallback(
    (playerId: number, nextStatus: "WAITING" | "RESTING" | "LEFT") => {
      const nowTime = new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      });

      setManualSelectedIds((prev) => prev.filter((id) => id !== playerId));
      setPlayers((prev) =>
        prev.map((p) => {
          if (p.id !== playerId) return p;
          return {
            ...p,
            status: nextStatus,
            lastWaitStartedAt:
              nextStatus === "WAITING" ? Date.now() : p.lastWaitStartedAt,
            consecutiveGameCount:
              nextStatus === "RESTING" ? 0 : p.consecutiveGameCount,
            leftAt: nextStatus === "LEFT" ? nowTime : p.leftAt,
          };
        })
      );
    },
    []
  );

  // [명세 3번] 최근 동반자 추적 매트릭스 갱신 헬퍼: 경기가 CONFIRMED될 때마다 추가 또는 갱신
  const upsertConfirmedHistory = useCallback(
    (match: MatchGame, autoConfirmed = false) => {
      const nowStr = new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const playerIds: [number, number, number, number] = [
        match.teamA[0],
        match.teamA[1],
        match.teamB[0],
        match.teamB[1],
      ];

      setConfirmedMatchHistory((prev) => {
        const existingIdx = prev.findIndex((h) => h.matchId === match.id);
        if (existingIdx !== -1) {
          return prev.map((h, i) =>
            i === existingIdx
              ? {
                ...h,
                playerIds,
                confirmedAt: nowStr,
                autoConfirmed: autoConfirmed || h.autoConfirmed,
              }
              : h
          );
        }
        return [
          ...prev,
          {
            matchId: match.id,
            matchSequence: prev.length + 1,
            playerIds,
            confirmedAt: nowStr,
            autoConfirmed,
          },
        ];
      });
    },
    []
  );

  const removeConfirmedHistory = useCallback((matchId: string) => {
    setConfirmedMatchHistory((prev) =>
      prev
        .filter((h) => h.matchId !== matchId)
        .map((h, idx) => ({ ...h, matchSequence: idx + 1 }))
    );
  }, []);

  // [명세 4번] 90일 보존용 매칭 결정 로그 저장 헬퍼
  const appendDecisionLog = useCallback((log?: MatchDecisionLogEntry) => {
    if (!log) return;
    setDecisionLogs((prev) => {
      const nowTs = Date.now();
      const validPrev = prev.filter((item) => item.expiresAtTimestamp > nowTs);
      const next = [log, ...validPrev].slice(0, 100);
      try {
        localStorage.setItem(
          "dailyminton_match_decision_logs",
          JSON.stringify(next)
        );
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // [명세 7번] 2초 비관적 락(Pessimistic Lock) 충돌 검사 헬퍼
  const checkPessimisticLockBlocked = useCallback(
    (targetId?: string) => {
      if (
        pessimisticLockedDraftId &&
        (!targetId || targetId === pessimisticLockedDraftId)
      ) {
        alert("방금 자동으로 확정되었습니다. 최신 상태를 불러옵니다");
        setDraftMatch(null);
        setSwapTarget(null);
        return true;
      }
      return false;
    },
    [pessimisticLockedDraftId]
  );

  const handleAutoMatch = useCallback(() => {
    if (checkPessimisticLockBlocked(activeDraftMatch?.id)) return;
    const nextStep = activeDraftMatch ? rematchStep + 1 : 0;

    // 1) 선수현황 가용 인원이 4명 이상이면 일반 자동매칭 수행
    if (unassignedWaitingPool.length >= 4) {
      const generated = generateAutoMatchDraft(
        unassignedWaitingPool,
        queueFilter,
        preferencesMap,
        nextStep,
        confirmedMatchHistory,
        activeEligiblePoolSize,
        hardBlockThresholds
      );
      if (!generated) {
        alert("매칭 가능한 4인 조합을 구성할 수 없습니다.");
        return;
      }
      appendDecisionLog(generated.decisionLog);
      setRematchStep(nextStep);
      setDismissedAutoReservationSig(null);
      setDraftMatch(generated);
      return;
    }

    // 2) 선수현황이 3인 이하이고 코트에 투입된 인원이 있으면 '예약매칭' 수행
    if (
      activeCourtMatches.length > 0 &&
      unassignedWaitingPool.length + courtOrderedPlayers.length >= 4
    ) {
      const reservedGenerated = generateReservationMatchDraft(
        unassignedWaitingPool,
        courtOrderedPlayers,
        queueFilter,
        preferencesMap,
        nextStep,
        undefined,
        confirmedMatchHistory,
        activeEligiblePoolSize,
        hardBlockThresholds
      );
      if (!reservedGenerated) {
        alert("예약매칭 가능한 4인 조합을 구성할 수 없습니다.");
        return;
      }
      setRematchStep(nextStep);
      setDismissedAutoReservationSig(null);
      setDraftMatch(reservedGenerated);
      return;
    }

    alert(
      `자동매칭을 위해서는 최소 4명의 선수(대기 인원 + 코트 진행 인원)가 필요합니다.`
    );
  }, [
    checkPessimisticLockBlocked,
    activeDraftMatch,
    rematchStep,
    unassignedWaitingPool,
    activeCourtMatches.length,
    courtOrderedPlayers,
    queueFilter,
    preferencesMap,
    confirmedMatchHistory,
    activeEligiblePoolSize,
    hardBlockThresholds,
    appendDecisionLog,
  ]);

  // '멤버 바꾸기' 버튼 클릭 시: 일반 매칭이면 대기 풀에서, 예약매칭(또는 대기 3인 이하)이면 대기인원 + 선투입 코트 인원 풀에서 ELO 기반 재매칭
  const handleRematchDraftByElo = useCallback(() => {
    if (!activeDraftMatch) return;
    if (checkPessimisticLockBlocked(activeDraftMatch.id)) return;

    const nextStep = rematchStep + 1;

    if (
      activeDraftMatch.isReservedMatch ||
      (unassignedWaitingPool.length <= 3 && activeCourtMatches.length > 0)
    ) {
      const rematchedReserved = generateReservationMatchDraft(
        unassignedWaitingPool,
        courtOrderedPlayers,
        queueFilter,
        preferencesMap,
        nextStep,
        activeDraftMatch.id,
        confirmedMatchHistory,
        activeEligiblePoolSize,
        hardBlockThresholds
      );
      if (!rematchedReserved) return;
      setRematchStep(nextStep);
      setDismissedAutoReservationSig(null);
      setDraftMatch(rematchedReserved);
      return;
    }

    const rematched = rematchByEloRanking(
      unassignedWaitingPool,
      activeDraftMatch,
      queueFilter,
      nextStep,
      preferencesMap,
      confirmedMatchHistory,
      activeEligiblePoolSize,
      hardBlockThresholds
    );

    if (!rematched) {
      alert("ELO 랭킹 기반으로 재매칭할 수 있는 후보 인원이 부족합니다.");
      return;
    }

    appendDecisionLog(rematched.decisionLog);
    setRematchStep(nextStep);
    setDraftMatch(rematched);
  }, [
    activeDraftMatch,
    checkPessimisticLockBlocked,
    rematchStep,
    unassignedWaitingPool,
    activeCourtMatches.length,
    courtOrderedPlayers,
    queueFilter,
    preferencesMap,
    confirmedMatchHistory,
    activeEligiblePoolSize,
    hardBlockThresholds,
    appendDecisionLog,
  ]);

  // 확정된 대기현황 카드에서 '멤버 바꾸기' 클릭 시 ELO 랭킹 기반으로 해당 카드 재매칭 (예약매칭 포함)
  const handleRematchWaitingMatchByElo = useCallback(
    (targetMatchId: string) => {
      const targetMatch = waitingMatches.find((m) => m.id === targetMatchId);
      if (!targetMatch) return;

      const otherReservedIds = new Set<number>();
      if (activeDraftMatch) {
        activeDraftMatch.teamA.forEach((id) => otherReservedIds.add(id));
        activeDraftMatch.teamB.forEach((id) => otherReservedIds.add(id));
      }
      waitingMatches.forEach((m) => {
        if (m.id === targetMatchId) return;
        m.teamA.forEach((id) => otherReservedIds.add(id));
        m.teamB.forEach((id) => otherReservedIds.add(id));
      });

      const waitingPoolForTarget = players.filter(
        (p) => p.status === "WAITING" && !otherReservedIds.has(p.id)
      );

      // 현재 재매칭 대상 경기를 제외한 이전 확정 이력 기준으로 동반자 매트릭스 계산
      const historyExcludingTarget = confirmedMatchHistory.filter(
        (h) => h.matchId !== targetMatchId
      );

      const nextStep = rematchStep + 1;

      if (targetMatch.isReservedMatch || waitingPoolForTarget.length < 4) {
        const courtPoolForTarget: SessionPlayer[] = [];
        activeCourtMatches.forEach((m) => {
          [...m.teamA, ...m.teamB].forEach((pid) => {
            if (otherReservedIds.has(pid)) return;
            const p = playerMap.get(pid);
            if (p) courtPoolForTarget.push(p);
          });
        });

        const rematchedReserved = generateReservationMatchDraft(
          waitingPoolForTarget,
          courtPoolForTarget,
          queueFilter,
          preferencesMap,
          nextStep,
          targetMatch.id,
          historyExcludingTarget,
          activeEligiblePoolSize,
          hardBlockThresholds
        );
        if (!rematchedReserved) return;

        const updatedMatch: MatchGame = {
          ...rematchedReserved,
          status: "CONFIRMED",
          isReservedMatch: true,
        };
        setRematchStep(nextStep);
        setWaitingMatches((prev) =>
          prev.map((m) => (m.id === targetMatchId ? updatedMatch : m))
        );
        upsertConfirmedHistory(updatedMatch, Boolean(targetMatch.autoConfirmed));
        return;
      }

      const rematched = rematchByEloRanking(
        waitingPoolForTarget,
        targetMatch,
        queueFilter,
        nextStep,
        preferencesMap,
        historyExcludingTarget,
        activeEligiblePoolSize,
        hardBlockThresholds
      );

      if (!rematched) return;

      const updatedMatch: MatchGame = {
        ...rematched,
        status: "CONFIRMED",
      };
      appendDecisionLog(rematched.decisionLog);
      setRematchStep(nextStep);
      setWaitingMatches((prev) =>
        prev.map((m) => (m.id === targetMatchId ? updatedMatch : m))
      );
      upsertConfirmedHistory(updatedMatch, Boolean(targetMatch.autoConfirmed));
    },
    [
      waitingMatches,
      activeDraftMatch,
      players,
      confirmedMatchHistory,
      rematchStep,
      activeCourtMatches,
      playerMap,
      queueFilter,
      preferencesMap,
      activeEligiblePoolSize,
      hardBlockThresholds,
      appendDecisionLog,
      upsertConfirmedHistory,
    ]
  );

  const handleToggleManualSelect = useCallback((playerId: number) => {
    setManualSelectedIds((prev) => {
      if (prev.includes(playerId)) {
        return prev.filter((id) => id !== playerId);
      }
      if (prev.length >= 4) return prev;
      return [...prev, playerId];
    });
  }, []);

  const handleCreateManualMatch = useCallback(() => {
    if (manualSelectedIds.length !== 4) return;
    const selectedPlayers = manualSelectedIds
      .map((id) => playerMap.get(id))
      .filter((p): p is SessionPlayer => p !== undefined);
    if (selectedPlayers.length !== 4) return;

    const matchType = detectMatchType(selectedPlayers);
    const isMixed = matchType === "MIXED_DOUBLE";
    const scoreFn = (p: SessionPlayer) =>
      isMixed ? getEffectiveMatchingElo(p) : Math.round(p.eloScore);

    const teamAAvgElo = Math.round(
      (scoreFn(selectedPlayers[0]) + scoreFn(selectedPlayers[1])) / 2
    );
    const teamBAvgElo = Math.round(
      (scoreFn(selectedPlayers[2]) + scoreFn(selectedPlayers[3])) / 2
    );
    const coPlayerEval = evaluateCoPlayerHistory(
      selectedPlayers,
      confirmedMatchHistory
    );

    const newMatch: MatchGame = {
      id: `manual-${Date.now()}`,
      matchType,
      status: "CONFIRMED",
      origin: "MANUAL",
      teamA: [selectedPlayers[0].id, selectedPlayers[1].id],
      teamB: [selectedPlayers[2].id, selectedPlayers[3].id],
      createdAt: new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      reasonSummary: `수동 배정 완료 | 팀 ${isMixed ? "보정 " : ""}ELO 편차 ${Math.abs(
        teamAAvgElo - teamBAvgElo
      )}점`,
      teamAAvgElo,
      teamBAvgElo,
      recentFiveOverlapCount: coPlayerEval.recentFiveOverlapCount,
      playerRecentOverlapMap: coPlayerEval.playerRecentOverlapMap,
    };

    setWaitingMatches((prev) => [...prev, newMatch]);
    upsertConfirmedHistory(newMatch, false);
    setManualSelectedIds([]);
  }, [
    manualSelectedIds,
    playerMap,
    confirmedMatchHistory,
    upsertConfirmedHistory,
  ]);

  const handleConfirmDraftToQueue = useCallback(
    (isAutoConfirmedBySystem = false) => {
      if (!activeDraftMatch) return;
      if (
        !isAutoConfirmedBySystem &&
        checkPessimisticLockBlocked(activeDraftMatch.id)
      ) {
        return;
      }
      const nowTime = new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const confirmedMatch: MatchGame = {
        ...activeDraftMatch,
        status: "CONFIRMED",
        autoConfirmed: isAutoConfirmedBySystem,
        autoConfirmedAt: isAutoConfirmedBySystem ? nowTime : undefined,
      };
      appendDecisionLog(confirmedMatch.decisionLog);
      setWaitingMatches((prev) => [...prev, confirmedMatch]);
      if (queueFilter !== "ALL" && queueFilter !== confirmedMatch.matchType) {
        setQueueFilter("ALL");
      }
      upsertConfirmedHistory(confirmedMatch, isAutoConfirmedBySystem);
      setDraftMatch(null);
      setDismissedAutoReservationSig(currentReservationStateSig);
    },
    [
      activeDraftMatch,
      checkPessimisticLockBlocked,
      appendDecisionLog,
      queueFilter,
      currentReservationStateSig,
      upsertConfirmedHistory,
    ]
  );

  // [명세 7번] 운영진 공백(status !== IN_GAME 운영진 0명) 상태에서
  // 신뢰도 기준(isAutoConfirmEligible === true: groupSpread <= 100 && avoidConflicts === 0)을 만족하는 DRAFT 제안에 한해
  // 45초 경과 후 2초의 비관적 락(Pessimistic Lock)을 걸고 자동으로 CONFIRMED 상태로 승격
  useEffect(() => {
    if (
      !isAdminVacuumDetected ||
      !activeDraftMatch ||
      !activeDraftMatch.isAutoConfirmEligible
    ) {
      return;
    }

    const targetDraftId = activeDraftMatch.id;
    let lockTimeoutId: number | undefined;

    const timer = window.setInterval(() => {
      setAutoConfirmTimerState((prev) => {
        if (prev.draftId !== targetDraftId) {
          return { draftId: targetDraftId, remainingSec: 44 };
        }
        if (prev.remainingSec <= 1) {
          window.clearInterval(timer);
          // 자동 승인 처리가 시작되는 순간 2초간 비관적 락 설정
          setPessimisticLockedDraftId(targetDraftId);
          lockTimeoutId = window.setTimeout(() => {
            handleConfirmDraftToQueue(true);
            setPessimisticLockedDraftId(null);
          }, 2000);
          return { draftId: targetDraftId, remainingSec: 0 };
        }
        return { draftId: targetDraftId, remainingSec: prev.remainingSec - 1 };
      });
    }, 1000);

    return () => {
      window.clearInterval(timer);
      if (lockTimeoutId !== undefined) {
        window.clearTimeout(lockTimeoutId);
      }
    };
  }, [
    isAdminVacuumDetected,
    activeDraftMatch,
    handleConfirmDraftToQueue,
  ]);

  const handleReplaceMember = useCallback(
    (newPlayerId: number) => {
      if (!swapTarget) return;
      if (
        swapTarget.isDraft &&
        checkPessimisticLockBlocked(swapTarget.matchId)
      ) {
        return;
      }
      const newPlayer = playerMap.get(newPlayerId);
      if (!newPlayer) return;

      const updateMatchPlayers = (match: MatchGame): MatchGame => {
        const nextTeamA: [number, number] = [
          match.teamA[0] === swapTarget.oldPlayerId
            ? newPlayerId
            : match.teamA[0],
          match.teamA[1] === swapTarget.oldPlayerId
            ? newPlayerId
            : match.teamA[1],
        ];
        const nextTeamB: [number, number] = [
          match.teamB[0] === swapTarget.oldPlayerId
            ? newPlayerId
            : match.teamB[0],
          match.teamB[1] === swapTarget.oldPlayerId
            ? newPlayerId
            : match.teamB[1],
        ];

        const allFour = [...nextTeamA, ...nextTeamB]
          .map((id) => playerMap.get(id))
          .filter((p): p is SessionPlayer => p !== undefined);

        const nextType =
          allFour.length === 4 ? detectMatchType(allFour) : match.matchType;
        const isMixed = nextType === "MIXED_DOUBLE";
        const scoreFn = (p: SessionPlayer) =>
          isMixed ? getEffectiveMatchingElo(p) : Math.round(p.eloScore);

        const teamAAvgElo =
          allFour.length === 4
            ? Math.round((scoreFn(allFour[0]) + scoreFn(allFour[1])) / 2)
            : match.teamAAvgElo;
        const teamBAvgElo =
          allFour.length === 4
            ? Math.round((scoreFn(allFour[2]) + scoreFn(allFour[3])) / 2)
            : match.teamBAvgElo;

        const coPlayerEval =
          allFour.length === 4
            ? evaluateCoPlayerHistory(
              allFour,
              confirmedMatchHistory.filter((h) => h.matchId !== match.id)
            )
            : undefined;

        return {
          ...match,
          matchType: nextType,
          teamA: nextTeamA,
          teamB: nextTeamB,
          teamAAvgElo,
          teamBAvgElo,
          recentFiveOverlapCount:
            coPlayerEval?.recentFiveOverlapCount ?? match.recentFiveOverlapCount,
          playerRecentOverlapMap:
            coPlayerEval?.playerRecentOverlapMap ?? match.playerRecentOverlapMap,
          reasonSummary: `멤버 교체 반영 | 팀 ${isMixed ? "보정 " : ""}ELO 편차 ${Math.abs(
            teamAAvgElo - teamBAvgElo
          )}점`,
        };
      };

      if (swapTarget.isDraft && activeDraftMatch) {
        setDraftMatch(updateMatchPlayers(activeDraftMatch));
      } else {
        setWaitingMatches((prev) =>
          prev.map((m) => {
            if (m.id !== swapTarget.matchId) return m;
            const updated = updateMatchPlayers(m);
            upsertConfirmedHistory(updated, Boolean(m.autoConfirmed));
            return updated;
          })
        );
      }

      setSwapTarget(null);
    },
    [
      swapTarget,
      checkPessimisticLockBlocked,
      playerMap,
      activeDraftMatch,
      confirmedMatchHistory,
      upsertConfirmedHistory,
    ]
  );

  const handleCancelWaitingMatch = useCallback(
    (matchId: string) => {
      setWaitingMatches((prev) => prev.filter((m) => m.id !== matchId));
      removeConfirmedHistory(matchId);
    },
    [removeConfirmedHistory]
  );

  const handleAssignMatchToCourt = useCallback(
    (matchId: string, preferredCourtNumber?: number) => {
      const targetMatch = waitingMatches.find((m) => m.id === matchId);
      if (!targetMatch) return;

      // 예약매칭 인원 중 아직 다른 코트에서 게임이 끝나지 않은 선수가 있는지 확인
      const allTargetIds = [...targetMatch.teamA, ...targetMatch.teamB];
      const stillPlayingNames = allTargetIds
        .map((id) => playerMap.get(id))
        .filter((p): p is SessionPlayer => p !== undefined && p.status === "IN_GAME")
        .map((p) => p.name);

      if (stillPlayingNames.length > 0) {
        alert(
          `예약매칭 인원 중 [${stillPlayingNames.join(
            ", "
          )}] 선수가 아직 코트에서 게임 진행 중입니다.\n해당 코트 경기가 종료되면 즉시 코트에 투입할 수 있습니다.`
        );
        return;
      }

      const availableCourt = preferredCourtNumber
        ? courts.find(
          (c) =>
            c.courtNumber === preferredCourtNumber &&
            c.isActive &&
            !c.currentMatchId
        )
        : courts.find((c) => c.isActive && !c.currentMatchId);

      if (!availableCourt) {
        alert("현재 비어 있는 활성 코트가 없습니다.");
        return;
      }

      const nowStr = new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      });

      const inProgressMatch: MatchGame = {
        ...targetMatch,
        status: "IN_PROGRESS",
        courtNumber: availableCourt.courtNumber,
        startedAt: nowStr,
      };

      const assignedIds = new Set([
        ...targetMatch.teamA,
        ...targetMatch.teamB,
      ]);

      setWaitingMatches((prev) => prev.filter((m) => m.id !== matchId));
      setActiveCourtMatches((prev) => [...prev, inProgressMatch]);
      setCourtAssignmentMap((prev) => ({
        ...prev,
        [availableCourt.courtNumber]: {
          currentMatchId: inProgressMatch.id,
          assignedOrder: activeCourtMatches.length + 1,
        },
      }));
      setPlayers((prev) =>
        prev.map((p) =>
          assignedIds.has(p.id) ? { ...p, status: "IN_GAME" } : p
        )
      );
    },
    [waitingMatches, courts, activeCourtMatches.length, playerMap]
  );

  const handleUnassignCourtMatch = useCallback(
    (matchId: string) => {
      const match = activeCourtMatches.find((m) => m.id === matchId);
      if (!match) return;

      const participantIds = new Set([...match.teamA, ...match.teamB]);

      setActiveCourtMatches((prev) => prev.filter((m) => m.id !== matchId));
      setCourtAssignmentMap((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          const numKey = Number(key);
          if (next[numKey]?.currentMatchId === matchId) {
            delete next[numKey];
          }
        }
        return next;
      });
      setPlayers((prev) =>
        prev.map((p) =>
          participantIds.has(p.id) ? { ...p, status: "WAITING" } : p
        )
      );
      setWaitingMatches((prev) => [
        { ...match, status: "CONFIRMED", courtNumber: undefined },
        ...prev,
      ]);
    },
    [activeCourtMatches]
  );

  const handleFinishCourtMatch = useCallback(
    (matchId: string, winningTeam: "A" | "B" | null) => {
      const match = activeCourtMatches.find((m) => m.id === matchId);
      if (!match) return;

      const teamAIds = new Set(match.teamA);
      const participantIds = new Set([...match.teamA, ...match.teamB]);

      const { deltaA, deltaB } = winningTeam
        ? calculateEloDelta(match.teamAAvgElo, match.teamBAvgElo, winningTeam)
        : { deltaA: 0, deltaB: 0 };

      const nowTs = Date.now();

      setPlayers((prev) =>
        prev.map((p) => {
          if (participantIds.has(p.id)) {
            const isTeamA = teamAIds.has(p.id);
            const eloDelta = isTeamA ? deltaA : deltaB;
            const won =
              winningTeam !== null &&
              ((isTeamA && winningTeam === "A") ||
                (!isTeamA && winningTeam === "B"));
            const lost =
              winningTeam !== null &&
              ((isTeamA && winningTeam === "B") ||
                (!isTeamA && winningTeam === "A"));

            return {
              ...p,
              status: "WAITING",
              eloScore: Math.max(800, p.eloScore + eloDelta),
              totalGameCount: p.totalGameCount + 1,
              consecutiveGameCount: p.consecutiveGameCount + 1,
              wins: won ? p.wins + 1 : p.wins,
              losses: lost ? p.losses + 1 : p.losses,
              lastWaitStartedAt: nowTs,
            };
          }
          return p;
        })
      );

      setActiveCourtMatches((prev) => prev.filter((m) => m.id !== matchId));
      setCourtAssignmentMap((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          const numKey = Number(key);
          if (next[numKey]?.currentMatchId === matchId) {
            delete next[numKey];
          }
        }
        return next;
      });
    },
    [activeCourtMatches]
  );

  const handleToggleCourtActive = useCallback(
    (courtNumber: number) => {
      const targetCourt = courts.find((c) => c.courtNumber === courtNumber);
      if (!targetCourt) return;
      if (targetCourt.currentMatchId) {
        alert("현재 게임이 진행 중인 코트는 비활성화할 수 없습니다.");
        return;
      }
      setCourtActiveOverrides((prev) => ({
        ...prev,
        [courtNumber]: !targetCourt.isActive,
      }));
    },
    [courts]
  );

  // 경기 진행 현황판에서 회원 추가 / 게스트 등록 시 홈 화면 정모 일정(참가자 현황)에도 실시간 반영
  const syncSessionPlayersToHomeMeetup = useCallback(
    (nextPlayers: SessionPlayer[]) => {
      if (typeof window === "undefined") return;
      const memberIds = nextPlayers
        .filter((p) => !p.isGuest && typeof p.memberId === "number")
        .map((p) => p.memberId as number);
      const guests = nextPlayers
        .filter((p) => p.isGuest)
        .map((p) => ({
          id: p.id,
          name: p.name,
          gender: p.gender,
          grade: p.grade,
          ageGroup: p.ageGroup,
        }));

      const updatedMeetup: MeetupScheduleDto = {
        ...meetup,
        participantIds: memberIds,
        guests,
        currentParticipants: memberIds.length + guests.length,
      };

      try {
        sessionStorage.setItem(
          `dailyminton_meetup_${meetupId}`,
          JSON.stringify(updatedMeetup)
        );
        const listSaved = sessionStorage.getItem("dailyminton_meetups");
        const baseList = listSaved
          ? (JSON.parse(listSaved) as MeetupScheduleDto[])
          : [];
        if (Array.isArray(baseList)) {
          const nextList = baseList.map((m) =>
            m.id === meetupId
              ? {
                ...m,
                participantIds: memberIds,
                guests,
                currentParticipants: memberIds.length + guests.length,
              }
              : m
          );
          sessionStorage.setItem(
            "dailyminton_meetups",
            JSON.stringify(nextList)
          );
        }
      } catch {
        // ignore
      }

      fetch("/api/meetups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sync_session_players",
          meetupId,
          participantIds: memberIds,
          guests,
        }),
      }).catch(() => {
        // ignore
      });
    },
    [meetup, meetupId]
  );

  const handleRegisterGuest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestForm.name.trim()) return;

    const newGuest: SessionPlayer = {
      id: Date.now(),
      name: guestForm.name.trim(),
      nickname: guestForm.name.trim(),
      isGuest: true,
      role: "MEMBER",
      gender: guestForm.gender,
      grade: guestForm.grade,
      ageGroup: guestForm.ageGroup,
      injuryLevel: guestForm.injuryLevel,
      eloScore: GRADE_BASE_ELO[guestForm.grade],
      cockSubmitted: false,
      cockQuantity: 0,
      status: "ARRIVED",
      arrivalOrder: players.length + 1,
      lastWaitStartedAt: Date.now(),
      totalGameCount: 0,
      consecutiveGameCount: 0,
      wins: 0,
      losses: 0,
    };

    const nextPlayers = [...players, newGuest];
    setPlayers(nextPlayers);
    syncSessionPlayersToHomeMeetup(nextPlayers);
    setGuestForm({
      name: "",
      gender: "MALE",
      grade: "D",
      ageGroup: "30S",
      injuryLevel: "NONE",
    });
    setIsGuestModalOpen(false);
  };

  const unaddedClubMembers = useMemo(() => {
    const existingMemberIds = new Set(
      players.map((p) => p.memberId).filter(Boolean)
    );
    return clubMembers.filter((m) => !existingMemberIds.has(m.id));
  }, [players, clubMembers]);

  const handleAddClubMemberToSession = useCallback(
    (memberId: number) => {
      const member = clubMembers.find((m) => m.id === memberId);
      if (!member) return;

      const added: SessionPlayer = {
        id: member.id,
        memberId: member.id,
        name: member.name,
        nickname: member.nickname,
        isGuest: false,
        role: member.role,
        gender: member.gender,
        grade: member.grade,
        ageGroup: member.ageGroup,
        injuryLevel: member.injuryLevel ?? "NONE",
        eloScore: member.eloScore ?? GRADE_BASE_ELO[member.grade],
        cockSubmitted: false,
        cockQuantity: 0,
        status: "ARRIVED",
        arrivalOrder: players.length + 1,
        lastWaitStartedAt: Date.now(),
        totalGameCount: 0,
        consecutiveGameCount: 0,
        wins: 0,
        losses: 0,
      };
      const nextPlayers = [...players, added];
      setPlayers(nextPlayers);
      syncSessionPlayersToHomeMeetup(nextPlayers);
    },
    [players, clubMembers, syncSessionPlayersToHomeMeetup]
  );

  // 경기 운영 종료 시 회원들의 최종 ELO 레이팅 점수를 localStorage + PostgreSQL DB에 영구 반영 (홈 랭킹 탭 연동)
  const persistFinalEloRatings = useCallback(async () => {
    const eloUpdates = players
      .filter((p) => !p.isGuest && typeof p.memberId === "number")
      .map((p) => ({
        memberId: p.memberId as number,
        eloScore: Math.max(800, Math.round(p.eloScore)),
      }));

    if (eloUpdates.length === 0) return;

    try {
      const raw = localStorage.getItem("dailyminton_member_elos");
      const currentMap: Record<string, number> = raw
        ? (JSON.parse(raw) as Record<string, number>)
        : {};
      eloUpdates.forEach((u) => {
        currentMap[String(u.memberId)] = u.eloScore;
      });
      localStorage.setItem(
        "dailyminton_member_elos",
        JSON.stringify(currentMap)
      );
    } catch {
      // ignore
    }

    setClubMembers((prev) => {
      const updateMap = new Map(
        eloUpdates.map((u) => [u.memberId, u.eloScore])
      );
      return prev.map((m) =>
        updateMap.has(m.id) ? { ...m, eloScore: updateMap.get(m.id) } : m
      );
    });

    try {
      await fetch("/api/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eloUpdates }),
      });
    } catch {
      // ignore
    }
  }, [players]);

  const handleOpenEndSessionModal = useCallback(() => {
    setIsEndSessionModalOpen(true);
  }, []);

  const handleFinalizeAndGoHome = useCallback(async () => {
    await persistFinalEloRatings();
    setIsEndSessionModalOpen(false);
    router.push("/");
  }, [persistFinalEloRatings, router]);

  // 혼복(MIXED_DOUBLE)일 때만 남성 +200 보정 평균을 계산하고, 남복/여복일 때는 원래 ELO 평균을 계산하는 헬퍼
  const computeLiveTeamAvg = useCallback(
    (teamIds: [number, number], matchType: MatchGame["matchType"]): number => {
      const p1 = playerMap.get(teamIds[0]);
      const p2 = playerMap.get(teamIds[1]);
      if (!p1 || !p2) return 0;
      if (matchType === "MIXED_DOUBLE") {
        return Math.round(
          (getEffectiveMatchingElo(p1) + getEffectiveMatchingElo(p2)) / 2
        );
      }
      return Math.round((p1.eloScore + p2.eloScore) / 2);
    },
    [playerMap]
  );

  const renderMatchTeamPlayers = (
    playerIds: [number, number],
    matchId: string,
    matchType: MatchGame["matchType"],
    isDraft: boolean,
    allowSwap: boolean,
    isReservedMatch = false,
    playerRecentOverlapMap?: Record<number, number>
  ) => {
    const isMixed = matchType === "MIXED_DOUBLE";

    return playerIds.map((pid) => {
      const p = playerMap.get(pid);
      if (!p) return null;
      const isFemale = p.gender === "FEMALE";
      const displayElo = isMixed
        ? getEffectiveMatchingElo(p)
        : Math.round(p.eloScore);
      const gradeLabel = isMixed ? getAdjustedGradeLabel(p) : `${p.grade}조`;
      const inGameCourtInfo = playerInGameCourtMap.get(pid);
      const recentOverlapCount = playerRecentOverlapMap?.[pid];

      return (
        <div
          key={pid}
          className={`flex items-center justify-between gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${isFemale
              ? "border-pink-400/35 bg-pink-500/15 text-pink-100"
              : "border-sky-400/35 bg-sky-500/15 text-sky-100"
            }`}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate font-bold">{p.name}</span>
            <span className="rounded bg-black/35 px-1.5 py-0.5 text-xs font-semibold">
              {gradeLabel}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-bold ${isFemale
                  ? "bg-pink-400/20 text-pink-200"
                  : "bg-sky-400/25 text-sky-200"
                }`}
            >
              {displayElo}점{isMixed && !isFemale ? " (남+200)" : ""}
            </span>
            {/* [명세 6번] 운영진용 매칭 다양성 보조 지표: 선수 카드에 최근 5경기 내 현재 조합과의 동반 횟수 표시 */}
            {typeof recentOverlapCount === "number" && (
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-bold ${recentOverlapCount > 0
                    ? "bg-amber-500/25 text-amber-200 ring-1 ring-amber-400/40"
                    : "bg-emerald-500/20 text-emerald-200"
                  }`}
                title="최근 5경기 내 현재 매칭 인원과 함께 뛴 횟수"
              >
                5G동반 {recentOverlapCount}회
              </span>
            )}
            {isReservedMatch &&
              (inGameCourtInfo ? (
                <span className="rounded bg-amber-500/25 px-1.5 py-0.5 text-xs font-bold text-amber-200 ring-1 ring-amber-400/40">
                  {inGameCourtInfo.courtNumber}번코트·투입
                  {inGameCourtInfo.entryRank}순번
                </span>
              ) : (
                <span className="rounded bg-emerald-500/25 px-1.5 py-0.5 text-xs font-bold text-emerald-200">
                  대기인원
                </span>
              ))}
            {p.isGuest && (
              <span className="rounded bg-amber-400/25 px-1 text-xs text-amber-300">
                G
              </span>
            )}
          </div>
          {allowSwap && (
            <button
              type="button"
              onClick={() => {
                if (isDraft && checkPessimisticLockBlocked(matchId)) return;
                setSwapTarget({ matchId, isDraft, oldPlayerId: pid });
              }}
              className="shrink-0 rounded bg-zinc-900/70 px-1.5 py-0.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
            >
              교체
            </button>
          )}
        </div>
      );
    });
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#0d0f14] text-zinc-100">
      {/* 상단 운영 헤더 */}
      <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-[#0d0f14]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-6 sm:py-3.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex items-center justify-between gap-2">
              <Link
                href="/"
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:border-zinc-700 hover:text-white"
              >
                ← 홈으로
              </Link>
              <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-bold text-emerald-300 ring-1 ring-emerald-500/40 sm:hidden">
                LIVE 운영중
              </span>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="min-w-0 break-words text-base font-bold text-white sm:text-xl">
                  {meetup.title} 경기 진행 현황판
                </h1>
                <span className="hidden shrink-0 items-center whitespace-nowrap rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-bold text-emerald-300 ring-1 ring-emerald-500/40 sm:inline-flex">
                  LIVE 운영중
                </span>
              </div>
              <p className="mt-0.5 break-words text-xs text-zinc-400">
                {meetup.location} · {meetup.dateTimeText} · {meetup.feeText}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* 모임장·운영진 전용: 프로필(파트너/기피 설정) & 매칭 결정 로그(90일 보존) & 회원 참석 추가 & 게스트 등록 버튼 */}
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => setIsProfileModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-sky-400/40 bg-sky-500/15 px-3 py-1.5 text-xs font-bold text-sky-200 transition hover:bg-sky-500/25"
                >
                  👤 프로필 · 파트너/기피 설정
                </button>

                <button
                  type="button"
                  onClick={() => setIsDecisionLogModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-indigo-400/40 bg-indigo-500/15 px-3 py-1.5 text-xs font-bold text-indigo-200 transition hover:bg-indigo-500/25"
                >
                  📋 매칭 결정 로그 ({decisionLogs.length})
                </button>

                <button
                  type="button"
                  onClick={() => setIsAddMemberModalOpen(true)}
                  className="rounded-lg border border-zinc-700 bg-zinc-800/90 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-700"
                >
                  + 회원 참석 추가
                </button>

                <button
                  type="button"
                  onClick={() => setIsGuestModalOpen(true)}
                  className="rounded-lg bg-[#5a9cf8] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#488be8]"
                >
                  + 게스트 등록
                </button>
              </>
            )}

            {/* 경기 운영 종료 및 참가자 승률 순위 결산 모달 버튼 */}
            <button
              type="button"
              onClick={handleOpenEndSessionModal}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/45 bg-rose-500/20 px-3 py-1.5 text-xs font-bold text-rose-200 transition hover:bg-rose-500/30"
            >
              🏁 경기 운영 종료
            </button>

            {/* 권한 전환 토글 (모임장·운영진 권한 vs 일반회원 권한) */}
            <button
              type="button"
              onClick={() => {
                setIsAdmin((prev) => {
                  const next = !prev;
                  if (!next) {
                    setManualSelectedIds([]);
                  }
                  return next;
                });
              }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${isAdmin
                  ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                  : "border-zinc-700 bg-zinc-800 text-zinc-400"
                }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${isAdmin ? "bg-amber-400" : "bg-zinc-500"
                  }`}
              />
              {isAdmin ? "운영진 권한" : "일반회원 권한"}
            </button>
          </div>
        </div>
      </header>

      {/* 콕 제출 즉시 알림 배너 */}
      {cockToastMessage && (
        <div className="mx-auto max-w-[1600px] px-4 pt-3 sm:px-6">
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-2.5 text-xs font-medium text-emerald-200 sm:text-sm">
            <span>✅ {cockToastMessage}</span>
            <button
              type="button"
              onClick={() => setCockToastMessage(null)}
              className="ml-4 text-xs text-emerald-300 hover:underline"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* [명세 7번] 운영진 공백(status !== IN_GAME 운영진 0명) 시 자동 노출되는 경고 배너 */}
      {isAdminVacuumDetected && (
        <div className="mx-auto max-w-[1600px] px-4 pt-3 sm:px-6">
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/50 bg-amber-500/15 px-4 py-3 text-xs text-amber-100 sm:text-sm"
          >
            <div className="space-y-0.5">
              <p className="font-extrabold text-amber-300">
                ⚠️ 현재 매칭을 확인할 수 있는 운영진이 없습니다 (코트 밖 가용 운영진 0명)
              </p>
              <p className="text-xs text-amber-200/90 sm:text-sm">
                자동 승인(Auto-Confirm) 모드가 가동 중입니다. 신뢰도 기준(4인 실력 편차 100점 이내 · 직전 1~2경기 재회 0건 · 희망 파트너 미분리)을 만족하는 매칭 제안(DRAFT)에 한해 45초 경과 후 자동으로 확정(CONFIRMED) 상태로 승격됩니다.
              </p>
            </div>
            {activeDraftMatch && (
              <div className="shrink-0">
                {activeDraftMatch.isAutoConfirmEligible ? (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-extrabold text-zinc-950">
                    ⏱️ 자동 승인 대기 중 (
                    {autoConfirmTimerState.draftId === activeDraftMatch.id
                      ? autoConfirmTimerState.remainingSec
                      : 45}
                    초 후 자동 확정)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/50 bg-rose-500/20 px-3 py-1.5 text-xs font-bold text-rose-200">
                    ⏸️ 자동 승인 제외 (운영진 복귀 확인 대기)
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/*
        모바일 및 DOM 기본 순서 (1 -> 2 -> 3 -> 4 -> 5 -> 6):
        1. 정모 참석예정자
        2. 코트현황
        3. 대기현황
        4. 선수현황
        5. 휴식현황
        6. 퇴장현황
      */}
      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
          {/* =====================================================
              1. 정모 참석예정자 리스트 (+ 지정콕 확인 버튼 & 콕 제출 취소 원복 탭)
          ===================================================== */}
          <section
            aria-labelledby="arrived-heading"
            className="rounded-2xl border border-zinc-800/90 bg-[#151821] p-4 lg:col-span-4"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2
                  id="arrived-heading"
                  className="text-lg font-bold text-white"
                >
                  1. 정모 참석예정자 ({arrivedPlayers.length})
                </h2>
                <p className="text-sm text-zinc-400">
                  콕 제출 시 선수현황 이동 · 취소 시 참석예정자로 원복
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                {/* 지정콕 확인 버튼 */}
                <button
                  type="button"
                  onClick={() => setIsDesignatedCockModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-400/45 bg-amber-400/15 px-2.5 py-1.5 text-xs font-bold text-amber-300 transition hover:bg-amber-400/25"
                >
                  🏸 지정콕 확인
                </button>

                {isAdmin &&
                  arrivedPlayers.length > 0 &&
                  arrivedTab === "UNSUBMITTED" && (
                    <button
                      type="button"
                      onClick={handleSubmitAllArrivedCock}
                      className="rounded-lg bg-emerald-600/80 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-600"
                    >
                      전체 콕 제출
                    </button>
                  )}
              </div>
            </div>

            {/* 미제출(참석예정) / 제출완료(제출취소 가능) 전환 탭 */}
            <div className="mb-3 flex items-center gap-1 rounded-lg bg-zinc-900 p-1">
              <button
                type="button"
                onClick={() => setArrivedTab("UNSUBMITTED")}
                className={`flex-1 rounded-md py-1 text-xs font-semibold transition ${arrivedTab === "UNSUBMITTED"
                    ? "bg-zinc-700 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                  }`}
              >
                콕 미제출 ({arrivedPlayers.length}명)
              </button>
              <button
                type="button"
                onClick={() => setArrivedTab("SUBMITTED")}
                className={`flex-1 rounded-md py-1 text-xs font-semibold transition ${arrivedTab === "SUBMITTED"
                    ? "bg-emerald-600/80 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                  }`}
              >
                제출 완료 · 취소 ({cockSummary.submittedCount}명)
              </button>
            </div>

            {arrivedTab === "UNSUBMITTED" ? (
              arrivedPlayers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-500">
                  모든 참석예정자가 콕 제출을 완료하여
                  <br />
                  선수현황으로 이동했습니다.
                </div>
              ) : (
                <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                  {arrivedPlayers.map((player) => (
                    <PlayerBlock
                      key={player.id}
                      player={player}
                      compact
                      actions={
                        <button
                          type="button"
                          onClick={() =>
                            handleSubmitCockAndMoveToActive(player.id, 2)
                          }
                          className="rounded-md bg-emerald-500 px-2.5 py-1 text-xs font-bold text-zinc-950 transition hover:bg-emerald-400"
                        >
                          콕 제출 →
                        </button>
                      }
                    />
                  ))}
                </div>
              )
            ) : cockSummary.submittedList.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-500">
                아직 콕을 제출한 인원이 없습니다.
              </div>
            ) : (
              <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {cockSummary.submittedList.map((player) => (
                  <PlayerBlock
                    key={player.id}
                    player={player}
                    compact
                    actions={
                      <button
                        type="button"
                        onClick={() => handleCancelCockSubmission(player.id)}
                        className="rounded-md border border-rose-400/40 bg-rose-500/20 px-2.5 py-1 text-xs font-bold text-rose-200 transition hover:bg-rose-500/35"
                      >
                        제출 취소 ↩
                      </button>
                    }
                  />
                ))}
              </div>
            )}
          </section>

          {/* =====================================================
              2. 코트현황 (게임 진행 인원)
          ===================================================== */}
          <section
            aria-labelledby="court-status-heading"
            className="rounded-2xl border border-zinc-800/90 bg-[#151821] p-4 lg:col-span-8"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2
                  id="court-status-heading"
                  className="text-lg font-bold text-white"
                >
                  2. 코트현황 · 게임 진행 인원 ({activeCourtMatches.length}/
                  {courts.filter((c) => c.isActive).length}코트 사용중)
                </h2>
                <p className="text-sm text-zinc-400">
                  승패 선택 시 실시간 ELO가 반영되고 선수현황으로 복귀합니다
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {courts.map((court) => {
                const currentMatch = activeCourtMatches.find(
                  (m) => m.id === court.currentMatchId
                );
                const courtEntryRank = currentMatch
                  ? courtEntryRankMap.get(currentMatch.id)
                  : undefined;

                return (
                  <div
                    key={court.courtNumber}
                    className={`rounded-xl border p-3 transition ${!court.isActive
                        ? "border-zinc-800/50 bg-zinc-900/30 opacity-60"
                        : currentMatch
                          ? "border-emerald-500/45 bg-emerald-950/15"
                          : "border-zinc-800 bg-zinc-900/50"
                      }`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-bold text-white">
                          {court.courtNumber}번 코트
                        </span>
                        {currentMatch ? (
                          <>
                            {courtEntryRank !== undefined && (
                              <span className="rounded bg-amber-400/25 px-1.5 py-0.5 text-xs font-bold text-amber-300 ring-1 ring-amber-400/45">
                                투입 {courtEntryRank}순번
                              </span>
                            )}
                            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs font-bold text-emerald-300">
                              {MATCH_TYPE_LABEL[currentMatch.matchType]} 진행중
                            </span>
                          </>
                        ) : (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
                            {court.isActive ? "빈 코트" : "비활성"}
                          </span>
                        )}
                      </div>

                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() =>
                            handleToggleCourtActive(court.courtNumber)
                          }
                          className="text-xs text-zinc-400 hover:text-zinc-200"
                        >
                          {court.isActive ? "비활성화" : "활성화"}
                        </button>
                      )}
                    </div>

                    {currentMatch ? (
                      <div className="space-y-2">
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-sky-300">
                            A팀 ({currentMatch.matchType === "MIXED_DOUBLE" ? "보정평균" : "평균"}{" "}
                            {computeLiveTeamAvg(
                              currentMatch.teamA,
                              currentMatch.matchType
                            )}
                            )
                          </div>
                          {renderMatchTeamPlayers(
                            currentMatch.teamA,
                            currentMatch.id,
                            currentMatch.matchType,
                            false,
                            false
                          )}
                        </div>

                        <div className="text-center text-xs font-bold text-zinc-500">
                          VS
                        </div>

                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-pink-300">
                            B팀 ({currentMatch.matchType === "MIXED_DOUBLE" ? "보정평균" : "평균"}{" "}
                            {computeLiveTeamAvg(
                              currentMatch.teamB,
                              currentMatch.matchType
                            )}
                            )
                          </div>
                          {renderMatchTeamPlayers(
                            currentMatch.teamB,
                            currentMatch.id,
                            currentMatch.matchType,
                            false,
                            false
                          )}
                        </div>

                        {isAdmin && (
                          <div className="mt-2.5 grid grid-cols-2 gap-1.5 pt-1">
                            <button
                              type="button"
                              onClick={() =>
                                handleFinishCourtMatch(currentMatch.id, "A")
                              }
                              className="rounded-lg bg-sky-500/80 py-1.5 text-xs font-bold text-white transition hover:bg-sky-500"
                            >
                              A팀 승
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleFinishCourtMatch(currentMatch.id, "B")
                              }
                              className="rounded-lg bg-pink-500/80 py-1.5 text-xs font-bold text-white transition hover:bg-pink-500"
                            >
                              B팀 승
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleFinishCourtMatch(currentMatch.id, null)
                              }
                              className="rounded-lg border border-zinc-700 bg-zinc-800 py-1 text-xs font-medium text-zinc-300 transition hover:bg-zinc-700"
                            >
                              승패미입력
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleUnassignCourtMatch(currentMatch.id)
                              }
                              className="rounded-lg border border-zinc-700 bg-zinc-800 py-1 text-xs font-medium text-amber-300 transition hover:bg-zinc-700"
                            >
                              전원미배정
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex h-28 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800/80 text-xs text-zinc-500">
                        {court.isActive ? (
                          isAdmin && waitingMatches.length > 0 ? (
                            <button
                              type="button"
                              onClick={() =>
                                handleAssignMatchToCourt(
                                  waitingMatches[0].id,
                                  court.courtNumber
                                )
                              }
                              className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/40 transition hover:bg-emerald-500/30"
                            >
                              + 대기 1순위 팀 투입
                            </button>
                          ) : (
                            <span>
                              {isAdmin
                                ? "대기현황에서 게임을 투입하세요"
                                : "대기 중인 빈 코트"}
                            </span>
                          )
                        ) : (
                          <span>미사용 코트</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* =====================================================
              3. 대기현황 (게임에 투입 예정 인원)
          ===================================================== */}
          <section
            aria-labelledby="waiting-queue-heading"
            className="rounded-2xl border border-zinc-800/90 bg-[#151821] p-4 lg:col-span-6"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    id="waiting-queue-heading"
                    className="text-lg font-bold text-white"
                  >
                    3. 대기현황 · 게임 투입 예정 ({waitingMatches.length}팀)
                  </h2>
                  {isReservationModeActive && (
                    <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-bold text-amber-300 ring-1 ring-amber-400/40">
                      📌 예약매칭 자동 활성화됨 (대기 3인 이하)
                    </span>
                  )}
                  <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-semibold text-zinc-300">
                    동반자 하드블록(대기+휴식 {activeEligiblePoolSize}명):{" "}
                    {currentDynamicHardBlockGap === 2
                      ? "직전 2경기 제외"
                      : currentDynamicHardBlockGap === 1
                        ? `직전 1경기 축소(${hardBlockThresholds.reduceToOneGameBelow}명 미만)`
                        : `완전 해제·소프트페널티(${hardBlockThresholds.disableBelow}명 미만)`}
                  </span>
                </div>
                <p className="text-sm text-zinc-400">
                  {isReservationModeActive
                    ? "선수현황 대기 인원(3인 이하)과 선투입 코트 인원을 혼합해 예약매칭이 자동 구성됩니다"
                    : "코트 투입 전까지 멤버 교체가 가능합니다"}
                </p>
              </div>

              <div className="flex items-center gap-1 rounded-lg bg-zinc-900 p-1">
                {(
                  [
                    ["ALL", "전체"],
                    ["MEN_DOUBLE", "남복"],
                    ["WOMEN_DOUBLE", "여복"],
                    ["MIXED_DOUBLE", "혼복"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setQueueFilter(key)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${queueFilter === key
                        ? "bg-[#5a9cf8] text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                      }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* [명세 7번] 운영진 복귀 시 확인 및 사후 취소·재조정이 가능한 자동 승인(Auto-Confirmed) 매칭 전용 안내 패널 */}
            {waitingMatches.some((m) => m.autoConfirmed) && (
              <div className="mb-3 rounded-xl border border-amber-400/45 bg-amber-500/10 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-extrabold text-amber-200">
                      🤖 운영진 공백 중 시스템이 자동 승인(Auto-Confirm)한 매칭{" "}
                      {waitingMatches.filter((m) => m.autoConfirmed).length}건
                    </p>
                    <p className="mt-0.5 text-xs text-amber-200/80">
                      신뢰도 기준(실력 편차 100점 이내 · 직전 1~2경기 재회 0건 · 희망 파트너 미분리)을 통과해 45초 경과 후 자동 확정된 목록입니다. 복귀한 운영진은 필요 시 사후 재조정(멤버 바꾸기)하거나 승인 취소할 수 있습니다.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 자동매칭 / 예약매칭 제안 카드(Draft) - 모임장·운영진 또는 운영진 공백 시 자동 승인 대기 중 노출 */}
            {(isAdmin || isAdminVacuumDetected) &&
              activeDraftMatch &&
              (() => {
                const isMixed = activeDraftMatch.matchType === "MIXED_DOUBLE";
                const isReserved = Boolean(activeDraftMatch.isReservedMatch);
                const liveAvgA = computeLiveTeamAvg(
                  activeDraftMatch.teamA,
                  activeDraftMatch.matchType
                );
                const liveAvgB = computeLiveTeamAvg(
                  activeDraftMatch.teamB,
                  activeDraftMatch.matchType
                );
                const liveDiff = Math.abs(liveAvgA - liveAvgB);
                const recentOverlap =
                  activeDraftMatch.recentFiveOverlapCount ?? 0;

                return (
                  <div
                    className={`mb-4 rounded-xl border-2 p-3.5 ${isReserved
                        ? "border-amber-400 bg-amber-500/10"
                        : "border-[#5a9cf8] bg-[#5a9cf8]/10"
                      }`}
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {isReserved ? (
                          <span className="rounded bg-amber-400 px-2 py-0.5 text-xs font-extrabold text-zinc-950">
                            📌 예약매칭 제안 (Draft)
                          </span>
                        ) : (
                          <span className="rounded bg-[#5a9cf8] px-2 py-0.5 text-xs font-bold text-white">
                            자동매칭 제안 (Draft)
                          </span>
                        )}
                        <span className="text-xs font-bold text-zinc-200">
                          {MATCH_TYPE_LABEL[activeDraftMatch.matchType]}
                        </span>
                        {/* [명세 6번] 운영진용 매칭 다양성 보조 지표: 최근 5경기 내 이 조합과 몇 번 함께 뛰었는지 배지 표시 */}
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-bold ${recentOverlap === 0
                              ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40"
                              : "bg-amber-500/25 text-amber-200 ring-1 ring-amber-400/50"
                            }`}
                        >
                          {recentOverlap === 0
                            ? "✨ 최근 5경기 동반 0회 (새 조합)"
                            : `🔄 최근 5경기 내 동반 ${recentOverlap}회`}
                        </span>
                        {typeof activeDraftMatch.groupSpread === "number" && (
                          <span className="rounded bg-zinc-900/80 px-2 py-0.5 text-xs font-semibold text-zinc-300">
                            4인 개인편차 {activeDraftMatch.groupSpread}점
                          </span>
                        )}
                        {/* [명세 5번] 예약매칭 조건 완화 시 필수 경고 배지 */}
                        {activeDraftMatch.isRelaxedReservation && (
                          <span className="rounded-md bg-rose-500/25 px-2.5 py-0.5 text-xs font-extrabold text-rose-200 ring-1 ring-rose-400/50">
                            ⚠️ 조건을 완화하여 생성된 예약매칭입니다
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-xs ${isReserved ? "text-amber-200" : "text-blue-200"
                          }`}
                      >
                        {activeDraftMatch.reasonSummary.split("|")[0]?.trim()} |{" "}
                        {isMixed
                          ? `팀 보정 ELO 편차 ${liveDiff}점`
                          : `팀 ELO 편차 ${liveDiff}점`}
                      </span>
                    </div>

                    {/* [명세 7번] 운영진 공백 시 신뢰도 기준 충족 여부에 따른 자동 승인 상태 표시 */}
                    {isAdminVacuumDetected && (
                      <div
                        className={`mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs ${activeDraftMatch.isAutoConfirmEligible
                            ? "border-emerald-400/45 bg-emerald-500/15 text-emerald-200"
                            : "border-rose-400/45 bg-rose-500/15 text-rose-200"
                          }`}
                      >
                        {activeDraftMatch.isAutoConfirmEligible ? (
                          <span>
                            🤖 <strong>자동 승인 신뢰도 기준 충족</strong> (개인
                            편차 {activeDraftMatch.groupSpread ?? 0}점 ≤ 100점 ·
                            직전 1~2경기 재회 0건) —{" "}
                            <strong>
                              {autoConfirmTimerState.draftId ===
                                activeDraftMatch.id
                                ? autoConfirmTimerState.remainingSec
                                : 45}
                              초
                            </strong>{" "}
                            경과 후 자동으로 CONFIRMED 승격됩니다.
                          </span>
                        ) : (
                          <span>
                            ⏸️ <strong>자동 승인 제외 대상</strong>:{" "}
                            {activeDraftMatch.autoConfirmExcludeReason ??
                              "실력 편차 100점 초과 또는 파트너 조건 검토 필요"}{" "}
                            (운영진 복귀 후 수동 확인 대기)
                          </span>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <div className="text-xs font-semibold text-sky-300">
                          A팀 ({isMixed ? "보정평균" : "평균"} {liveAvgA})
                        </div>
                        {renderMatchTeamPlayers(
                          activeDraftMatch.teamA,
                          activeDraftMatch.id,
                          activeDraftMatch.matchType,
                          true,
                          isAdmin,
                          isReserved,
                          activeDraftMatch.playerRecentOverlapMap
                        )}
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs font-semibold text-pink-300">
                          B팀 ({isMixed ? "보정평균" : "평균"} {liveAvgB})
                        </div>
                        {renderMatchTeamPlayers(
                          activeDraftMatch.teamB,
                          activeDraftMatch.id,
                          activeDraftMatch.matchType,
                          true,
                          isAdmin,
                          isReserved,
                          activeDraftMatch.playerRecentOverlapMap
                        )}
                      </div>
                    </div>

                    {isAdmin && (
                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (checkPessimisticLockBlocked(activeDraftMatch.id))
                              return;
                            setDraftMatch(null);
                            if (isReserved) {
                              setDismissedAutoReservationSig(
                                currentReservationStateSig
                              );
                            }
                          }}
                          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
                        >
                          제안 취소
                        </button>
                        <button
                          type="button"
                          onClick={handleRematchDraftByElo}
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-400/50 bg-amber-500/20 px-3.5 py-1.5 text-xs font-bold text-amber-200 transition hover:bg-amber-500/35"
                        >
                          🔄 멤버 바꾸기
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConfirmDraftToQueue(false)}
                          className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition ${isReserved
                              ? "bg-amber-400 text-zinc-950 hover:bg-amber-300"
                              : "bg-[#5a9cf8] text-white hover:bg-[#488be8]"
                            }`}
                        >
                          {isReserved
                            ? "예약매칭 대기현황 확정"
                            : "대기현황에 확정 등록"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

            {filteredWaitingMatches.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-500">
                현재 대기현황에 등록된 게임이 없습니다.
                {isAdmin && (
                  <>
                    <br />
                    선수현황에서 <strong>⚡ 자동매칭</strong> 버튼을 누르거나
                    4명을 선택해 추가하세요.
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredWaitingMatches.map((match, idx) => {
                  const isMixed = match.matchType === "MIXED_DOUBLE";
                  const isReserved = Boolean(match.isReservedMatch);
                  const liveAvgA = computeLiveTeamAvg(
                    match.teamA,
                    match.matchType
                  );
                  const liveAvgB = computeLiveTeamAvg(
                    match.teamB,
                    match.matchType
                  );
                  const liveDiff = Math.abs(liveAvgA - liveAvgB);
                  const recentOverlap = match.recentFiveOverlapCount ?? 0;

                  return (
                    <div
                      key={match.id}
                      className={`rounded-xl border p-3.5 ${match.autoConfirmed
                          ? "border-emerald-400/60 bg-emerald-950/15"
                          : isReserved
                            ? "border-amber-500/50 bg-amber-950/15"
                            : "border-zinc-800 bg-zinc-900/70"
                        }`}
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-bold text-white">
                            대기 {idx + 1}순위
                          </span>
                          {match.autoConfirmed && (
                            <span className="rounded bg-emerald-400 px-2 py-0.5 text-xs font-extrabold text-zinc-950">
                              🤖 운영진부재 자동승인{" "}
                              {match.autoConfirmedAt
                                ? `(${match.autoConfirmedAt})`
                                : ""}
                            </span>
                          )}
                          {isReserved && (
                            <span className="rounded bg-amber-400 px-2 py-0.5 text-xs font-extrabold text-zinc-950">
                              📌 예약매칭
                            </span>
                          )}
                          {match.isRelaxedReservation && (
                            <span className="rounded-md bg-rose-500/25 px-2.5 py-0.5 text-xs font-extrabold text-rose-200 ring-1 ring-rose-400/50">
                              ⚠️ 조건을 완화하여 생성된 예약매칭입니다
                            </span>
                          )}
                          <span className="rounded bg-blue-500/20 px-2 py-0.5 text-xs font-semibold text-blue-300">
                            {MATCH_TYPE_LABEL[match.matchType]}
                          </span>
                          {/* [명세 6번] 운영진용 매칭 다양성 보조 지표 */}
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-bold ${recentOverlap === 0
                                ? "bg-emerald-500/20 text-emerald-200"
                                : "bg-amber-500/25 text-amber-200"
                              }`}
                          >
                            {recentOverlap === 0
                              ? "✨ 최근 5경기 동반 0회"
                              : `🔄 최근 5경기 내 동반 ${recentOverlap}회`}
                          </span>
                          <span className="text-xs text-zinc-400">
                            {match.reasonSummary.split("|")[0]?.trim()} |{" "}
                            {isMixed
                              ? `팀 보정 ELO 편차 ${liveDiff}점`
                              : `팀 ELO 편차 ${liveDiff}점`}
                          </span>
                        </div>

                        {isAdmin && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                handleRematchWaitingMatchByElo(match.id)
                              }
                              className="rounded-lg border border-amber-400/50 bg-amber-500/20 px-2.5 py-1 text-xs font-bold text-amber-200 transition hover:bg-amber-500/35"
                            >
                              {match.autoConfirmed
                                ? "🔄 사후 재조정 (멤버 바꾸기)"
                                : "🔄 멤버 바꾸기"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAssignMatchToCourt(match.id)}
                              className="rounded-lg bg-emerald-500 px-2.5 py-1 text-xs font-bold text-zinc-950 transition hover:bg-emerald-400"
                            >
                              코트 투입
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCancelWaitingMatch(match.id)}
                              className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-300 transition hover:bg-zinc-700"
                            >
                              {match.autoConfirmed
                                ? "승인 취소·미배정"
                                : "전원미배정"}
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-sky-300">
                            A팀 ({isMixed ? "보정평균" : "평균"} {liveAvgA})
                          </div>
                          {renderMatchTeamPlayers(
                            match.teamA,
                            match.id,
                            match.matchType,
                            false,
                            isAdmin,
                            isReserved,
                            match.playerRecentOverlapMap
                          )}
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-pink-300">
                            B팀 ({isMixed ? "보정평균" : "평균"} {liveAvgB})
                          </div>
                          {renderMatchTeamPlayers(
                            match.teamB,
                            match.id,
                            match.matchType,
                            false,
                            isAdmin,
                            isReserved,
                            match.playerRecentOverlapMap
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* =====================================================
              4. 선수현황 (이름 검색, 대기순/경기순/급수순, 휴식/퇴장 이동, 자동매칭)
          ===================================================== */}
          <section
            aria-labelledby="active-players-heading"
            className="rounded-2xl border border-zinc-800/90 bg-[#151821] p-4 lg:col-span-6"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2
                  id="active-players-heading"
                  className="text-lg font-bold text-white"
                >
                  4. 선수현황 ({waitingPlayers.length}명 대기중)
                </h2>
                <p className="text-sm text-zinc-400">
                  {isAdmin
                    ? `클릭 시 수동매칭 선택 (${manualSelectedIds.length}/4명)`
                    : "휴식 및 퇴장 상태 전환이 가능합니다"}
                </p>
              </div>

              {isAdmin && (
                <div className="flex items-center gap-1.5">
                  {manualSelectedIds.length === 4 && (
                    <button
                      type="button"
                      onClick={handleCreateManualMatch}
                      className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-zinc-950 transition hover:bg-amber-400"
                    >
                      선택 4인 매칭 등록
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleAutoMatch}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold shadow-sm transition ${isReservationModeActive
                        ? "bg-amber-400 text-zinc-950 hover:bg-amber-300"
                        : "bg-[#5a9cf8] text-white hover:bg-[#488be8]"
                      }`}
                  >
                    {isReservationModeActive ? "📌 예약매칭" : "⚡ 자동매칭"}
                  </button>
                </div>
              )}
            </div>

            {/* 이름 검색 & 대기순 / 경기순 / 급수순 정렬 바 */}
            <div className="mb-3 space-y-2">
              <search>
                <div className="relative">
                  <label htmlFor="player-search-input" className="sr-only">
                    선수 이름 검색
                  </label>
                  <input
                    id="player-search-input"
                    type="search"
                    value={playerSearch}
                    onChange={(e) => setPlayerSearch(e.target.value)}
                    placeholder="선수 이름 또는 닉네임 검색..."
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900/90 py-2 pr-8 pl-3 text-xs text-zinc-100 outline-none transition focus:border-[#5a9cf8]"
                  />
                  {playerSearch && (
                    <button
                      type="button"
                      onClick={() => setPlayerSearch("")}
                      aria-label="검색어 지우기"
                      className="absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-zinc-400 hover:text-zinc-200"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </search>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 rounded-lg bg-zinc-900 p-1">
                  {(
                    [
                      ["WAIT_ORDER", "대기순"],
                      ["GAME_COUNT", "경기순"],
                      ["GRADE_ORDER", "급수순"],
                    ] as const
                  ).map(([opt, label]) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setPlayerSort(opt)}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${playerSort === opt
                          ? "bg-zinc-700 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                        }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {manualSelectedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setManualSelectedIds([])}
                    className="text-xs text-zinc-400 hover:text-zinc-200"
                  >
                    선택 해제 ({manualSelectedIds.length})
                  </button>
                )}
              </div>
            </div>

            {waitingPlayers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 py-10 text-center text-xs text-zinc-500">
                현재 대기 중인 선수가 없습니다.
                <br />
                <strong>1. 정모 참석예정자</strong>에서{" "}
                <strong>콕 제출</strong>을 눌러주세요.
              </div>
            ) : (
              <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
                {waitingPlayers.map((player) => (
                  <PlayerBlock
                    key={player.id}
                    player={player}
                    selected={isAdmin && manualSelectedIds.includes(player.id)}
                    onClick={
                      isAdmin
                        ? () => handleToggleManualSelect(player.id)
                        : undefined
                    }
                    actions={
                      <>
                        {player.cockSubmitted && (
                          <button
                            type="button"
                            onClick={() =>
                              handleCancelCockSubmission(player.id)
                            }
                            className="rounded-md border border-zinc-700 bg-zinc-800/90 px-2 py-1 text-xs font-semibold text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-700 hover:text-white"
                            title="콕 제출을 취소하고 정모 참석예정자 리스트로 되돌립니다"
                          >
                            제출취소
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            handleMovePlayerStatus(player.id, "RESTING")
                          }
                          className="rounded-md bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/35"
                        >
                          휴식
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleMovePlayerStatus(player.id, "LEFT")
                          }
                          className="rounded-md bg-rose-500/20 px-2.5 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/35"
                        >
                          퇴장
                        </button>
                      </>
                    }
                  />
                ))}
              </div>
            )}
          </section>

          {/* =====================================================
              5. 휴식현황 (휴식 인원)
          ===================================================== */}
          <section
            aria-labelledby="resting-heading"
            className="rounded-2xl border border-zinc-800/90 bg-[#151821] p-4 lg:col-span-6"
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2
                  id="resting-heading"
                  className="text-lg font-bold text-amber-300"
                >
                  5. 휴식현황 ({restingPlayers.length})
                </h2>
                <p className="text-sm text-zinc-400">
                  자동매칭 대상에서 일시 제외된 휴식 인원
                </p>
              </div>
            </div>

            {restingPlayers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 py-6 text-center text-xs text-zinc-500">
                현재 휴식 중인 인원이 없습니다.
              </div>
            ) : (
              <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
                {restingPlayers.map((player) => (
                  <PlayerBlock
                    key={player.id}
                    player={player}
                    compact
                    actions={
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            handleMovePlayerStatus(player.id, "WAITING")
                          }
                          className="rounded-md bg-sky-500/25 px-2 py-1 text-xs font-semibold text-sky-200 transition hover:bg-sky-500/40"
                        >
                          선수복귀
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleMovePlayerStatus(player.id, "LEFT")
                          }
                          className="rounded-md bg-rose-500/20 px-2 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/35"
                        >
                          퇴장
                        </button>
                      </>
                    }
                  />
                ))}
              </div>
            )}
          </section>

          {/* =====================================================
              6. 퇴장현황 (퇴장 인원)
          ===================================================== */}
          <section
            aria-labelledby="left-heading"
            className="rounded-2xl border border-zinc-800/90 bg-[#151821] p-4 lg:col-span-6"
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2
                  id="left-heading"
                  className="text-lg font-bold text-rose-300"
                >
                  6. 퇴장현황 ({leftPlayers.length})
                </h2>
                <p className="text-sm text-zinc-400">
                  체육관에서 퇴장 처리된 인원
                </p>
              </div>
            </div>

            {leftPlayers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 py-6 text-center text-xs text-zinc-500">
                퇴장 처리된 인원이 없습니다.
              </div>
            ) : (
              <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
                {leftPlayers.map((player) => (
                  <PlayerBlock
                    key={player.id}
                    player={player}
                    compact
                    actions={
                      <button
                        type="button"
                        onClick={() =>
                          handleMovePlayerStatus(player.id, "WAITING")
                        }
                        className="rounded-md bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-300 transition hover:bg-zinc-700"
                      >
                        복귀
                      </button>
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* 지정콕 확인 팝업 (삼화더블랙, 삼화900, KBB79, 보본365, 닉텐블랙) */}
      <Modal
        isOpen={isDesignatedCockModalOpen}
        onClose={() => setIsDesignatedCockModalOpen(false)}
        title="🏸 데일리민턴 지정콕 안내 및 제출 현황"
      >
        <div className="space-y-4 text-sm">
          <div className="rounded-xl border border-amber-400/35 bg-amber-500/10 p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-amber-300">
                우리 모임 공식 지정콕 (총 5종)
              </span>
              <span className="rounded bg-amber-400/20 px-2 py-0.5 text-xs font-semibold text-amber-200">
                1인당 지정콕 2개 제출
              </span>
            </div>

            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {DESIGNATED_SHUTTLECOCKS.map((cock, idx) => (
                <li
                  key={cock.name}
                  className="flex items-center justify-between rounded-lg border border-zinc-800 bg-[#151821] px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/20 text-xs font-bold text-amber-300">
                      {idx + 1}
                    </span>
                    <span className="font-bold text-white">{cock.name}</span>
                  </div>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs font-medium text-zinc-300">
                    {cock.tag}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* 제출 현황 요약 */}
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-center">
            <div>
              <div className="text-xs text-zinc-400">총 참석 인원</div>
              <div className="mt-0.5 text-base font-bold text-white">
                {cockSummary.totalParticipants}명
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-400">제출 완료</div>
              <div className="mt-0.5 text-base font-bold text-emerald-400">
                {cockSummary.submittedCount}명
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-400">누적 셔틀콕</div>
              <div className="mt-0.5 text-base font-bold text-[#5a9cf8]">
                {cockSummary.totalCocks}개
              </div>
            </div>
          </div>

          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {players.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-zinc-100">{p.name}</span>
                  <span className="text-zinc-400">({p.grade}조)</span>
                </div>
                {p.cockSubmitted ? (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-emerald-400">
                      제출 완료 ({p.cockQuantity}개 · {p.cockSubmittedAt})
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCancelCockSubmission(p.id)}
                      className="rounded border border-rose-400/40 bg-rose-500/20 px-2 py-0.5 text-xs font-bold text-rose-200 transition hover:bg-rose-500/35"
                    >
                      제출 취소
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSubmitCockAndMoveToActive(p.id, 2)}
                    className="rounded bg-emerald-500 px-2 py-0.5 text-xs font-bold text-zinc-950 hover:bg-emerald-400"
                  >
                    콕 제출 처리
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {/* 멤버 바꾸기(개별 슬롯 수동 교체) 모달 */}
      <Modal
        isOpen={swapTarget !== null}
        onClose={() => setSwapTarget(null)}
        title="대기 인원(또는 코트 선투입 인원)으로 멤버 교체"
      >
        <div className="space-y-3 text-sm">
          <p className="text-xs text-zinc-400">
            교체할 선수를 아래 명단에서 선택하세요.
          </p>
          {(() => {
            const targetMatchForSwap = swapTarget?.isDraft
              ? activeDraftMatch
              : waitingMatches.find((m) => m.id === swapTarget?.matchId);
            const remainingThreePlayers = targetMatchForSwap
              ? [...targetMatchForSwap.teamA, ...targetMatchForSwap.teamB]
                .filter((id) => id !== swapTarget?.oldPlayerId)
                .map((id) => playerMap.get(id))
                .filter((p): p is SessionPlayer => p !== undefined)
              : [];

            const rawSwapCandidates = [
              ...waitingPlayers,
              ...courtOrderedPlayers.filter(
                (cp) => !reservedPlayerIds.has(cp.id)
              ),
            ];

            // 남은 3명의 선수와 기피 관계가 있는 후보는 교체 목록에서도 보이지 않도록 필터링
            const swapCandidates = rawSwapCandidates.filter(
              (candidate) =>
                !remainingThreePlayers.some((rem) =>
                  hasAvoidConflict(candidate, rem, preferencesMap)
                )
            );
            if (swapCandidates.length === 0) {
              return (
                <div className="py-6 text-center text-xs text-zinc-500">
                  교체 가능한 후보 선수가 없습니다.
                </div>
              );
            }
            return (
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {swapCandidates.map((candidate) => {
                  const cInfo = playerInGameCourtMap.get(candidate.id);
                  return (
                    <PlayerBlock
                      key={candidate.id}
                      player={candidate}
                      compact
                      actions={
                        <div className="flex items-center gap-1.5">
                          {cInfo ? (
                            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-bold text-amber-300">
                              {cInfo.courtNumber}번코트·{cInfo.entryRank}순번
                            </span>
                          ) : (
                            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs font-bold text-emerald-300">
                              선수현황 대기
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleReplaceMember(candidate.id)}
                            className="rounded-md bg-[#5a9cf8] px-2.5 py-1 text-xs font-bold text-white hover:bg-[#488be8]"
                          >
                            이 선수로 교체
                          </button>
                        </div>
                      }
                    />
                  );
                })}
              </div>
            );
          })()}
        </div>
      </Modal>

      {/* 게스트 즉석 등록 모달 */}
      <Modal
        isOpen={isGuestModalOpen}
        onClose={() => setIsGuestModalOpen(false)}
        title="게스트 즉석 등록"
      >
        <form onSubmit={handleRegisterGuest} className="space-y-4 text-sm">
          <div>
            <label
              htmlFor="guest-name-input"
              className="mb-1 block font-semibold text-zinc-300"
            >
              게스트 이름 (또는 별칭)
            </label>
            <input
              id="guest-name-input"
              type="text"
              required
              placeholder="예: 홍길동(게스트)"
              value={guestForm.name}
              onChange={(e) =>
                setGuestForm((prev) => ({ ...prev, name: e.target.value }))
              }
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-[#5a9cf8]"
            />
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label
                htmlFor="guest-gender-select"
                className="mb-1 block font-semibold text-zinc-300"
              >
                성별
              </label>
              <select
                id="guest-gender-select"
                value={guestForm.gender}
                onChange={(e) =>
                  setGuestForm((prev) => ({
                    ...prev,
                    gender: e.target.value as Gender,
                  }))
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-zinc-100 outline-none"
              >
                <option value="MALE">남성</option>
                <option value="FEMALE">여성</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="guest-grade-select"
                className="mb-1 block font-semibold text-zinc-300"
              >
                급수 (S~G)
              </label>
              <select
                id="guest-grade-select"
                value={guestForm.grade}
                onChange={(e) =>
                  setGuestForm((prev) => ({
                    ...prev,
                    grade: e.target.value as Grade,
                  }))
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-zinc-100 outline-none"
              >
                {(["S", "A", "B", "C", "D", "E", "F", "G"] as const).map(
                  (g) => (
                    <option key={g} value={g}>
                      {g}조
                    </option>
                  )
                )}
              </select>
            </div>

            <div>
              <label
                htmlFor="guest-age-select"
                className="mb-1 block font-semibold text-zinc-300"
              >
                연령대
              </label>
              <select
                id="guest-age-select"
                value={guestForm.ageGroup}
                onChange={(e) =>
                  setGuestForm((prev) => ({
                    ...prev,
                    ageGroup: e.target.value as AgeGroup,
                  }))
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-zinc-100 outline-none"
              >
                <option value="UNDER_10">10대 미만</option>
                <option value="20S">20대</option>
                <option value="30S">30대</option>
                <option value="40S">40대</option>
                <option value="50S">50대</option>
                <option value="60S">60대</option>
                <option value="OVER_70">70대 이상</option>
              </select>
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsGuestModalOpen(false)}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
            >
              취소
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[#5a9cf8] px-4 py-2 text-xs font-bold text-white hover:bg-[#488be8]"
            >
              참석예정자에 게스트 추가
            </button>
          </div>
        </form>
      </Modal>

      {/* 회원 참석예정자 추가 모달 (검색 + 넓은 크기) */}
      <Modal
        isOpen={isAddMemberModalOpen}
        onClose={() => {
          setIsAddMemberModalOpen(false);
          setAddMemberSearch("");
        }}
        title={`모임 회원 참석예정자 추가 (미참석 ${unaddedClubMembers.length}명)`}
        size="4xl"
      >
        <div className="space-y-4">
          <search>
            <label htmlFor="add-member-search-input" className="sr-only">
              참석예정자로 추가할 회원 검색
            </label>
            <div className="relative">
              <input
                id="add-member-search-input"
                type="search"
                value={addMemberSearch}
                onChange={(e) => setAddMemberSearch(e.target.value)}
                placeholder="회원 이름, 닉네임 또는 급수(예: S조, A조) 검색..."
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 py-2.5 pr-9 pl-4 text-sm text-zinc-100 outline-none transition focus:border-[#5a9cf8]"
              />
              {addMemberSearch && (
                <button
                  type="button"
                  onClick={() => setAddMemberSearch("")}
                  aria-label="검색어 지우기"
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-zinc-400 hover:text-zinc-200"
                >
                  ✕
                </button>
              )}
            </div>
          </search>

          {(() => {
            const kw = addMemberSearch.trim().toLowerCase();
            const filteredMembers = kw
              ? unaddedClubMembers.filter(
                (m) =>
                  m.name.toLowerCase().includes(kw) ||
                  m.nickname.toLowerCase().includes(kw) ||
                  `${m.grade}조`.toLowerCase().includes(kw)
              )
              : unaddedClubMembers;

            if (filteredMembers.length === 0) {
              return (
                <div className="rounded-xl border border-dashed border-zinc-800 py-12 text-center text-sm text-zinc-500">
                  {unaddedClubMembers.length === 0
                    ? "모든 모임 회원이 이미 참석예정자(또는 경기)에 추가되어 있습니다."
                    : "검색어와 일치하는 회원이 없습니다."}
                </div>
              );
            }

            return (
              <div className="grid max-h-[58vh] grid-cols-1 gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2">
                {filteredMembers.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/75 px-3.5 py-2.5 text-sm"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-bold text-white">{m.name}</span>
                      <GenderBadge
                        gender={m.gender}
                        grade={m.grade}
                        ageGroup={m.ageGroup}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAddClubMemberToSession(m.id)}
                      className="shrink-0 whitespace-nowrap rounded-lg bg-[#5a9cf8] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#488be8]"
                    >
                      + 참석예정 추가
                    </button>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </Modal>

      {/* 경기 진행 중 프로필(희망 파트너 지정 · 기피 인원 설정) 모달 - PC/태블릿에서도 넓게 보이도록 size="4xl" 적용 */}
      <Modal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        title="👤 프로필 · 희망 파트너(2명) 및 기피 인원(3명) 설정"
        size="4xl"
      >
        <div className="max-h-[80vh] overflow-x-hidden overflow-y-auto pr-1">
          <ProfileSection
            members={clubMembers}
            onUpdateMemberProfile={(memberId, updates) => {
              setClubMembers((prev) =>
                prev.map((m) =>
                  m.id === memberId
                    ? {
                      ...m,
                      ...updates,
                      avatarGradient: getAvatarGradientByGender(
                        updates.gender ?? m.gender,
                        m.role
                      ),
                    }
                    : m
                )
              );
              setPlayers((prev) =>
                prev.map((p) =>
                  p.memberId === memberId
                    ? {
                      ...p,
                      name: updates.name ?? p.name,
                      nickname: updates.nickname ?? p.nickname,
                      gender: updates.gender ?? p.gender,
                      grade: updates.grade ?? p.grade,
                      ageGroup: updates.ageGroup ?? p.ageGroup,
                      injuryLevel: updates.injuryLevel ?? p.injuryLevel,
                    }
                    : p
                )
              );
              fetch("/api/members", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ memberId, ...updates }),
              }).catch(() => {
                // ignore
              });
            }}
            onPreferencesUpdated={(nextMap) => {
              setPreferencesMap(nextMap);
              if (draftMatch) {
                if (
                  draftMatch.isReservedMatch ||
                  (unassignedWaitingPool.length <= 3 &&
                    activeCourtMatches.length > 0)
                ) {
                  const refreshedReserved = generateReservationMatchDraft(
                    unassignedWaitingPool,
                    courtOrderedPlayers,
                    queueFilter,
                    nextMap,
                    0,
                    draftMatch.id,
                    confirmedMatchHistory,
                    activeEligiblePoolSize,
                    hardBlockThresholds
                  );
                  setDraftMatch(refreshedReserved);
                } else {
                  const refreshedAuto = generateAutoMatchDraft(
                    unassignedWaitingPool,
                    queueFilter,
                    nextMap,
                    0,
                    confirmedMatchHistory,
                    activeEligiblePoolSize,
                    hardBlockThresholds
                  );
                  setDraftMatch(refreshedAuto);
                }
              }
            }}
          />
        </div>
      </Modal>

      {/* [명세 3번 & 4번] 매칭 결정 로그(90일 보존) 조회 및 동적 하드블록 임계값(12명/8명) 설정 모달 */}
      <Modal
        isOpen={isDecisionLogModalOpen}
        onClose={() => setIsDecisionLogModalOpen(false)}
        title="📋 매칭 결정 로그 (90일 보존) · 동적 하드블록 임계값 설정"
        size="4xl"
      >
        <div className="space-y-4 text-xs">
          {/* 클럽 설정: 대기 풀 인원수에 따른 최근 동반자 하드블록 동적 완화 임계값 (기본 12명, 8명) */}
          <div className="rounded-xl border border-indigo-400/35 bg-indigo-500/10 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-extrabold text-indigo-200">
                  ⚙️ 소규모 정모 동반자 하드블록 동적 완화 임계값 설정
                </p>
                <p className="mt-0.5 text-xs text-indigo-200/80">
                  현재 대기+휴식 매칭 가능 인원:{" "}
                  <strong className="text-white">
                    {activeEligiblePoolSize}명
                  </strong>{" "}
                  → 현재 적용 기준:{" "}
                  <strong className="text-amber-300">
                    {currentDynamicHardBlockGap === 2
                      ? "직전 2경기 이내 하드블록 (gap ≤ 2)"
                      : currentDynamicHardBlockGap === 1
                        ? "직전 1경기 이내로 하드블록 자동 축소 (gap ≤ 1)"
                        : "하드블록 완전 해제 · 소프트 페널티만 적용"}
                  </strong>
                </p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-2.5">
                <label
                  htmlFor="reduce-hardblock-input"
                  className="block text-xs font-bold text-zinc-300"
                >
                  1경기 하드블록 축소 기준 인원 (기본 12명 미만)
                </label>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    id="reduce-hardblock-input"
                    type="number"
                    min={5}
                    max={30}
                    value={hardBlockThresholds.reduceToOneGameBelow}
                    onChange={(e) => {
                      const val = Math.max(5, Number(e.target.value) || 12);
                      setHardBlockThresholds((prev) => ({
                        ...prev,
                        reduceToOneGameBelow: val,
                      }));
                    }}
                    className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs font-bold text-white"
                  />
                  <span className="text-xs text-zinc-400">
                    명 미만이면 직전 2경기 → 1경기로 축소
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-2.5">
                <label
                  htmlFor="disable-hardblock-input"
                  className="block text-xs font-bold text-zinc-300"
                >
                  하드블록 완전 해제 기준 인원 (기본 8명 미만)
                </label>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    id="disable-hardblock-input"
                    type="number"
                    min={4}
                    max={20}
                    value={hardBlockThresholds.disableBelow}
                    onChange={(e) => {
                      const val = Math.max(4, Number(e.target.value) || 8);
                      setHardBlockThresholds((prev) => ({
                        ...prev,
                        disableBelow: val,
                      }));
                    }}
                    className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs font-bold text-white"
                  />
                  <span className="text-xs text-zinc-400">
                    명 미만이면 하드블록 완전 해제 (소프트 페널티만 적용)
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 90일 보존 매칭 결정 로그 목록 */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                매칭 결정 감사 로그 ({decisionLogs.length}건 · 90일 보존)
              </h3>
              <span className="text-xs text-zinc-400">
                최저 비용 대비 상위 10% 근접 후보군 가중 무작위 샘플링 기록
              </span>
            </div>

            {decisionLogs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 py-8 text-center text-zinc-500">
                아직 기록된 매칭 결정 로그가 없습니다. ⚡ 자동매칭 또는 🔄 멤버
                바꾸기를 실행하면 랜덤 시드와 상위 후보군 비용 내역이 자동
                기록됩니다.
              </div>
            ) : (
              <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
                {decisionLogs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-xl border border-zinc-800 bg-zinc-900/75 p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-xs font-bold text-indigo-300">
                          {log.stageLabel}
                        </span>
                        <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-mono text-amber-300">
                          Seed #{log.randomSeed}
                        </span>
                        <span className="text-xs text-zinc-400">
                          대기풀 {log.activeEligiblePoolSize}명 · 하드블록 gap ≤{" "}
                          {log.appliedHardBlockGap}
                          {log.appliedSpreadLimit
                            ? ` · 허용폭 ${log.appliedSpreadLimit}점`
                            : ""}
                        </span>
                      </div>
                      <span className="text-xs text-zinc-400">
                        {log.createdAt} (90일 보존)
                      </span>
                    </div>

                    <p className="mt-2 text-xs font-bold text-emerald-300">
                      ✅ 최종 선택: {log.selectedSummary}
                    </p>

                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-left text-xs text-zinc-300">
                        <thead className="border-b border-zinc-800 text-zinc-400">
                          <tr>
                            <th className="py-1 pr-2">순위</th>
                            <th className="py-1 pr-2">A팀 vs B팀 구성</th>
                            <th className="py-1 pr-2">총 비용</th>
                            <th className="py-1 pr-2">팀편차(1:1)</th>
                            <th className="py-1 pr-2">개인편차(1:1)</th>
                            <th className="py-1 pr-2">동반페널티</th>
                            <th className="py-1 pr-2">대기순(×10)</th>
                            <th className="py-1 pr-2">파트너가점</th>
                            <th className="py-1">샘플링 확률</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/60">
                          {log.nearOptimalCandidates.map((cand) => (
                            <tr key={cand.rank}>
                              <td className="py-1 pr-2 font-bold text-zinc-400">
                                #{cand.rank}
                              </td>
                              <td className="py-1 pr-2 font-semibold text-white">
                                [{cand.teamANames.join("·")}] vs [
                                {cand.teamBNames.join("·")}]
                              </td>
                              <td className="py-1 pr-2 font-bold text-sky-300">
                                {cand.totalCost}점
                              </td>
                              <td className="py-1 pr-2">{cand.teamDiff}점</td>
                              <td className="py-1 pr-2">
                                {cand.groupSpread}점
                              </td>
                              <td className="py-1 pr-2 text-amber-300">
                                +{cand.softCoPlayerPenalty}점
                              </td>
                              <td className="py-1 pr-2">
                                +{cand.waitPriorityCost}점
                              </td>
                              <td className="py-1 pr-2 text-emerald-300">
                                {cand.partnerBonus}점
                              </td>
                              <td className="py-1 font-bold text-indigo-300">
                                {cand.selectionProbabilityPct}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* 경기 운영 종료 · 참가자 승률 순위 및 전적(몇승 몇패) 결산 모달 */}
      <Modal
        isOpen={isEndSessionModalOpen}
        onClose={() => setIsEndSessionModalOpen(false)}
        title={`🏆 ${meetup.title} 경기 운영 종료 · 참가자 승률 순위 결산`}
        size="4xl"
      >
        <div className="space-y-4">
          {/* 상단 정모 운영 요약 카드 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3 text-center">
              <p className="text-xs font-medium text-zinc-400">
                총 참가 인원
              </p>
              <p className="mt-1 text-lg font-extrabold text-white">
                {sessionSummaryStats.totalParticipants}명
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3 text-center">
              <p className="text-xs font-medium text-zinc-400">
                완료된 총 코트 경기
              </p>
              <p className="mt-1 text-lg font-extrabold text-sky-300">
                {sessionSummaryStats.completedCourtGames}게임
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3 text-center">
              <p className="text-xs font-medium text-zinc-400">
                게임 출전 인원
              </p>
              <p className="mt-1 text-lg font-extrabold text-emerald-300">
                {sessionSummaryStats.playedMemberCount}명
              </p>
            </div>
            <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-center">
              <p className="text-xs font-medium text-amber-300">
                오늘의 승률 1위 MVP
              </p>
              <p className="mt-1 truncate text-sm font-extrabold text-amber-200">
                {sessionSummaryStats.topPlayer
                  ? `🥇 ${sessionSummaryStats.topPlayer.player.name} (${sessionSummaryStats.topPlayer.winRate.toFixed(1)}%)`
                  : "진행 기록 없음"}
              </p>
            </div>
          </div>

          {/* 참가자 승률 순위 리스트 헤더 */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800/90 bg-zinc-900/60 px-3.5 py-2.5 text-xs text-zinc-400">
            <span>
              정렬 기준:{" "}
              <strong className="text-zinc-200">
                승률(%) 높은 순 → 다승(승수 많은 순) → 패수 적은 순 → 총 경기 수
                → ELO 점수
              </strong>
            </span>
            <span>총 {sessionWinRateRankings.length}명</span>
          </div>

          {/* 참가자 승률 순위 명단 */}
          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {sessionWinRateRankings.map(
              ({ player: p, rank, decidedGames, winRate, eloDiff }, idx) => {
                const isFemale = p.gender === "FEMALE";
                const hasPlayed = decidedGames > 0 || p.totalGameCount > 0;
                const drawOrNoResultGames = Math.max(
                  0,
                  p.totalGameCount - decidedGames
                );

                return (
                  <div
                    key={p.id}
                    className={`flex flex-col justify-between gap-3 rounded-xl border px-3.5 py-3 transition sm:flex-row sm:items-center ${idx === 0 && hasPlayed
                        ? "border-amber-400/50 bg-amber-500/10"
                        : isFemale
                          ? "border-pink-400/30 bg-pink-500/10"
                          : "border-sky-400/30 bg-sky-500/10"
                      }`}
                  >
                    {/* 좌측: 순위 + 이름/급수/성별 정보 */}
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={`flex h-9 w-12 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold ${rank === 1 && hasPlayed
                            ? "bg-amber-400 text-zinc-950 shadow-sm"
                            : rank === 2 && hasPlayed
                              ? "bg-zinc-300 text-zinc-950"
                              : rank === 3 && hasPlayed
                                ? "bg-amber-700/80 text-amber-100"
                                : "bg-zinc-800 text-zinc-300"
                          }`}
                      >
                        {rank === 1 && hasPlayed
                          ? "🥇 1위"
                          : rank === 2 && hasPlayed
                            ? "🥈 2위"
                            : rank === 3 && hasPlayed
                              ? "🥉 3위"
                              : `${rank}위`}
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-bold text-white">
                            {p.name}
                          </span>
                          {p.nickname && p.nickname !== p.name && (
                            <span className="text-xs text-zinc-400">
                              ({p.nickname})
                            </span>
                          )}
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-bold ${isFemale
                                ? "bg-pink-400/25 text-pink-200"
                                : "bg-sky-400/25 text-sky-200"
                              }`}
                          >
                            {isFemale ? "여" : "남"} · {p.grade}조
                          </span>
                          {p.isGuest && (
                            <span className="rounded bg-amber-500/25 px-1.5 py-0.5 text-xs font-bold text-amber-300">
                              게스트
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-300">
                          <span>
                            최종 ELO{" "}
                            <strong className="text-white">
                              {Math.round(p.eloScore)}점
                            </strong>
                          </span>
                          <span
                            className={`font-bold ${eloDiff > 0
                                ? "text-emerald-300"
                                : eloDiff < 0
                                  ? "text-rose-300"
                                  : "text-zinc-400"
                              }`}
                          >
                            ({eloDiff > 0 ? `+${eloDiff}` : eloDiff}점)
                          </span>
                          <span className="text-zinc-500">·</span>
                          <span>총 {p.totalGameCount}게임 출전</span>
                        </div>
                      </div>
                    </div>

                    {/* 우측: 몇승 몇패 전적 배지 + 승률(%) 게이지 */}
                    <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                      {/* 몇승 몇패 명확 표기 */}
                      <div className="flex items-center gap-1.5 rounded-lg border border-zinc-700/80 bg-zinc-950/75 px-3 py-1.5 text-xs">
                        <span className="font-extrabold text-emerald-300">
                          {p.wins}승
                        </span>
                        <span className="text-zinc-600">/</span>
                        <span className="font-extrabold text-rose-300">
                          {p.losses}패
                        </span>
                        {drawOrNoResultGames > 0 && (
                          <>
                            <span className="text-zinc-600">·</span>
                            <span className="text-xs font-semibold text-zinc-400">
                              미입력 {drawOrNoResultGames}G
                            </span>
                          </>
                        )}
                      </div>

                      {/* 승률 수치 및 미니 프로그레스 바 */}
                      <div className="w-28 text-right">
                        <div className="flex items-baseline justify-end gap-1">
                          <span className="text-xs text-zinc-400">승률</span>
                          <span
                            className={`text-sm font-extrabold ${!hasPlayed
                                ? "text-zinc-400"
                                : winRate >= 60
                                  ? "text-amber-300"
                                  : winRate >= 50
                                    ? "text-emerald-300"
                                    : "text-sky-200"
                              }`}
                          >
                            {winRate.toFixed(1)}%
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className={`h-full rounded-full transition-all ${winRate >= 60
                                ? "bg-amber-400"
                                : winRate >= 50
                                  ? "bg-emerald-400"
                                  : "bg-[#5a9cf8]"
                              }`}
                            style={{
                              width: `${Math.min(100, Math.max(0, winRate))}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }
            )}
          </div>

          {/* 하단 액션 버튼 */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-3">
            <p className="text-xs text-zinc-400">
              경기 결과를 확인한 후 계속 운영하거나 정모 운영을 종료하고 홈으로
              이동할 수 있습니다.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsEndSessionModalOpen(false)}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-700"
              >
                계속 운영하기 (닫기)
              </button>
              <button
                type="button"
                onClick={() => void handleFinalizeAndGoHome()}
                className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-rose-500"
              >
                🏠 경기 운영 최종 종료 (홈으로)
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function SessionMatchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#0d0f14] text-sm text-zinc-400">
          경기 진행 현황판을 불러오는 중입니다...
        </div>
      }
    >
      <SessionMatchContent />
    </Suspense>
  );
}

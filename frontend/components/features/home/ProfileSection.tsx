"use client";

import React, { useEffect, useMemo, useState } from "react";
import { GenderBadge } from "@/components/common/GenderBadge";
import { GRADE_BASE_ELO } from "@/data/membersData";
import type {
  AgeGroup,
  Gender,
  Grade,
  InjuryLevel,
  MemberDto,
  MemberPreferenceDto,
} from "@/types/home";

interface ProfileSectionProps {
  members: MemberDto[];
  onUpdateMemberProfile: (
    memberId: number,
    updates: {
      name?: string;
      nickname?: string;
      gender?: Gender;
      grade?: Grade;
      ageGroup?: AgeGroup;
      injuryLevel?: InjuryLevel;
      bio?: string;
    }
  ) => void;
  onPreferencesUpdated?: (
    allPrefs: Record<number, MemberPreferenceDto>
  ) => void;
}

const AGE_BONUS_MAP: Record<AgeGroup, number> = {
  UNDER_10: 300,
  "20S": 250,
  "30S": 200,
  "40S": 150,
  "50S": 100,
  "60S": 50,
  OVER_70: 0,
};

/**
 * 모든 회원이 접근 가능한 프로필 컴포넌트 (메인 화면 프로필 탭 & 경기 진행 중 프로필 설정 모달 공용)
 * - 희망 파트너 지정: 검색 기반 선택 (남성: 남복 1명 + 혼복 1명 총 2명 / 여성: 여복 1명 + 혼복 1명 총 2명)
 * - 기피 인원 설정: 검색 기반 선택 (최대 3명까지 지정 가능)
 * - 설정 즉시 PostgreSQL(partner_preferences, avoid_preferences) 및 localStorage에 동기화되어 경기 진행 중 자동매칭에도 실시간 반영됩니다.
 */
const ProfileSectionComponent: React.FC<ProfileSectionProps> = ({
  members,
  onUpdateMemberProfile,
  onPreferencesUpdated,
}) => {
  const [selectedMemberId, setSelectedMemberId] = useState<number>(3); // 기본: 한태호(3)
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

  // 검색 입력 상태 (동성 복식 파트너 검색 / 혼복 파트너 검색 / 기피 인원 검색)
  const [samePartnerSearch, setSamePartnerSearch] = useState("");
  const [mixedPartnerSearch, setMixedPartnerSearch] = useState("");
  const [avoidSearch, setAvoidSearch] = useState("");
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // DB에서 전체 선호/기피 데이터 로드
  useEffect(() => {
    let isMounted = true;
    fetch("/api/preferences", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Record<number, MemberPreferenceDto> | null) => {
        if (!isMounted || !data || typeof data !== "object") return;
        setPreferencesMap((prev) => {
          const merged = { ...prev, ...data };
          try {
            localStorage.setItem(
              "dailyminton_preferences",
              JSON.stringify(merged)
            );
          } catch {
            // ignore
          }
          return merged;
        });
      })
      .catch(() => {
        // ignore
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const memberMap = useMemo(() => {
    const map = new Map<number, MemberDto>();
    members.forEach((m) => map.set(m.id, m));
    return map;
  }, [members]);

  const currentMember = useMemo(
    () =>
      members.find((m) => m.id === selectedMemberId) ?? members[0] ?? null,
    [members, selectedMemberId]
  );

  const [editNickname, setEditNickname] = useState<string>("");
  const [editBio, setEditBio] = useState<string>("");

  const currentPref: MemberPreferenceDto = useMemo(() => {
    if (!currentMember) {
      return {
        memberId: 0,
        sameGenderPartnerId: null,
        mixedPartnerId: null,
        avoidMemberIds: [],
      };
    }
    return (
      preferencesMap[currentMember.id] ?? {
        memberId: currentMember.id,
        sameGenderPartnerId: null,
        mixedPartnerId: null,
        avoidMemberIds: [],
      }
    );
  }, [currentMember, preferencesMap]);

  const handleSelectProfileMember = (nextId: number) => {
    setSelectedMemberId(nextId);
    const found = members.find((m) => m.id === nextId);
    if (found) {
      setEditNickname(found.nickname);
      setEditBio(found.bio);
    }
    setSamePartnerSearch("");
    setMixedPartnerSearch("");
    setAvoidSearch("");
    setSavedNotice(null);
  };

  // 선호/기피 변경 시 즉시 상태 + localStorage + PostgreSQL DB 저장
  const savePreferenceUpdate = (nextPref: MemberPreferenceDto) => {
    if (!currentMember) return;
    const nextMap = {
      ...preferencesMap,
      [currentMember.id]: nextPref,
    };
    setPreferencesMap(nextMap);
    onPreferencesUpdated?.(nextMap);

    try {
      localStorage.setItem("dailyminton_preferences", JSON.stringify(nextMap));
    } catch {
      // ignore
    }

    fetch("/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memberId: currentMember.id,
        memberGender: currentMember.gender,
        sameGenderPartnerId: nextPref.sameGenderPartnerId,
        mixedPartnerId: nextPref.mixedPartnerId,
        avoidMemberIds: nextPref.avoidMemberIds,
      }),
    }).catch(() => {
      // ignore
    });
  };

  // 1) 남복(또는 여복) 파트너検索 후보 (본인 제외, 동성만, 기피인원 제외)
  const sameGenderCandidates = useMemo(() => {
    if (!currentMember) return [];
    const kw = samePartnerSearch.trim().toLowerCase();
    return members.filter((m) => {
      if (m.id === currentMember.id) return false;
      if (m.gender !== currentMember.gender) return false;
      if (currentPref.avoidMemberIds.includes(m.id)) return false;
      if (!kw) return true;
      return (
        m.name.toLowerCase().includes(kw) ||
        m.nickname.toLowerCase().includes(kw)
      );
    });
  }, [currentMember, members, samePartnerSearch, currentPref.avoidMemberIds]);

  // 2) 혼복 파트너 검색 후보 (본인 제외, 이성만, 기피인원 제외)
  const mixedGenderCandidates = useMemo(() => {
    if (!currentMember) return [];
    const kw = mixedPartnerSearch.trim().toLowerCase();
    return members.filter((m) => {
      if (m.id === currentMember.id) return false;
      if (m.gender === currentMember.gender) return false;
      if (currentPref.avoidMemberIds.includes(m.id)) return false;
      if (!kw) return true;
      return (
        m.name.toLowerCase().includes(kw) ||
        m.nickname.toLowerCase().includes(kw)
      );
    });
  }, [currentMember, members, mixedPartnerSearch, currentPref.avoidMemberIds]);

  // 3) 기피 인원 검색 후보 (본인 제외, 이미 지정된 기피 인원 및 파트너 제외)
  const avoidCandidates = useMemo(() => {
    if (!currentMember) return [];
    const kw = avoidSearch.trim().toLowerCase();
    return members.filter((m) => {
      if (m.id === currentMember.id) return false;
      if (currentPref.avoidMemberIds.includes(m.id)) return false;
      if (
        currentPref.sameGenderPartnerId === m.id ||
        currentPref.mixedPartnerId === m.id
      ) {
        return false;
      }
      if (!kw) return true;
      return (
        m.name.toLowerCase().includes(kw) ||
        m.nickname.toLowerCase().includes(kw)
      );
    });
  }, [currentMember, members, avoidSearch, currentPref]);

  if (!currentMember) {
    return null;
  }

  const isMale = currentMember.gender === "MALE";
  const sameDoubleLabel = isMale ? "남복 파트너" : "여복 파트너";
  const samePartnerMember = currentPref.sameGenderPartnerId
    ? memberMap.get(currentPref.sameGenderPartnerId)
    : undefined;
  const mixedPartnerMember = currentPref.mixedPartnerId
    ? memberMap.get(currentPref.mixedPartnerId)
    : undefined;
  const totalPartnerCount =
    (samePartnerMember ? 1 : 0) + (mixedPartnerMember ? 1 : 0);

  const baseElo = GRADE_BASE_ELO[currentMember.grade] ?? 1200;
  const ageBonus = AGE_BONUS_MAP[currentMember.ageGroup] ?? 200;
  const totalRankingScore = baseElo + ageBonus;

  const handleSelectSamePartner = (partnerId: number | null) => {
    savePreferenceUpdate({
      ...currentPref,
      sameGenderPartnerId: partnerId,
    });
    setSamePartnerSearch("");
    setSavedNotice(
      partnerId
        ? `${sameDoubleLabel}가 지정되어 매칭에 실시간 반영됩니다.`
        : `${sameDoubleLabel} 지정이 해제되었습니다.`
    );
  };

  const handleSelectMixedPartner = (partnerId: number | null) => {
    savePreferenceUpdate({
      ...currentPref,
      mixedPartnerId: partnerId,
    });
    setMixedPartnerSearch("");
    setSavedNotice(
      partnerId
        ? "혼복 파트너가 지정되어 매칭에 실시간 반영됩니다."
        : "혼복 파트너 지정이 해제되었습니다."
    );
  };

  const handleAddAvoidMember = (avoidId: number) => {
    if (currentPref.avoidMemberIds.length >= 3) return;
    if (currentPref.avoidMemberIds.includes(avoidId)) return;
    const nextAvoids = [...currentPref.avoidMemberIds, avoidId];
    savePreferenceUpdate({
      ...currentPref,
      avoidMemberIds: nextAvoids,
    });
    setAvoidSearch("");
    setSavedNotice(
      `기피 인원이 설정되었습니다 (${nextAvoids.length}/3명 · 매칭 시 자동 회피).`
    );
  };

  const handleRemoveAvoidMember = (avoidId: number) => {
    const nextAvoids = currentPref.avoidMemberIds.filter(
      (id) => id !== avoidId
    );
    savePreferenceUpdate({
      ...currentPref,
      avoidMemberIds: nextAvoids,
    });
    setSavedNotice(
      `기피 인원 설정이 해제되었습니다 (${nextAvoids.length}/3명).`
    );
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateMemberProfile(currentMember.id, {
      nickname: editNickname.trim() || currentMember.nickname,
      injuryLevel: currentMember.injuryLevel ?? "NONE",
      bio: editBio.trim() || currentMember.bio,
    });
    savePreferenceUpdate(currentPref);
    setSavedNotice(
      "프로필 및 희망 파트너(최대 2명)·기피 인원(최대 3명) 설정이 저장되었습니다."
    );
  };

  return (
    <section aria-labelledby="profile-heading" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="profile-heading"
            className="text-[18px] font-bold tracking-tight text-white"
          >
            내 프로필 · 매칭 파트너/기피 설정
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            경기 진행 중에도 언제든 희망 파트너(종목별 1명씩 총 2명)와 기피 인원(최대 3명)을 검색해 설정하면 자동매칭에 즉시 반영됩니다.
          </p>
        </div>

        {/* 현재 프로필 설정 대상 회원 전환 */}
        <div className="flex items-center gap-2">
          <label
            htmlFor="profile-member-switcher"
            className="text-xs font-medium text-zinc-400"
          >
            프로필 조회 회원:
          </label>
          <select
            id="profile-member-switcher"
            value={currentMember.id}
            onChange={(e) => handleSelectProfileMember(Number(e.target.value))}
            className="rounded-lg border border-zinc-700 bg-[#151821] px-3 py-1.5 text-xs font-semibold text-zinc-100 outline-none focus:border-[#5a9cf8]"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.gender === "FEMALE" ? "여" : "남"} · {m.grade}조)
              </option>
            ))}
          </select>
        </div>
      </div>

      {savedNotice && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-2.5 text-xs font-semibold text-emerald-200">
          ✅ {savedNotice}
        </div>
      )}

      {/* 상단 프로필 요약 카드 */}
      <div
        className={`flex flex-col justify-between gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center ${
          currentMember.gender === "FEMALE"
            ? "border-pink-400/35 bg-pink-500/12"
            : "border-sky-400/35 bg-sky-500/10"
        }`}
      >
        <div className="flex items-center gap-4">
          <div
            style={{ background: currentMember.avatarGradient }}
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-2xl text-white shadow-md"
          >
            <span aria-hidden="true">{currentMember.avatarEmoji}</span>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold text-white">
                {currentMember.name}
              </span>
              <span className="text-xs text-zinc-300">
                (닉네임: {currentMember.nickname})
              </span>
              <GenderBadge
                gender={currentMember.gender}
                grade={currentMember.grade}
                ageGroup={currentMember.ageGroup}
              />
            </div>
            <p className="mt-1 text-xs text-zinc-300">
              가입일: {currentMember.joinedAt} · 인사말: {currentMember.bio}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-xl border border-zinc-800/80 bg-[#0d0f14]/80 px-4 py-3">
          <div className="text-center">
            <div className="text-[11px] text-zinc-400">순수 ELO</div>
            <div className="mt-0.5 text-base font-bold text-white">
              {baseElo}점
            </div>
          </div>
          <div className="h-7 w-px bg-zinc-800" />
          <div className="text-center">
            <div className="text-[11px] text-zinc-400">연령 가점</div>
            <div className="mt-0.5 text-base font-bold text-emerald-300">
              +{ageBonus}점
            </div>
          </div>
          <div className="h-7 w-px bg-zinc-800" />
          <div className="text-center">
            <div className="text-[11px] text-[#5a9cf8]">최종 랭킹 점수</div>
            <div className="mt-0.5 text-base font-bold text-[#5a9cf8]">
              {totalRankingScore.toLocaleString()}점
            </div>
          </div>
        </div>
      </div>

      {/* =================================================================
          희망 파트너 지정 (검색 기반 · 남복/여복 1명 + 혼복 1명 = 총 2명)
          & 기피 인원 설정 (검색 기반 · 최대 3명)
      ================================================================= */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 1. 희망 파트너 지정 카드 (종목별 1명씩 총 2명) */}
        <div className="space-y-4 rounded-2xl border border-zinc-800 bg-[#151821] p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">
                🤝 희망 파트너 지정 ({totalPartnerCount}/2명)
              </h3>
              <p className="mt-0.5 text-xs text-zinc-400">
                {isMale
                  ? "남성은 남복 파트너 1명, 혼복 파트너 1명씩 총 2명까지 검색해 지정할 수 있습니다."
                  : "여성은 여복 파트너 1명, 혼복 파트너 1명씩 총 2명까지 검색해 지정할 수 있습니다."}
              </p>
            </div>
          </div>

          {/* 1-A. 남복 (또는 여복) 파트너 1명 검색 및 선택 */}
          <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/60 p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-sky-300">
                1) {sameDoubleLabel} ({isMale ? "남성" : "여성"} 1명)
              </span>
              <span className="text-[11px] text-zinc-400">
                {samePartnerMember ? "1/1명 지정됨" : "미지정 (0/1명)"}
              </span>
            </div>

            {samePartnerMember ? (
              <div className="flex items-center justify-between rounded-lg border border-sky-400/40 bg-sky-500/15 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">
                    {samePartnerMember.name}
                  </span>
                  <GenderBadge
                    gender={samePartnerMember.gender}
                    grade={samePartnerMember.grade}
                    ageGroup={samePartnerMember.ageGroup}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleSelectSamePartner(null)}
                  className="rounded bg-zinc-900/80 px-2.5 py-1 text-xs font-semibold text-rose-300 transition hover:bg-zinc-900"
                >
                  ✕ 해제
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <search>
                  <label htmlFor="same-partner-search" className="sr-only">
                    {sameDoubleLabel} 이름 검색
                  </label>
                  <input
                    id="same-partner-search"
                    type="search"
                    value={samePartnerSearch}
                    onChange={(e) => setSamePartnerSearch(e.target.value)}
                    placeholder={`${sameDoubleLabel}로 지정할 ${
                      isMale ? "남성" : "여성"
                    } 회원 이름·닉네임 검색...`}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-[#5a9cf8]"
                  />
                </search>

                <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                  {sameGenderCandidates.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-zinc-800 py-4 text-center text-xs text-zinc-500">
                      검색 결과가 없습니다.
                    </div>
                  ) : (
                    sameGenderCandidates.map((candidate) => (
                      <div
                        key={candidate.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800/80 bg-[#151821] px-3 py-2 text-xs"
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="shrink-0 whitespace-nowrap font-bold text-zinc-100">
                            {candidate.name}
                          </span>
                          <GenderBadge
                            gender={candidate.gender}
                            grade={candidate.grade}
                            ageGroup={candidate.ageGroup}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSelectSamePartner(candidate.id)}
                          className="shrink-0 whitespace-nowrap rounded bg-[#5a9cf8] px-2.5 py-1 text-xs font-bold text-white transition hover:bg-[#488be8]"
                        >
                          파트너 선택
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 1-B. 혼복 파트너 1명 검색 및 선택 */}
          <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/60 p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-pink-300">
                2) 혼복 파트너 ({isMale ? "여성" : "남성"} 1명)
              </span>
              <span className="text-[11px] text-zinc-400">
                {mixedPartnerMember ? "1/1명 지정됨" : "미지정 (0/1명)"}
              </span>
            </div>

            {mixedPartnerMember ? (
              <div className="flex items-center justify-between rounded-lg border border-pink-400/40 bg-pink-500/15 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">
                    {mixedPartnerMember.name}
                  </span>
                  <GenderBadge
                    gender={mixedPartnerMember.gender}
                    grade={mixedPartnerMember.grade}
                    ageGroup={mixedPartnerMember.ageGroup}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleSelectMixedPartner(null)}
                  className="rounded bg-zinc-900/80 px-2.5 py-1 text-xs font-semibold text-rose-300 transition hover:bg-zinc-900"
                >
                  ✕ 해제
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <search>
                  <label htmlFor="mixed-partner-search" className="sr-only">
                    혼복 파트너 이름 검색
                  </label>
                  <input
                    id="mixed-partner-search"
                    type="search"
                    value={mixedPartnerSearch}
                    onChange={(e) => setMixedPartnerSearch(e.target.value)}
                    placeholder={`혼복 파트너로 지정할 ${
                      isMale ? "여성" : "남성"
                    } 회원 이름·닉네임 검색...`}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-[#5a9cf8]"
                  />
                </search>

                <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                  {mixedGenderCandidates.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-zinc-800 py-4 text-center text-xs text-zinc-500">
                      검색 결과가 없습니다.
                    </div>
                  ) : (
                    mixedGenderCandidates.map((candidate) => (
                      <div
                        key={candidate.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800/80 bg-[#151821] px-3 py-2 text-xs"
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="shrink-0 whitespace-nowrap font-bold text-zinc-100">
                            {candidate.name}
                          </span>
                          <GenderBadge
                            gender={candidate.gender}
                            grade={candidate.grade}
                            ageGroup={candidate.ageGroup}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSelectMixedPartner(candidate.id)}
                          className="shrink-0 whitespace-nowrap rounded bg-pink-500 px-2.5 py-1 text-xs font-bold text-white transition hover:bg-pink-600"
                        >
                          파트너 선택
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 2. 기피 인원 설정 카드 (검색 기반 · 최대 3명까지 지정 가능) */}
        <div className="space-y-4 rounded-2xl border border-zinc-800 bg-[#151821] p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">
                🛡️ 기피 인원 설정 ({currentPref.avoidMemberIds.length}/3명)
              </h3>
              <p className="mt-0.5 text-xs text-zinc-400">
                최대 3명까지 검색해 지정할 수 있으며, 외부에 노출되지 않고 자동매칭 시 같은 게임 배정을 회피합니다.
              </p>
            </div>
          </div>

          {/* 현재 지정된 기피 인원 목록 (최대 3명) */}
          <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/60 p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-rose-300">
                현재 지정된 기피 인원 ({currentPref.avoidMemberIds.length}/3명)
              </span>
              {currentPref.avoidMemberIds.length >= 3 && (
                <span className="rounded bg-rose-500/20 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
                  최대 3명 지정 완료
                </span>
              )}
            </div>

            {currentPref.avoidMemberIds.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-800 py-4 text-center text-xs text-zinc-500">
                지정된 기피 인원이 없습니다. 아래에서 검색해 추가하세요.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {currentPref.avoidMemberIds.map((avoidId, idx) => {
                  const avoided = memberMap.get(avoidId);
                  if (!avoided) return null;
                  return (
                    <li
                      key={avoidId}
                      className="flex items-center justify-between rounded-lg border border-rose-400/35 bg-rose-500/15 px-3 py-2 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-rose-300">
                          {idx + 1}.
                        </span>
                        <span className="font-bold text-white">
                          {avoided.name}
                        </span>
                        <GenderBadge
                          gender={avoided.gender}
                          grade={avoided.grade}
                          ageGroup={avoided.ageGroup}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveAvoidMember(avoidId)}
                        className="rounded bg-zinc-900/80 px-2.5 py-1 text-xs font-semibold text-rose-200 transition hover:bg-zinc-900"
                      >
                        ✕ 해제
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* 기피 인원 검색 및 추가 */}
          <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/60 p-3.5">
            <search className="mb-2 block">
              <label htmlFor="avoid-member-search" className="sr-only">
                기피 인원 이름 검색
              </label>
              <input
                id="avoid-member-search"
                type="search"
                disabled={currentPref.avoidMemberIds.length >= 3}
                value={avoidSearch}
                onChange={(e) => setAvoidSearch(e.target.value)}
                placeholder={
                  currentPref.avoidMemberIds.length >= 3
                    ? "기피 인원 최대 3명이 모두 지정되었습니다."
                    : "기피할 회원 이름 또는 닉네임 검색..."
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </search>

            <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
              {avoidCandidates.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-800 py-4 text-center text-xs text-zinc-500">
                  검색 결과가 없습니다.
                </div>
              ) : (
                avoidCandidates.map((candidate) => (
                  <div
                    key={candidate.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800/80 bg-[#151821] px-3 py-2 text-xs"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="shrink-0 whitespace-nowrap font-bold text-zinc-100">
                        {candidate.name}
                      </span>
                      <GenderBadge
                        gender={candidate.gender}
                        grade={candidate.grade}
                        ageGroup={candidate.ageGroup}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={currentPref.avoidMemberIds.length >= 3}
                      onClick={() => handleAddAvoidMember(candidate.id)}
                      className="shrink-0 whitespace-nowrap rounded bg-rose-500/80 px-2.5 py-1 text-xs font-bold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      + 기피 지정
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 기본 정보 수정 폼 */}
      <form
        onSubmit={handleSaveProfile}
        className="space-y-5 rounded-2xl border border-zinc-800 bg-[#151821] p-5 text-sm"
      >
        <h3 className="text-base font-bold text-white">기본 프로필 정보 수정</h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="profile-nickname"
              className="mb-1 block text-xs font-semibold text-zinc-300"
            >
              소모임 닉네임
            </label>
            <input
              id="profile-nickname"
              name="nickname"
              type="text"
              placeholder={currentMember.nickname}
              value={editNickname}
              onChange={(e) => setEditNickname(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-[#5a9cf8]"
            />
          </div>

          <div>
            <label
              htmlFor="profile-injury"
              className="mb-1 block text-xs font-semibold text-zinc-300"
            >
              현재 부상 정도 (자동매칭 밸런스 반영)
            </label>
            <select
              id="profile-injury"
              name="injuryLevel"
              value={currentMember.injuryLevel ?? "NONE"}
              onChange={(e) => {
                const nextInjury = e.target.value as InjuryLevel;
                onUpdateMemberProfile(currentMember.id, {
                  injuryLevel: nextInjury,
                });
                setSavedNotice(
                  nextInjury === "NONE"
                    ? "부상 상태가 정상으로 변경되어 자동매칭에 즉시 반영됩니다."
                    : `부상 정도(${nextInjury === "MILD" ? "경미 -50점" : "심함 -120점"})가 자동매칭에 즉시 반영됩니다.`
                );
              }}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none"
            >
              <option value="NONE">정상 (부상 없음)</option>
              <option value="MILD">경미한 부상 (매칭 보정 적용)</option>
              <option value="SEVERE">심한 부상 (무리한 매칭 완화)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label
              htmlFor="profile-gender"
              className="mb-1 block text-xs font-semibold text-zinc-300"
            >
              성별
            </label>
            <select
              id="profile-gender"
              name="gender"
              value={currentMember.gender}
              onChange={(e) =>
                onUpdateMemberProfile(currentMember.id, {
                  gender: e.target.value as Gender,
                })
              }
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none"
            >
              <option value="MALE">남성</option>
              <option value="FEMALE">여성</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="profile-grade"
              className="mb-1 block text-xs font-semibold text-zinc-300"
            >
              급수 (S~G)
            </label>
            <select
              id="profile-grade"
              name="grade"
              value={currentMember.grade}
              onChange={(e) =>
                onUpdateMemberProfile(currentMember.id, {
                  grade: e.target.value as Grade,
                })
              }
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none"
            >
              {(["S", "A", "B", "C", "D", "E", "F", "G"] as const).map((g) => (
                <option key={g} value={g}>
                  {g}조
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="profile-age"
              className="mb-1 block text-xs font-semibold text-zinc-300"
            >
              연령대
            </label>
            <select
              id="profile-age"
              name="ageGroup"
              value={currentMember.ageGroup}
              onChange={(e) =>
                onUpdateMemberProfile(currentMember.id, {
                  ageGroup: e.target.value as AgeGroup,
                })
              }
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none"
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

        <div>
          <label
            htmlFor="profile-bio"
            className="mb-1 block text-xs font-semibold text-zinc-300"
          >
            모임 인사말
          </label>
          <input
            id="profile-bio"
            name="bio"
            type="text"
            placeholder={currentMember.bio}
            value={editBio}
            onChange={(e) => setEditBio(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-[#5a9cf8]"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-lg bg-[#5a9cf8] px-5 py-2 text-xs font-bold text-white transition hover:bg-[#488be8]"
          >
            프로필 저장
          </button>
        </div>
      </form>
    </section>
  );
};

export const ProfileSection = React.memo(ProfileSectionComponent);
